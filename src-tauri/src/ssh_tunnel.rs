use async_ssh2_lite::{AsyncSession, SessionConfiguration, TokioTcpStream};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

pub struct SshTunnel {
    pub local_port: u16,
    _shutdown_tx: oneshot::Sender<()>,
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

        let ssh_addr: SocketAddr = format!("{}:{}", ssh_host, ssh_port)
            .parse()
            .map_err(|e| format!("Invalid SSH address: {}", e))?;

        println!("[SSH] Connecting to SSH server at {}", ssh_addr);
        let stream = TokioTcpStream::connect(ssh_addr)
            .await
            .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;

        println!("[SSH] TCP connection established, creating session");
        // Configure keep-alive to prevent connection timeout during idle periods
        // Send keep-alive every 15 seconds
        let mut config = SessionConfiguration::new();
        config.set_keepalive(true, 15);

        let mut session = AsyncSession::new(stream, Some(config))
            .map_err(|e| format!("Failed to create SSH session: {}", e))?;
        println!("[SSH] Keep-alive configured (interval: 15s)");

        println!("[SSH] Performing handshake");
        session
            .handshake()
            .await
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        println!("[SSH] Handshake complete, authenticating...");

        if let Some(key_path) = ssh_key_path {
            if !key_path.is_empty() {
                let expanded_path = if key_path.starts_with("~") {
                    if let Some(home) = dirs::home_dir() {
                        key_path.replacen("~", home.to_str().unwrap_or(""), 1)
                    } else {
                        key_path.to_string()
                    }
                } else {
                    key_path.to_string()
                };

                println!("[SSH] Attempting key auth with: {}", expanded_path);
                match session
                    .userauth_pubkey_file(
                        ssh_user,
                        None,
                        std::path::Path::new(&expanded_path),
                        None,
                    )
                    .await
                {
                    Ok(_) => println!("[SSH] Key authentication successful"),
                    Err(e) => println!("[SSH] Key authentication failed: {}", e),
                }
            }
        }

        if !session.authenticated() {
            if let Some(password) = ssh_password {
                if !password.is_empty() {
                    println!("[SSH] Attempting password authentication");
                    session
                        .userauth_password(ssh_user, password)
                        .await
                        .map_err(|e| format!("SSH password authentication failed: {}", e))?;
                }
            }
        }

        if !session.authenticated() {
            return Err("SSH authentication failed - check credentials".to_string());
        }

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
        // Wrap session in Mutex to serialize channel opens (libssh2 isn't thread-safe for concurrent ops)
        let session = Arc::new(Mutex::new(session));

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
                            Ok((mut local_stream, peer_addr)) => {
                                println!("[SSH] New connection from {}", peer_addr);
                                let session = Arc::clone(&session);
                                let remote_host = remote_host.clone();

                                tokio::spawn(async move {
                                    println!(
                                        "[SSH] Opening channel to {}:{}",
                                        remote_host, remote_port
                                    );
                                    // Lock session to serialize channel operations
                                    let session_guard = session.lock().await;
                                    match session_guard
                                        .channel_direct_tcpip(&remote_host, remote_port, None)
                                        .await
                                    {
                                        Ok(mut channel) => {
                                            // Drop lock before copy to allow other channels
                                            drop(session_guard);
                                            println!("[SSH] Channel opened successfully");
                                            match tokio::io::copy_bidirectional(
                                                &mut local_stream,
                                                &mut channel,
                                            )
                                            .await
                                            {
                                                Ok((to_remote, to_local)) => {
                                                    println!(
                                                        "[SSH] Tunnel closed. Bytes: {} up, {} down",
                                                        to_remote, to_local
                                                    );
                                                }
                                                Err(e) => {
                                                    println!("[SSH] Copy error: {}", e);
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            println!("[SSH] Failed to open channel: {}", e);
                                        }
                                    }
                                });
                            }
                            Err(e) => {
                                println!("[SSH] Accept error: {}", e);
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            local_port,
            _shutdown_tx: shutdown_tx,
        })
    }
}
