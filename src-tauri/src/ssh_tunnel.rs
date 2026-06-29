use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Config, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::Disconnect;
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

/// russh client handler. We only need to accept the server key.
struct TunnelHandler;

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept any host key. This matches the previous libssh2 behavior, which
        // did not verify the server key. (Adding known_hosts verification is a
        // possible future security improvement.)
        Ok(true)
    }
}

/// Authenticate the session: try the private key first (if provided), then
/// fall back to password. `ssh_password` doubles as the passphrase for an
/// encrypted private key.
async fn authenticate(
    session: &mut Handle<TunnelHandler>,
    ssh_user: &str,
    ssh_password: Option<&str>,
    ssh_key_path: Option<&str>,
) -> Result<(), String> {
    if let Some(key_path) = ssh_key_path {
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
            // Use the password as the passphrase for encrypted keys.
            match load_secret_key(&expanded_path, ssh_password) {
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

    if let Some(password) = ssh_password {
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
        ssh_password: Option<&str>,
        ssh_key_path: Option<&str>,
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
        let mut session = client::connect(config, (ssh_host, ssh_port), TunnelHandler)
            .await
            .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;

        println!("[SSH] Connected, authenticating...");
        authenticate(&mut session, ssh_user, ssh_password, ssh_key_path).await?;
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
