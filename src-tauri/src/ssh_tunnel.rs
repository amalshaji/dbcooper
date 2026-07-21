use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Config, Handle};
use russh::keys::{check_known_hosts_path, load_secret_key, PrivateKeyWithHashAlg};
use russh::Disconnect;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Per-direction buffer used when pumping bytes between the local socket and the
/// SSH channel. libssh2 used 8 KiB; a larger buffer keeps more data in flight on
/// high-latency links and improves large-result throughput.
const FORWARD_BUF_SIZE: usize = 128 * 1024;

pub struct SshTunnel {
    pub local_port: u16,
    _shutdown_tx: oneshot::Sender<()>,
}

#[derive(Clone, Copy)]
pub struct SshAuth<'a> {
    password: Option<&'a str>,
    key_passphrase: Option<&'a str>,
    key_path: Option<&'a str>,
}

impl<'a> SshAuth<'a> {
    pub fn from_connection(
        use_key: bool,
        credential: Option<&'a str>,
        key_path: Option<&'a str>,
    ) -> Self {
        let credential = credential.filter(|value| !value.is_empty());
        let key_path = key_path.filter(|value| !value.is_empty());

        if use_key {
            Self {
                password: None,
                key_passphrase: credential,
                key_path,
            }
        } else {
            Self {
                password: credential,
                key_passphrase: None,
                key_path: None,
            }
        }
    }
}

#[derive(Debug, Error)]
enum TunnelError {
    #[error(transparent)]
    Ssh(#[from] russh::Error),
    #[error("Could not find the home directory needed for SSH host key verification")]
    NoHomeDirectory,
    #[error(
        "SSH host key for {host}:{port} is not trusted ({fingerprint}). Add it to {known_hosts_path} before reconnecting"
    )]
    UnknownHostKey {
        host: String,
        port: u16,
        fingerprint: String,
        known_hosts_path: String,
    },
    #[error("SSH host key verification failed for {host}:{port}: {source}")]
    HostKeyVerification {
        host: String,
        port: u16,
        #[source]
        source: russh::keys::Error,
    },
}

fn verify_server_key_at_path(
    host: &str,
    port: u16,
    server_public_key: &russh::keys::ssh_key::PublicKey,
    known_hosts_path: &Path,
) -> Result<(), TunnelError> {
    match check_known_hosts_path(host, port, server_public_key, known_hosts_path) {
        Ok(true) => Ok(()),
        Ok(false) => Err(TunnelError::UnknownHostKey {
            host: host.to_string(),
            port,
            fingerprint: server_public_key
                .fingerprint(Default::default())
                .to_string(),
            known_hosts_path: known_hosts_path.display().to_string(),
        }),
        Err(source) => Err(TunnelError::HostKeyVerification {
            host: host.to_string(),
            port,
            source,
        }),
    }
}

struct TunnelHandler {
    ssh_host: String,
    ssh_port: u16,
    known_hosts_path: PathBuf,
}

impl client::Handler for TunnelHandler {
    type Error = TunnelError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        verify_server_key_at_path(
            &self.ssh_host,
            self.ssh_port,
            server_public_key,
            &self.known_hosts_path,
        )?;
        Ok(true)
    }
}

async fn authenticate(
    session: &mut Handle<TunnelHandler>,
    ssh_user: &str,
    auth: SshAuth<'_>,
) -> Result<(), String> {
    if let Some(key_path) = auth.key_path {
        if !key_path.is_empty() {
            let expanded_path = if key_path.starts_with('~') {
                if let Some(home) = dirs::home_dir() {
                    key_path.replacen('~', home.to_str().unwrap_or(""), 1)
                } else {
                    key_path.to_string()
                }
            } else {
                key_path.to_string()
            };

            println!("[SSH] Attempting key auth with: {}", expanded_path);
            match load_secret_key(&expanded_path, auth.key_passphrase) {
                Ok(key) => {
                    let hash_alg = session
                        .best_supported_rsa_hash()
                        .await
                        .ok()
                        .flatten()
                        .flatten();
                    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
                    match session.authenticate_publickey(ssh_user, key).await {
                        Ok(result) if result.success() => {
                            println!("[SSH] Key authentication successful");
                            return Ok(());
                        }
                        Ok(_) => println!("[SSH] Key authentication rejected by server"),
                        Err(e) => println!("[SSH] Key authentication error: {}", e),
                    }
                }
                Err(e) => println!("[SSH] Failed to load private key: {}", e),
            }
        }
    }

    if let Some(password) = auth.password {
        if !password.is_empty() {
            println!("[SSH] Attempting password authentication");
            match session
                .authenticate_password(ssh_user, password)
                .await
                .map_err(|e| format!("SSH password authentication failed: {}", e))?
            {
                result if result.success() => {
                    println!("[SSH] Password authentication successful");
                    return Ok(());
                }
                _ => {}
            }
        }
    }

    Err("SSH authentication failed - check credentials".to_string())
}

