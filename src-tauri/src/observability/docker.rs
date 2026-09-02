use super::{
    bound_text, parse_log_entry, ObservabilityEngine, ObservabilityEntry, ObservabilityEntryKind,
    ObservabilityStreamEvent, MAX_ENTRY_BYTES,
};
use sqlx::SqlitePool;
use tauri::ipc::Channel;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Child;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Duration, Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const LINE_QUEUE_CAPACITY: usize = 256;
const BATCH_ENTRY_LIMIT: usize = 100;
const BATCH_INTERVAL: Duration = Duration::from_millis(50);
// Empty snapshots are ignorable heartbeats that surface an abandoned Channel while logs are idle.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const CHILD_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(test)]
fn docker_log_args(container_id: &str) -> Vec<String> {
    crate::docker::logs_args(container_id).unwrap_or_default()
}

fn validate_runtime_identity(container_id: &str) -> Result<(), String> {
    crate::docker::logs_args(container_id).map(|_| ())
}

async fn forward_bounded_lines<R>(mut reader: R, sender: mpsc::Sender<String>)
where
    R: AsyncRead + Unpin,
{
    let mut chunk = [0_u8; 4096];
    let mut line = Vec::with_capacity(4096);
    let mut discarded = false;
    loop {
        let count = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for byte in &chunk[..count] {
            if *byte == b'\n' {
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                let mut text = String::from_utf8_lossy(&line).into_owned();
                if discarded {
                    text.push_str("… [truncated]");
                }
                if sender.send(bound_text(&text)).await.is_err() {
                    return;
                }
                line.clear();
                discarded = false;
            } else if line.len() < MAX_ENTRY_BYTES {
                line.push(*byte);
            } else {
                discarded = true;
            }
        }
    }
    if !line.is_empty() || discarded {
        let mut text = String::from_utf8_lossy(&line).into_owned();
        if discarded {
            text.push_str("… [truncated]");
        }
        let _ = sender.send(bound_text(&text)).await;
    }
}

fn flush_batch(
    channel: &Channel<ObservabilityStreamEvent>,
    stream_id: &str,
    batch: &mut Vec<ObservabilityEntry>,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    channel
        .send(ObservabilityStreamEvent::Snapshot {
            stream_id: stream_id.to_string(),
            entries: std::mem::take(batch),
        })
        .map_err(|_| "The observability viewer was closed".to_string())
}

fn heartbeat_event(stream_id: &str) -> ObservabilityStreamEvent {
    ObservabilityStreamEvent::Snapshot {
        stream_id: stream_id.to_string(),
        entries: Vec::new(),
    }
}

async fn cleanup_child(child: &mut Child, readers: Vec<JoinHandle<()>>) {
    for reader in &readers {
        reader.abort();
    }
    let cleanup = async {
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.start_kill();
        }
        for reader in readers {
            let _ = reader.await;
        }
        let _ = child.wait().await;
    };
    let _ = tokio::time::timeout(CHILD_CLEANUP_TIMEOUT, cleanup).await;
}

pub(crate) async fn run_docker_logs(
    sqlite_pool: &SqlitePool,
    connection_uuid: &str,
    engine: ObservabilityEngine,
    stream_id: &str,
    channel: &Channel<ObservabilityStreamEvent>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    let container_id = crate::docker::resolve_linked_container_id(sqlite_pool, connection_uuid)
        .await?
        .ok_or_else(|| "No DBcooper-linked Docker container was found".to_string())?;
    validate_runtime_identity(&container_id)?;
    let mut child = crate::docker::logs_command(&container_id)?
        .spawn()
        .map_err(|error| format!("Failed to start Docker logs: {error}"))?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        cleanup_child(&mut child, Vec::new()).await;
        return Err("Docker logs did not provide piped output".to_string());
    };
    let (sender, mut receiver) = mpsc::channel(LINE_QUEUE_CAPACITY);
    let readers = vec![
        tokio::spawn(forward_bounded_lines(stdout, sender.clone())),
        tokio::spawn(forward_bounded_lines(stderr, sender.clone())),
    ];
    drop(sender);

    let mut batch = Vec::with_capacity(BATCH_ENTRY_LIMIT);
    let mut ticker = tokio::time::interval(BATCH_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut heartbeat =
        tokio::time::interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let result = loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                break Ok(());
            }
            line = receiver.recv() => {
                match line {
                    Some(line) => {
                        batch.push(parse_log_entry(
                            engine,
                            uuid::Uuid::new_v4().to_string(),
                            line,
                            ObservabilityEntryKind::Line,
                        ));
                        if batch.len() >= BATCH_ENTRY_LIMIT {
                            if let Err(error) = flush_batch(channel, stream_id, &mut batch) {
                                break Err(error);
                            }
                        }
                    }
                    None => {
                        if let Err(error) = flush_batch(channel, stream_id, &mut batch) {
                            break Err(error);
                        }
                        break match child.try_wait() {
                            Err(_) => Err("Failed to read Docker log process status".to_string()),
                            Ok(Some(status)) if status.success() => Ok(()),
                            Ok(Some(_)) => Err("Docker log source ended unexpectedly".to_string()),
                            Ok(None) => Err("Docker log source stopped producing output".to_string()),
                        };
                    }
                }
            }
            _ = ticker.tick(), if !batch.is_empty() => {
                if let Err(error) = flush_batch(channel, stream_id, &mut batch) {
                    break Err(error);
                }
            }
            _ = heartbeat.tick() => {
                if channel.send(heartbeat_event(stream_id)).is_err() {
                    break Err("The observability viewer was closed".to_string());
                }
            }
        }
    };
    cleanup_child(&mut child, readers).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docker_log_arguments_are_fixed_and_put_identity_last() {
        assert_eq!(
            docker_log_args("linked-container"),
            [
                "logs",
                "--tail",
                "200",
                "--follow",
                "--timestamps",
                "linked-container",
            ]
        );
    }

    #[test]
    fn empty_runtime_identity_is_rejected() {
        assert_eq!(
            validate_runtime_identity("  ").unwrap_err(),
            "Docker container is missing. Relink this connection."
        );
    }

    #[test]
    fn idle_channel_heartbeat_is_an_empty_snapshot() {
        match heartbeat_event("stream-1") {
            ObservabilityStreamEvent::Snapshot { stream_id, entries } => {
                assert_eq!(stream_id, "stream-1");
                assert!(entries.is_empty());
            }
            _ => panic!("heartbeat must use the ignorable snapshot shape"),
        }
    }
}
