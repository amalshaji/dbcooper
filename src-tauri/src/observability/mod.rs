mod contract;
mod docker;
mod native;
mod parser;

pub use contract::*;
pub(crate) use docker::run_docker_logs;
pub(crate) use native::{native_source_is_supported, run_native_source, NativeSource};
pub(crate) use parser::parse_log_entry;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use tokio::task::{AbortHandle, JoinHandle};
use tokio_util::sync::CancellationToken;

const MAX_STREAMS_PER_CONNECTION: usize = 4;
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct ObservabilityManager {
    state: Arc<Mutex<ManagerState>>,
    shutdown_timeout: Duration,
}

struct ManagerState {
    streams: HashMap<String, Arc<ActiveStream>>,
    shutdown: bool,
}

struct ActiveStream {
    connection_uuid: String,
    cancellation: CancellationToken,
    stop_reason: StdMutex<ObservabilityStopReason>,
    worker: StdMutex<Option<AbortHandle>>,
    force_abort: AtomicBool,
    done: AtomicBool,
    finished: Notify,
}

#[derive(Clone)]
pub(crate) struct StreamRegistration {
    pub(crate) stream_id: String,
    pub(crate) cancellation: CancellationToken,
    active: Arc<ActiveStream>,
}

impl StreamRegistration {
    pub(crate) fn stop_reason(&self) -> ObservabilityStopReason {
        self.active
            .stop_reason
            .lock()
            .map(|reason| *reason)
            .unwrap_or(ObservabilityStopReason::SourceEnded)
    }
}

impl Default for ObservabilityManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ObservabilityManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ManagerState {
                streams: HashMap::new(),
                shutdown: false,
            })),
            shutdown_timeout: DEFAULT_SHUTDOWN_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_shutdown_timeout(shutdown_timeout: Duration) -> Self {
        Self {
            state: Arc::new(Mutex::new(ManagerState {
                streams: HashMap::new(),
                shutdown: false,
            })),
            shutdown_timeout,
        }
    }

    pub(crate) async fn register(
        &self,
        connection_uuid: &str,
    ) -> Result<StreamRegistration, String> {
        let stream_id = uuid::Uuid::new_v4().to_string();
        let active = Arc::new(ActiveStream {
            connection_uuid: connection_uuid.to_string(),
            cancellation: CancellationToken::new(),
            stop_reason: StdMutex::new(ObservabilityStopReason::SourceEnded),
            worker: StdMutex::new(None),
            force_abort: AtomicBool::new(false),
            done: AtomicBool::new(false),
            finished: Notify::new(),
        });
        let mut state = self.state.lock().await;
        if state.shutdown {
            return Err("Observability is shutting down".to_string());
        }
        let active_count = state
            .streams
            .values()
            .filter(|stream| stream.connection_uuid == connection_uuid)
            .count();
        if active_count >= MAX_STREAMS_PER_CONNECTION {
            return Err("Too many live observability streams for this connection".to_string());
        }
        state.streams.insert(stream_id.clone(), active.clone());
        Ok(StreamRegistration {
            stream_id,
            cancellation: active.cancellation.clone(),
            active,
        })
    }

    pub(crate) fn supervise_worker(
        &self,
        registration: &StreamRegistration,
        worker: JoinHandle<()>,
    ) -> JoinHandle<()> {
        let stream_id = registration.stream_id.clone();
        let manager = self.clone();
        let mut stored_worker = registration
            .active
            .worker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *stored_worker = Some(worker.abort_handle());
        if registration.active.force_abort.load(Ordering::Acquire) {
            if let Some(worker) = stored_worker.as_ref() {
                worker.abort();
            }
        }
        let supervisor = tokio::spawn(async move {
            let _ = worker.await;
            manager.finish(&stream_id).await;
        });
        drop(stored_worker);
        supervisor
    }

    pub(crate) async fn finish(&self, stream_id: &str) {
        if let Some(active) = self.state.lock().await.streams.remove(stream_id) {
            active.done.store(true, Ordering::Release);
            active.finished.notify_waiters();
        }
    }

    pub async fn stop(&self, stream_id: &str, reason: ObservabilityStopReason) {
        let Some(active) = self.state.lock().await.streams.get(stream_id).cloned() else {
            return;
        };
        self.stop_active(vec![(stream_id.to_string(), active)], reason)
            .await;
    }

    pub async fn stop_connection(&self, connection_uuid: &str) {
        let streams = self
            .state
            .lock()
            .await
            .streams
            .iter()
            .filter_map(|(stream_id, active)| {
                (active.connection_uuid == connection_uuid)
                    .then_some((stream_id.clone(), active.clone()))
            })
            .collect::<Vec<_>>();
        self.stop_active(streams, ObservabilityStopReason::Disconnected)
            .await;
    }

    pub async fn stop_all(&self) {
        let streams = {
            let mut state = self.state.lock().await;
            state.shutdown = true;
            state
                .streams
                .iter()
                .map(|(stream_id, active)| (stream_id.clone(), active.clone()))
                .collect::<Vec<_>>()
        };
        self.stop_active(streams, ObservabilityStopReason::Requested)
            .await;
    }

    async fn stop_active(
        &self,
        streams: Vec<(String, Arc<ActiveStream>)>,
        reason: ObservabilityStopReason,
    ) {
        if streams.is_empty() {
            return;
        }
        for (_, active) in &streams {
            set_stop_reason(active, reason);
            active.cancellation.cancel();
        }
        let cooperative_timeout = self.shutdown_timeout / 2;
        if tokio::time::timeout(cooperative_timeout, wait_for_streams(&streams))
            .await
            .is_ok()
        {
            return;
        }

        for (_, active) in &streams {
            if !active.done.load(Ordering::Acquire) {
                active.force_abort.store(true, Ordering::Release);
                if let Ok(worker) = active.worker.lock() {
                    if let Some(worker) = worker.as_ref() {
                        worker.abort();
                    }
                }
            }
        }
        let abort_timeout = self.shutdown_timeout.saturating_sub(cooperative_timeout);
        let _ = tokio::time::timeout(abort_timeout, wait_for_streams(&streams)).await;
    }

    #[cfg(test)]
    async fn cancel_connection(&self, connection_uuid: &str) {
        let state = self.state.lock().await;
        for active in state.streams.values() {
            if active.connection_uuid == connection_uuid {
                active.cancellation.cancel();
            }
        }
    }

    #[cfg(test)]
    async fn stream_count(&self) -> usize {
        self.state.lock().await.streams.len()
    }
}