/// Forward one accepted local connection to the remote host over a direct-tcpip
/// channel, pumping bytes both ways until either side closes.
async fn forward_connection(
    session: Arc<Handle<TunnelHandler>>,
    mut local_stream: tokio::net::TcpStream,
    remote_host: String,
    remote_port: u16,
    originator_port: u16,
) {
    // Disable Nagle on the local leg so small query round-trips aren't delayed.
    let _ = local_stream.set_nodelay(true);

    let channel = match session
        .channel_open_direct_tcpip(
            remote_host,
            u32::from(remote_port),
            "127.0.0.1",
            u32::from(originator_port),
        )
        .await
    {
        Ok(channel) => channel,
        Err(e) => {
            println!("[SSH] Failed to open channel: {}", e);
            return;
        }
    };

    let mut channel_stream = channel.into_stream();
    match tokio::io::copy_bidirectional_with_sizes(
        &mut local_stream,
        &mut channel_stream,
        FORWARD_BUF_SIZE,
        FORWARD_BUF_SIZE,
    )
    .await
    {
        Ok((to_remote, to_local)) => println!(
            "[SSH] Tunnel closed. Bytes: {} up, {} down",
            to_remote, to_local
        ),
        Err(e) => println!("[SSH] Copy error: {}", e),
    }
}

impl SshTunnel {
    pub async fn new(
        ssh_host: &str,
        ssh_port: u16,
        ssh_user: &str,
        auth: SshAuth<'_>,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self, String> {
        println!(
            "[SSH] Creating tunnel to {}:{} -> {}:{}",
            ssh_host, ssh_port, remote_host, remote_port
        );

        // nodelay disables Nagle on the SSH socket; keepalive prevents idle
        // timeouts. window_size/maximum_packet_size keep russh's generous
        // defaults (2 MiB window) for good throughput on high-latency links.
        let config = Arc::new(Config {
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        });

        println!(
            "[SSH] Connecting to SSH server at {}:{}",
            ssh_host, ssh_port
        );
        // (ssh_host, ssh_port) is resolved via ToSocketAddrs, so hostnames work
        // (the old libssh2 path required a literal IP).
        let known_hosts_path = dirs::home_dir()
            .ok_or(TunnelError::NoHomeDirectory)
            .map_err(|e| e.to_string())?
            .join(".ssh")
            .join("known_hosts");
        let handler = TunnelHandler {
            ssh_host: ssh_host.to_string(),
            ssh_port,
            known_hosts_path,
        };
        let mut session = client::connect(config, (ssh_host, ssh_port), handler)
            .await
            .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;

        println!("[SSH] Connected, authenticating...");
        authenticate(&mut session, ssh_user, auth).await?;
        println!("[SSH] Authentication successful");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        println!("[SSH] Tunnel listening on 127.0.0.1:{}", local_port);

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let remote_host = remote_host.to_string();
        // russh channels are independent and demultiplexed by a single client
        // event loop, so there is no per-session mutex to serialize them.
        let session = Arc::new(session);

        tokio::spawn(async move {
            println!("[SSH] Forwarding task started");
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        println!("[SSH] Shutdown requested");
                        break;
                    }
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((local_stream, peer_addr)) => {
                                tokio::spawn(forward_connection(
                                    Arc::clone(&session),
                                    local_stream,
                                    remote_host.clone(),
                                    remote_port,
                                    peer_addr.port(),
                                ));
                            }
                            Err(e) => {
                                println!("[SSH] Accept error: {}", e);
                            }
                        }
                    }
                }
            }

            // Cleanly close the SSH session on shutdown.
            let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
        });

        Ok(Self {
            local_port,
            _shutdown_tx: shutdown_tx,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::parse_public_key_base64;

    const TRUSTED_KEY: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ";
    const OTHER_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G2sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X";

    #[test]
    fn password_auth_does_not_reuse_the_credential_as_a_key_passphrase() {
        let auth = SshAuth::from_connection(false, Some("password"), Some("~/.ssh/id_ed25519"));

        assert_eq!(auth.password, Some("password"));
        assert_eq!(auth.key_passphrase, None);
        assert_eq!(auth.key_path, None);
    }

    #[test]
    fn key_auth_uses_the_credential_only_as_the_key_passphrase() {
        let auth = SshAuth::from_connection(true, Some("passphrase"), Some("~/.ssh/id_ed25519"));

        assert_eq!(auth.password, None);
        assert_eq!(auth.key_passphrase, Some("passphrase"));
        assert_eq!(auth.key_path, Some("~/.ssh/id_ed25519"));
    }

    #[test]
    fn accepts_a_matching_known_host_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        std::fs::write(
            &path,
            format!("[db.example.com]:2222 ssh-ed25519 {TRUSTED_KEY}\n"),
        )
        .unwrap();
        let key = parse_public_key_base64(TRUSTED_KEY).unwrap();

        assert!(verify_server_key_at_path("db.example.com", 2222, &key, &path).is_ok());
    }

    #[test]
    fn rejects_an_unknown_host_key_with_its_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        let key = parse_public_key_base64(TRUSTED_KEY).unwrap();
        let fingerprint = key.fingerprint(Default::default()).to_string();

        let error = verify_server_key_at_path("db.example.com", 22, &key, &path).unwrap_err();

        assert!(error.to_string().contains("not trusted"));
        assert!(error.to_string().contains(&fingerprint));
    }

    #[test]
    fn rejects_a_changed_host_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        std::fs::write(&path, format!("db.example.com ssh-ed25519 {TRUSTED_KEY}\n")).unwrap();
        let key = parse_public_key_base64(OTHER_KEY).unwrap();

        let error = verify_server_key_at_path("db.example.com", 22, &key, &path).unwrap_err();

        assert!(error.to_string().contains("changed"));
    }
}
