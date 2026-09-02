use crate::database::pool_manager::PoolManager;
use crate::observability::{
    capabilities_for, native_source_is_supported, run_docker_logs, run_native_source, NativeSource,
    ObservabilityAvailability, ObservabilityEngine, ObservabilityManager, ObservabilityMode,
    ObservabilitySourceCapability, ObservabilityStopReason, ObservabilityStreamEvent,
    StartObservabilityStreamResponse,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

async fn connection_engine(
    sqlite_pool: &SqlitePool,
    connection_uuid: &str,
) -> Result<ObservabilityEngine, String> {
    let db_type: String = sqlx::query_scalar("SELECT db_type FROM connections WHERE uuid = ?")
        .bind(connection_uuid)
        .fetch_optional(sqlite_pool)
        .await
        .map_err(|_| "Failed to inspect observability capabilities".to_string())?
        .ok_or_else(|| "Connection not found".to_string())?;
    ObservabilityEngine::try_from(db_type.as_str())
}

async fn capabilities(
    sqlite_pool: &SqlitePool,
    connection_uuid: &str,
) -> Result<(ObservabilityEngine, Vec<ObservabilitySourceCapability>), String> {
    let engine = connection_engine(sqlite_pool, connection_uuid).await?;
    let docker_probe =
        crate::docker::linked_container_is_available(sqlite_pool, connection_uuid).await;
    let mut capabilities = capabilities_for(engine, matches!(docker_probe, Ok(true)));
    if docker_probe.is_err() {
        if let Some(docker) = capabilities.iter_mut().find(|source| source.id == "docker") {
            docker.availability = ObservabilityAvailability::Unavailable;
            docker.reason = Some(
                "The linked Docker container is unavailable in the current Docker context"
                    .to_string(),
            );
        }
    }
    Ok((engine, capabilities))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_observability_capabilities(
    sqlite_pool: State<'_, SqlitePool>,
    connection_uuid: String,
) -> Result<Vec<ObservabilitySourceCapability>, String> {
    capabilities(sqlite_pool.inner(), &connection_uuid)
        .await
        .map(|(_, capabilities)| capabilities)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_observability_stream(
    sqlite_pool: State<'_, SqlitePool>,
    pool_manager: State<'_, Arc<PoolManager>>,
    observability_manager: State<'_, Arc<ObservabilityManager>>,
    connection_uuid: String,
    mode: ObservabilityMode,
    source: String,
    on_event: Channel<ObservabilityStreamEvent>,
) -> Result<StartObservabilityStreamResponse, String> {
    let connection_lock = pool_manager.get_connect_lock(&connection_uuid).await;
    let _connection_guard = connection_lock.lock().await;
    let (engine, capabilities) = capabilities(sqlite_pool.inner(), &connection_uuid).await?;
    let capability = capabilities
        .iter()
        .find(|capability| capability.id == source && capability.modes.contains(&mode))
        .ok_or_else(|| {
            "The selected observability source is not valid for this database".to_string()
        })?;
    if capability.availability == ObservabilityAvailability::Unavailable {
        return Err(capability
            .reason
            .clone()
            .unwrap_or_else(|| "The selected observability source is unavailable".to_string()));
    }
    if source != "docker" {
        if !native_source_is_supported(engine, mode, &source) {
            return Err("The selected observability source is unavailable".to_string());
        }
        pool_manager
            .ensure_connected_locked(sqlite_pool.inner(), &connection_uuid)
            .await?;
    }

    let registration = observability_manager.register(&connection_uuid).await?;
    let stream_id = registration.stream_id.clone();
    let response = StartObservabilityStreamResponse {
        stream_id: stream_id.clone(),
    };
    let supervisor_manager = observability_manager.inner().clone();
    let task_pool = sqlite_pool.inner().clone();
    let task_connections = pool_manager.inner().clone();
    let worker_registration = registration.clone();
    let worker = tokio::spawn(async move {
        let result = if source == "docker" {
            run_docker_logs(
                &task_pool,
                &connection_uuid,
                engine,
                &stream_id,
                &on_event,
                worker_registration.cancellation.clone(),
            )
            .await
        } else {
            run_native_source(
                task_connections,
                &connection_uuid,
                NativeSource::new(engine, mode, &source),
                &stream_id,
                &on_event,
                worker_registration.cancellation.clone(),
            )
            .await
        };
        if let Err(message) = result {
            let _ = on_event.send(ObservabilityStreamEvent::Error {
                stream_id: Some(stream_id.clone()),
                code: "source_unavailable".to_string(),
                message,
                recoverable: false,
            });
        }
        let reason = if worker_registration.cancellation.is_cancelled() {
            worker_registration.stop_reason()
        } else {
            ObservabilityStopReason::SourceEnded
        };
        let _ = on_event.send(ObservabilityStreamEvent::Stopped {
            stream_id: stream_id.clone(),
            reason,
        });
    });
    let _supervisor = supervisor_manager.supervise_worker(&registration, worker);
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_observability_stream(
    observability_manager: State<'_, Arc<ObservabilityManager>>,
    stream_id: String,
) -> Result<(), String> {
    observability_manager
        .stop(&stream_id, ObservabilityStopReason::Requested)
        .await;
    Ok(())
}