fn set_stop_reason(active: &ActiveStream, reason: ObservabilityStopReason) {
    if let Ok(mut current_reason) = active.stop_reason.lock() {
        if *current_reason == ObservabilityStopReason::SourceEnded {
            *current_reason = reason;
        }
    }
}

async fn wait_until_finished(active: &ActiveStream) {
    loop {
        let notified = active.finished.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if active.done.load(Ordering::Acquire) {
            return;
        }
        notified.await;
    }
}

async fn wait_for_streams(streams: &[(String, Arc<ActiveStream>)]) {
    futures_util::future::join_all(
        streams
            .iter()
            .map(|(_, active)| wait_until_finished(active)),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn register_current(
        manager: &ObservabilityManager,
        connection_uuid: &str,
    ) -> StreamRegistration {
        manager.register(connection_uuid).await.unwrap()
    }

    #[tokio::test]
    async fn stopping_a_stream_waits_for_cleanup_and_removes_it() {
        let manager = ObservabilityManager::new();
        let registration = register_current(&manager, "connection-1").await;
        let worker_manager = manager.clone();
        let stream_id = registration.stream_id.clone();
        let worker_stream_id = stream_id.clone();
        tokio::spawn(async move {
            registration.cancellation.cancelled().await;
            worker_manager.finish(&worker_stream_id).await;
        });

        manager
            .stop(&stream_id, ObservabilityStopReason::Requested)
            .await;

        assert_eq!(manager.stream_count().await, 0);
    }

    #[tokio::test]
    async fn disconnecting_stops_every_stream_for_only_that_connection() {
        let manager = ObservabilityManager::new();
        let first = register_current(&manager, "connection-1").await;
        let second = register_current(&manager, "connection-1").await;
        let other = register_current(&manager, "connection-2").await;

        manager.cancel_connection("connection-1").await;

        assert!(first.cancellation.is_cancelled());
        assert!(second.cancellation.is_cancelled());
        assert!(!other.cancellation.is_cancelled());
    }

    #[tokio::test]
    async fn shutdown_aborts_and_removes_an_unresponsive_worker_within_one_bound() {
        let manager = ObservabilityManager::with_shutdown_timeout(Duration::from_millis(20));
        let registration = register_current(&manager, "connection-1").await;
        let stream_id = registration.stream_id.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        let worker_dropped = dropped.clone();
        let started = Arc::new(Notify::new());
        let worker_started = started.clone();
        let worker = tokio::spawn(async move {
            struct DropSignal(Arc<AtomicBool>);
            impl Drop for DropSignal {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::Release);
                }
            }
            let _signal = DropSignal(worker_dropped);
            worker_started.notify_one();
            std::future::pending::<()>().await;
        });
        started.notified().await;
        let _supervisor = manager.supervise_worker(&registration, worker);

        tokio::time::timeout(
            Duration::from_millis(200),
            manager.stop(&stream_id, ObservabilityStopReason::Requested),
        )
        .await
        .expect("shutdown exceeded its global bound");

        assert!(dropped.load(Ordering::Acquire));
        assert_eq!(manager.stream_count().await, 0);
    }

    #[tokio::test]
    async fn first_explicit_stop_reason_wins() {
        let manager = ObservabilityManager::new();
        let registration = register_current(&manager, "connection-1").await;

        set_stop_reason(&registration.active, ObservabilityStopReason::Requested);
        set_stop_reason(&registration.active, ObservabilityStopReason::Disconnected);

        assert_eq!(
            registration.stop_reason(),
            ObservabilityStopReason::Requested
        );
    }

    #[tokio::test]
    async fn limits_active_streams_per_connection() {
        let manager = ObservabilityManager::new();
        for _ in 0..MAX_STREAMS_PER_CONNECTION {
            register_current(&manager, "connection-1").await;
        }

        assert!(manager.register("connection-1").await.is_err());
        register_current(&manager, "connection-2").await;
    }

    #[tokio::test]
    async fn supervisor_removes_a_panicked_worker_registration() {
        let manager = ObservabilityManager::new();
        let registration = register_current(&manager, "connection-1").await;
        let worker = tokio::spawn(async move {
            panic!("simulated worker panic");
        });
        let _supervisor = manager.supervise_worker(&registration, worker);

        tokio::time::timeout(Duration::from_millis(200), async {
            while manager.stream_count().await != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("panicked worker registration was retained");
    }

    #[tokio::test]
    async fn shutdown_permanently_rejects_registration() {
        let manager = ObservabilityManager::new();

        manager.stop_all().await;

        assert!(manager.register("connection-1").await.is_err());
    }

    #[tokio::test]
    async fn worker_attached_after_stop_bound_is_aborted_and_awaited() {
        let manager = ObservabilityManager::with_shutdown_timeout(Duration::from_millis(20));
        let registration = register_current(&manager, "connection-1").await;
        let stream_id = registration.stream_id.clone();

        manager
            .stop(&stream_id, ObservabilityStopReason::Requested)
            .await;
        assert_eq!(manager.stream_count().await, 1);

        let dropped = Arc::new(AtomicBool::new(false));
        let worker_dropped = dropped.clone();
        let started = Arc::new(Notify::new());
        let worker_started = started.clone();
        let worker = tokio::spawn(async move {
            struct DropSignal(Arc<AtomicBool>);
            impl Drop for DropSignal {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::Release);
                }
            }
            let _signal = DropSignal(worker_dropped);
            worker_started.notify_one();
            std::future::pending::<()>().await;
        });
        started.notified().await;

        manager
            .supervise_worker(&registration, worker)
            .await
            .unwrap();

        assert!(dropped.load(Ordering::Acquire));
        assert_eq!(manager.stream_count().await, 0);
    }
}
