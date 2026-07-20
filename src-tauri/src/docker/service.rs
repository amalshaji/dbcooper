use super::cli::{self, ContainerInspect};
use super::model::{
    connection_string, detect_engine, managed_container_matches, DockerConnectionDraft,
    DockerConnectionState, DockerConnectionStatus, DockerContainerSummary, DockerDatabaseEngine,
    DockerLink, DockerOperation, DockerOwnership, ManagedDatabasePlan, DEFAULT_HOST,
};
use super::store;
use crate::db::models::{Connection, ConnectionFormData};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDockerDatabaseRequest {
    pub engine: DockerDatabaseEngine,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkDockerDatabaseRequest {
    pub name: String,
    pub container_id: String,
    pub engine: DockerDatabaseEngine,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteConnectionResult {
    pub deleted: bool,
    pub docker_cleanup_warning: Option<String>,
}

#[tauri::command]
pub async fn docker_list_containers() -> Result<Vec<DockerContainerSummary>, String> {
    cli::list_containers().await
}

#[tauri::command]
pub async fn docker_prepare_connection(
    container_id: String,
) -> Result<DockerConnectionDraft, String> {
    let mut inspect = cli::inspect(&container_id).await?;
    let engine = detect_engine(&inspect.config.image, &inspect.exposed_ports())
        .ok_or_else(|| "This container is not a supported database".to_string())?;
    if !inspect.state.running {
        cli::start(&container_id).await?;
        inspect = cli::inspect(&container_id).await?;
    }
    let port = inspect.host_port(engine.internal_port()).ok_or_else(|| {
        format!(
            "{} is not published to the host. Publish container port {} before linking it.",
            engine.db_type(),
            engine.internal_port()
        )
    })?;
    let env = inspect.env();
    let (database, username, password) = credentials(&container_id, engine, &inspect, &env).await?;
    let defaults = engine.defaults();
    Ok(DockerConnectionDraft {
        container_id,
        container_name: inspect.name().to_string(),
        image: inspect.config.image.clone(),
        engine,
        host: DEFAULT_HOST.to_string(),
        port,
        database: value_or_default(database, defaults.0),
        username: value_or_default(username, defaults.1),
        password,
        compose_project: inspect
            .config
            .labels
            .get("com.docker.compose.project")
            .cloned(),
        compose_service: inspect
            .config
            .labels
            .get("com.docker.compose.service")
            .cloned(),
    })
}

async fn credentials(
    container_id: &str,
    engine: DockerDatabaseEngine,
    inspect: &ContainerInspect,
    env: &std::collections::HashMap<String, String>,
) -> Result<(String, String, String), String> {
    match engine {
        DockerDatabaseEngine::Postgres => {
            let (database, username, password) = tokio::try_join!(
                cli::env_value(container_id, env, "POSTGRES_DB"),
                cli::env_value(container_id, env, "POSTGRES_USER"),
                cli::env_value(container_id, env, "POSTGRES_PASSWORD"),
            )?;
            Ok((database, username, password))
        }
        DockerDatabaseEngine::Redis => {
            let password = cli::env_value(container_id, env, "REDIS_PASSWORD").await?;
            Ok((
                "0".to_string(),
                "default".to_string(),
                if password.is_empty() {
                    inspect.command_option("--requirepass")
                } else {
                    password
                },
            ))
        }
        DockerDatabaseEngine::Clickhouse => {
            let (database, username, password) = tokio::try_join!(
                cli::env_value(container_id, env, "CLICKHOUSE_DB"),
                cli::env_value(container_id, env, "CLICKHOUSE_USER"),
                cli::env_value(container_id, env, "CLICKHOUSE_PASSWORD"),
            )?;
            Ok((database, username, password))
        }
    }
}

fn value_or_default(value: String, default: &str) -> String {
    if value.is_empty() {
        default.to_string()
    } else {
        value
    }
}

#[tauri::command]
pub async fn docker_create_database(
    pool: State<'_, SqlitePool>,
    request: CreateDockerDatabaseRequest,
) -> Result<Connection, String> {
    let name = request.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("Name must be between 1 and 80 characters".to_string());
    }

    let context = cli::current_context().await?;
    let plan = ManagedDatabasePlan::new(request.engine);
    let container_id = match cli::create(&plan.run_args).await {
        Ok(container_id) => container_id,
        Err(error) => return Err(cleanup_failed_run(&plan, error).await),
    };
    let inspect = match cli::inspect(&container_id).await {
        Ok(inspect) => inspect,
        Err(error) => {
            return Err(cleanup_created_failure(&container_id, &plan.volume_name, error).await)
        }
    };
    let port = match inspect.host_port(plan.engine.internal_port()) {
        Some(port) => port,
        None => {
            return Err(cleanup_created_failure(
                &container_id,
                &plan.volume_name,
                "Docker did not publish a host port".to_string(),
            )
            .await)
        }
    };
    if let Err(error) = cli::wait_until_ready(
        &container_id,
        plan.engine,
        &plan.username,
        &plan.password,
        &plan.database,
    )
    .await
    {
        return Err(cleanup_created_failure(&container_id, &plan.volume_name, error).await);
    }

    let data = plan.connection_data(name, port);
    let link = plan.link(context, container_id.clone());
    match store::insert_connection_with_link(pool.inner(), &plan.uuid, &data, &link).await {
        Ok(connection) => Ok(connection),
        Err(error) => Err(cleanup_created_failure(&container_id, &plan.volume_name, error).await),
    }
}

async fn cleanup_failed_run(plan: &ManagedDatabasePlan, error: String) -> String {
    let labels = cli::managed_connection_labels(&plan.uuid);
    match cli::find_one_by_labels(&labels).await {
        Ok(Some(container)) => {
            cleanup_created_failure(&container.id, &plan.volume_name, error).await
        }
        _ => error,
    }
}

async fn cleanup_created_failure(container_id: &str, volume_name: &str, error: String) -> String {
    match cli::remove_created(container_id, volume_name).await {
        Ok(()) => error,
        Err(cleanup) => format!("{error}. Docker cleanup also failed: {cleanup}"),
    }
}

#[tauri::command]
pub async fn docker_link_connection(
    pool: State<'_, SqlitePool>,
    request: LinkDockerDatabaseRequest,
) -> Result<Connection, String> {
    let name = request.name.trim();
    if name.is_empty()
        || name.len() > 80
        || request.host.trim().is_empty()
        || !(1..=65535).contains(&request.port)
    {
        return Err(
            "A name between 1 and 80 characters, host, and valid host port are required"
                .to_string(),
        );
    }
    let context = cli::current_context().await?;
    let draft = docker_prepare_connection(request.container_id.clone()).await?;
    if draft.engine != request.engine {
        return Err("The selected database type does not match the container".to_string());
    }
    cli::wait_until_ready(
        &draft.container_id,
        request.engine,
        &request.username,
        &request.password,
        &request.database,
    )
    .await?;

    let uuid = Uuid::new_v4().to_string();
    let data = ConnectionFormData {
        connection_type: request.engine.db_type().to_string(),
        name: name.to_string(),
        host: request.host,
        port: request.port,
        database: request.database,
        username: request.username,
        password: request.password,
        ssl: false,
        db_type: request.engine.db_type().to_string(),
        file_path: None,
        ssh_enabled: false,
        ssh_host: String::new(),
        ssh_port: 22,
        ssh_user: String::new(),
        ssh_password: String::new(),
        ssh_key_path: String::new(),
        ssh_use_key: false,
    };
    let link = DockerLink {
        connection_uuid: uuid.clone(),
        ownership: DockerOwnership::Linked.as_str().to_string(),
        docker_context: context,
        container_id: draft.container_id,
        container_name: draft.container_name,
        engine: request.engine.db_type().to_string(),
        image: draft.image,
        internal_port: request.engine.internal_port(),
        compose_project: draft.compose_project,
        compose_service: draft.compose_service,
        volume_name: None,
    };
    store::insert_connection_with_link(pool.inner(), &uuid, &data, &link).await
}

struct ResolvedContainer {
    id: String,
    inspect: ContainerInspect,
}

async fn resolve_container(
    pool: &SqlitePool,
    link: &DockerLink,
) -> Result<ResolvedContainer, String> {
    let context = cli::current_context().await?;
    resolve_container_in_context(pool, link, &context).await
}

async fn resolve_container_in_context(
    pool: &SqlitePool,
    link: &DockerLink,
    context: &str,
) -> Result<ResolvedContainer, String> {
    if !link.docker_context.is_empty() && context != link.docker_context {
        return Err(format!(
            "This connection belongs to Docker context '{}'. Switch contexts or relink it.",
            link.docker_context
        ));
    }
    if let Ok(inspect) = cli::inspect(&link.container_id).await {
        if link.ownership()? == DockerOwnership::Created
            && !managed_container_matches(link, &inspect.config.labels)
        {
            return Err(
                "The saved container identity no longer matches this connection".to_string(),
            );
        }
        return Ok(ResolvedContainer {
            id: inspect.id.clone(),
            inspect,
        });
    }

    let inspect = match link.ownership()? {
        DockerOwnership::Created => {
            let labels = cli::managed_connection_labels(&link.connection_uuid);
            cli::find_one_by_labels(&labels).await?
        }
        DockerOwnership::Linked => match (&link.compose_project, &link.compose_service) {
            (Some(project), Some(service)) => {
                cli::find_one_by_labels(&[
                    ("com.docker.compose.project", project),
                    ("com.docker.compose.service", service),
                ])
                .await?
            }
            _ => None,
        },
    }
    .ok_or_else(|| "Docker container is missing. Relink this connection.".to_string())?;

    store::update_runtime_identity(pool, &link.connection_uuid, &inspect.id, inspect.name())
        .await?;
    Ok(ResolvedContainer {
        id: inspect.id.clone(),
        inspect,
    })
}

pub async fn ensure_created_connection_running(
    pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    let Some(link) = store::get_link(pool, uuid).await? else {
        return Ok(());
    };
    if link.ownership()? != DockerOwnership::Created {
        return Ok(());
    }
    let mut container = resolve_container(pool, &link).await?;
    if !container.inspect.state.running {
        cli::short(&["start", &container.id]).await?;
        container.inspect = cli::inspect(&container.id).await?;
    }
    if let Some(port) = container.inspect.host_port(link.internal_port) {
        store::update_connection_port(pool, uuid, port).await?;
    }
    let connection: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(uuid)
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    let engine = DockerDatabaseEngine::from_db_type(&connection.db_type)
        .ok_or_else(|| "Unsupported managed database type".to_string())?;
    cli::wait_until_ready(
        &container.id,
        engine,
        &connection.username,
        &connection.password,
        &connection.database,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn docker_connection_states(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DockerConnectionState>, String> {
    let links = store::get_links(pool.inner()).await?;
    if links.is_empty() {
        return Ok(Vec::new());
    }
    let context = match tokio::try_join!(cli::current_context(), cli::daemon_version()) {
        Ok((context, _)) => context,
        Err(_) => {
            return links
                .into_iter()
                .map(|link| {
                    let ownership = link.ownership()?;
                    Ok(DockerConnectionState {
                        connection_uuid: link.connection_uuid,
                        ownership,
                        container_name: link.container_name,
                        status: DockerConnectionStatus::Unavailable,
                    })
                })
                .collect()
        }
    };
    let pool = pool.inner().clone();
    let states = stream::iter(links)
        .map(|link| {
            let pool = pool.clone();
            let context = context.clone();
            async move {
                let ownership = link.ownership()?;
                let status = match resolve_container_in_context(&pool, &link, &context).await {
                    Ok(container) if container.inspect.state.running => {
                        DockerConnectionStatus::Running
                    }
                    Ok(_) => DockerConnectionStatus::Stopped,
                    Err(_) => DockerConnectionStatus::Missing,
                };
                Ok(DockerConnectionState {
                    connection_uuid: link.connection_uuid,
                    ownership,
                    container_name: link.container_name,
                    status,
                })
            }
        })
        .buffer_unordered(8)
        .collect::<Vec<Result<DockerConnectionState, String>>>()
        .await;
    states.into_iter().collect()
}

#[tauri::command]
pub async fn docker_control_connection(
    pool: State<'_, SqlitePool>,
    uuid: String,
    action: DockerOperation,
) -> Result<(), String> {
    let link = store::get_link(pool.inner(), &uuid)
        .await?
        .ok_or_else(|| "Connection is not linked to Docker".to_string())?;
    let container = resolve_container(pool.inner(), &link).await?;
    cli::short(&[action.command(), &container.id])
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn docker_get_connection_string(
    pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<String, String> {
    let connection: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(pool.inner())
        .await
        .map_err(|error| error.to_string())?;
    let engine = DockerDatabaseEngine::from_db_type(&connection.db_type)
        .ok_or_else(|| "Connection is not supported by Docker management".to_string())?;
    store::get_link(pool.inner(), &uuid)
        .await?
        .ok_or_else(|| "Connection is not linked to Docker".to_string())?;
    Ok(connection_string(
        engine,
        &connection.host,
        &connection.username,
        &connection.password,
        connection.port,
        &connection.database,
    ))
}

pub async fn delete_saved_connection(
    pool: &SqlitePool,
    id: i64,
    delete_docker_data: bool,
) -> Result<DeleteConnectionResult, String> {
    let link = store::delete_connection_with_link(pool, id).await?;
    let docker_cleanup_warning = match (link, delete_docker_data) {
        (Some(link), true) => cleanup_linked_resources(pool, &link).await.err(),
        _ => None,
    };
    Ok(DeleteConnectionResult {
        deleted: true,
        docker_cleanup_warning,
    })
}

async fn cleanup_linked_resources(pool: &SqlitePool, link: &DockerLink) -> Result<(), String> {
    let container = resolve_container(pool, link).await?;
    match link.ownership()? {
        DockerOwnership::Created => {
            let volume = link
                .volume_name
                .as_deref()
                .ok_or_else(|| "Managed database volume is missing".to_string())?;
            cli::remove_created(&container.id, volume).await
        }
        DockerOwnership::Linked => cli::short(&["rm", "-f", "-v", &container.id])
            .await
            .map(|_| ()),
    }
}

pub async fn stop_created_databases(pool: &SqlitePool) {
    let Ok(links) = store::get_created_links(pool).await else {
        return;
    };
    let Ok(context) = cli::current_context().await else {
        return;
    };
    let container_ids = links
        .into_iter()
        .filter(|link| link.docker_context.is_empty() || link.docker_context == context)
        .map(|link| link.container_id)
        .collect::<Vec<_>>();
    let _ = cli::stop_containers(&container_ids).await;
}
