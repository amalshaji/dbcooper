use crate::db::models::{Connection, ConnectionFormData};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use tokio::process::Command;
use uuid::Uuid;

const MANAGED_LABEL: &str = "com.dbcooper.managed=true";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerDatabaseEngine {
    Postgres,
    Redis,
    Clickhouse,
}

impl DockerDatabaseEngine {
    fn db_type(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Redis => "redis",
            Self::Clickhouse => "clickhouse",
        }
    }

    fn internal_port(self) -> i64 {
        match self {
            Self::Postgres => 5432,
            Self::Redis => 6379,
            Self::Clickhouse => 8123,
        }
    }

    fn image(self) -> &'static str {
        match self {
            Self::Postgres => "postgres:17-alpine",
            Self::Redis => "redis:7-alpine",
            Self::Clickhouse => "clickhouse/clickhouse-server:25.8-alpine",
        }
    }

    fn volume_path(self) -> &'static str {
        match self {
            Self::Postgres => "/var/lib/postgresql/data",
            Self::Redis => "/data",
            Self::Clickhouse => "/var/lib/clickhouse",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub engine: Option<DockerDatabaseEngine>,
    pub compatible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConnectionDraft {
    pub container_id: String,
    pub container_name: String,
    pub image: String,
    pub engine: DockerDatabaseEngine,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDockerDatabaseRequest {
    pub engine: DockerDatabaseEngine,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkDockerDatabaseRequest {
    pub connection_uuid: Option<String>,
    pub name: String,
    pub container_id: String,
    pub engine: DockerDatabaseEngine,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConnectionState {
    pub connection_uuid: String,
    pub ownership: String,
    pub container_name: String,
    pub status: String,
}

#[derive(Debug, Clone, FromRow)]
struct DockerLink {
    connection_uuid: String,
    ownership: String,
    docker_context: String,
    container_id: String,
    container_name: String,
    engine: String,
    image: String,
    internal_port: i64,
    compose_project: Option<String>,
    compose_service: Option<String>,
    volume_name: Option<String>,
}

fn encode_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

pub fn connection_string(
    engine: DockerDatabaseEngine,
    username: &str,
    password: &str,
    port: i64,
    database: &str,
) -> String {
    let user = encode_component(username);
    let password = encode_component(password);
    let database = encode_component(database);
    match engine {
        DockerDatabaseEngine::Postgres => {
            format!("postgresql://{user}:{password}@127.0.0.1:{port}/{database}?sslmode=disable")
        }
        DockerDatabaseEngine::Redis => {
            format!("redis://{user}:{password}@127.0.0.1:{port}/{database}")
        }
        DockerDatabaseEngine::Clickhouse => {
            format!("http://{user}:{password}@127.0.0.1:{port}/?database={database}")
        }
    }
}

pub fn detect_engine(image: &str, ports: &[i64]) -> Option<DockerDatabaseEngine> {
    let image = image.to_ascii_lowercase();
    if image.contains("postgres") || ports.contains(&5432) {
        Some(DockerDatabaseEngine::Postgres)
    } else if image.contains("redis") || ports.contains(&6379) {
        Some(DockerDatabaseEngine::Redis)
    } else if image.contains("clickhouse") || ports.contains(&8123) {
        Some(DockerDatabaseEngine::Clickhouse)
    } else {
        None
    }
}

fn docker_path() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|path| path.join("docker")));
    }
    candidates.extend(
        [
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "/Applications/Docker.app/Contents/Resources/bin/docker",
            "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".orbstack/bin/docker"));
        candidates.push(home.join(".docker/bin/docker"));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Docker CLI was not found. Install Docker Desktop or OrbStack.".to_string())
}

async fn docker(args: &[&str]) -> Result<String, String> {
    let output = Command::new(docker_path()?)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Failed to run Docker: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr);
        Err(message.trim().to_string())
    }
}

async fn current_context() -> Result<String, String> {
    docker(&["context", "show"]).await
}

fn env_map(inspect: &Value) -> std::collections::HashMap<String, String> {
    inspect["Config"]["Env"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|entry| entry.split_once('='))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

async fn container_env_value(
    container_id: &str,
    env: &std::collections::HashMap<String, String>,
    key: &str,
) -> String {
    if let Some(value) = env.get(key) {
        return value.clone();
    }
    let file_key = format!("{key}_FILE");
    if let Some(path) = env.get(&file_key) {
        return docker(&["exec", container_id, "cat", path])
            .await
            .unwrap_or_default();
    }
    String::new()
}

fn command_option(inspect: &Value, option: &str) -> String {
    let command = inspect["Config"]["Cmd"].as_array();
    command
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .windows(2)
        .find(|pair| pair[0] == option)
        .map(|pair| pair[1].to_string())
        .unwrap_or_default()
}

fn exposed_ports(inspect: &Value) -> Vec<i64> {
    inspect["NetworkSettings"]["Ports"]
        .as_object()
        .into_iter()
        .flat_map(|ports| ports.keys())
        .filter_map(|port| port.split('/').next()?.parse().ok())
        .collect()
}

fn host_port(inspect: &Value, internal_port: i64) -> Option<i64> {
    inspect["NetworkSettings"]["Ports"][format!("{internal_port}/tcp")][0]["HostPort"]
        .as_str()
        .and_then(|port| port.parse().ok())
}

async fn inspect_container(container_id: &str) -> Result<Value, String> {
    if container_id.trim().is_empty() {
        return Err("Container id is required".to_string());
    }
    let output = docker(&["inspect", container_id]).await?;
    serde_json::from_str::<Vec<Value>>(&output)
        .map_err(|error| format!("Docker returned invalid container data: {error}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "Container was not found".to_string())
}

async fn insert_connection(
    pool: &SqlitePool,
    uuid: &str,
    data: &ConnectionFormData,
) -> Result<Connection, String> {
    sqlx::query_as::<_, Connection>(
        r#"INSERT INTO connections
        (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path,
         ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, 0, '', 22, '', '', '', 0)
        RETURNING *"#,
    )
    .bind(uuid)
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(&data.db_type)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())
}

async fn insert_link(pool: &SqlitePool, link: &DockerLink) -> Result<(), String> {
    sqlx::query(
        r#"INSERT INTO docker_connections
        (connection_uuid, ownership, docker_context, container_id, container_name, engine, image,
         internal_port, compose_project, compose_service, volume_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&link.connection_uuid)
    .bind(&link.ownership)
    .bind(&link.docker_context)
    .bind(&link.container_id)
    .bind(&link.container_name)
    .bind(&link.engine)
    .bind(&link.image)
    .bind(link.internal_port)
    .bind(&link.compose_project)
    .bind(&link.compose_service)
    .bind(&link.volume_name)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn docker_list_containers() -> Result<Vec<DockerContainerSummary>, String> {
    let output = docker(&["ps", "-a", "--format", "{{json .}}"]).await?;
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let value: Value = serde_json::from_str(line)
                .map_err(|error| format!("Docker returned invalid container data: {error}"))?;
            let image = value["Image"].as_str().unwrap_or_default().to_string();
            let ports_text = value["Ports"].as_str().unwrap_or_default();
            let ports: Vec<i64> = [5432, 6379, 8123]
                .into_iter()
                .filter(|port| ports_text.contains(&port.to_string()))
                .collect();
            let engine = detect_engine(&image, &ports);
            Ok(DockerContainerSummary {
                id: value["ID"].as_str().unwrap_or_default().to_string(),
                name: value["Names"].as_str().unwrap_or_default().to_string(),
                image,
                state: value["State"].as_str().unwrap_or_default().to_string(),
                compatible: engine.is_some(),
                engine,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn docker_prepare_connection(
    container_id: String,
) -> Result<DockerConnectionDraft, String> {
    let inspect = inspect_container(&container_id).await?;
    let image = inspect["Config"]["Image"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let engine = detect_engine(&image, &exposed_ports(&inspect))
        .ok_or_else(|| "This container is not a supported database".to_string())?;
    let env = env_map(&inspect);
    let labels = inspect["Config"]["Labels"].as_object();
    let (database, username, password) = match engine {
        DockerDatabaseEngine::Postgres => (
            container_env_value(&container_id, &env, "POSTGRES_DB").await,
            container_env_value(&container_id, &env, "POSTGRES_USER").await,
            container_env_value(&container_id, &env, "POSTGRES_PASSWORD").await,
        ),
        DockerDatabaseEngine::Redis => ("0".to_string(), "default".to_string(), {
            let password = container_env_value(&container_id, &env, "REDIS_PASSWORD").await;
            if password.is_empty() {
                command_option(&inspect, "--requirepass")
            } else {
                password
            }
        }),
        DockerDatabaseEngine::Clickhouse => (
            container_env_value(&container_id, &env, "CLICKHOUSE_DB").await,
            container_env_value(&container_id, &env, "CLICKHOUSE_USER").await,
            container_env_value(&container_id, &env, "CLICKHOUSE_PASSWORD").await,
        ),
    };
    let defaults = match engine {
        DockerDatabaseEngine::Postgres => ("postgres", "postgres"),
        DockerDatabaseEngine::Redis => ("0", "default"),
        DockerDatabaseEngine::Clickhouse => ("default", "default"),
    };
    Ok(DockerConnectionDraft {
        container_id,
        container_name: inspect["Name"]
            .as_str()
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string(),
        image,
        engine,
        host: "127.0.0.1".to_string(),
        port: host_port(&inspect, engine.internal_port()).unwrap_or(engine.internal_port()),
        database: if database.is_empty() {
            defaults.0.to_string()
        } else {
            database
        },
        username: if username.is_empty() {
            defaults.1.to_string()
        } else {
            username
        },
        password,
        compose_project: labels
            .and_then(|labels| labels.get("com.docker.compose.project"))
            .and_then(Value::as_str)
            .map(str::to_string),
        compose_service: labels
            .and_then(|labels| labels.get("com.docker.compose.service"))
            .and_then(Value::as_str)
            .map(str::to_string),
    })
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
    let uuid = Uuid::new_v4().to_string();
    let suffix = &uuid[..8];
    let container_name = format!("dbcooper-{}-{suffix}", request.engine.db_type());
    let volume_name = format!("{container_name}-data");
    let password = Uuid::new_v4().simple().to_string();
    let username = if request.engine == DockerDatabaseEngine::Redis {
        "default"
    } else {
        "dbcooper"
    };
    let database = if request.engine == DockerDatabaseEngine::Redis {
        "0"
    } else {
        "dbcooper"
    };
    let port_arg = format!("127.0.0.1::{}", request.engine.internal_port());
    let volume_arg = format!("{volume_name}:{}", request.engine.volume_path());
    let mut args = vec![
        "run".to_string(),
        "-d".to_string(),
        "--name".to_string(),
        container_name.clone(),
        "--label".to_string(),
        MANAGED_LABEL.to_string(),
        "-p".to_string(),
        port_arg,
        "-v".to_string(),
        volume_arg,
    ];
    match request.engine {
        DockerDatabaseEngine::Postgres => {
            args.extend([
                "-e".into(),
                format!("POSTGRES_USER={username}"),
                "-e".into(),
                format!("POSTGRES_PASSWORD={password}"),
                "-e".into(),
                format!("POSTGRES_DB={database}"),
            ]);
        }
        DockerDatabaseEngine::Redis => {}
        DockerDatabaseEngine::Clickhouse => {
            args.extend([
                "-e".into(),
                format!("CLICKHOUSE_USER={username}"),
                "-e".into(),
                format!("CLICKHOUSE_PASSWORD={password}"),
                "-e".into(),
                format!("CLICKHOUSE_DB={database}"),
            ]);
        }
    }
    args.push(request.engine.image().to_string());
    if request.engine == DockerDatabaseEngine::Redis {
        args.extend([
            "redis-server".into(),
            "--appendonly".into(),
            "yes".into(),
            "--requirepass".into(),
            password.clone(),
        ]);
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let container_id = docker(&refs).await?;
    let inspect = match inspect_container(&container_id).await {
        Ok(value) => value,
        Err(error) => {
            let _ = docker(&["rm", "-f", &container_id]).await;
            let _ = docker(&["volume", "rm", &volume_name]).await;
            return Err(error);
        }
    };
    let port = host_port(&inspect, request.engine.internal_port())
        .ok_or_else(|| "Docker did not publish a host port".to_string())?;
    let data = ConnectionFormData {
        connection_type: request.engine.db_type().to_string(),
        name: name.to_string(),
        host: "127.0.0.1".to_string(),
        port,
        database: database.to_string(),
        username: username.to_string(),
        password,
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
    let connection = match insert_connection(pool.inner(), &uuid, &data).await {
        Ok(connection) => connection,
        Err(error) => {
            let _ = docker(&["rm", "-f", &container_id]).await;
            let _ = docker(&["volume", "rm", &volume_name]).await;
            return Err(error);
        }
    };
    let link = DockerLink {
        connection_uuid: uuid.clone(),
        ownership: "created".to_string(),
        docker_context: current_context().await.unwrap_or_default(),
        container_id: container_id.clone(),
        container_name,
        engine: request.engine.db_type().to_string(),
        image: request.engine.image().to_string(),
        internal_port: request.engine.internal_port(),
        compose_project: None,
        compose_service: None,
        volume_name: Some(volume_name),
    };
    if let Err(error) = insert_link(pool.inner(), &link).await {
        let _ = sqlx::query("DELETE FROM connections WHERE uuid = ?")
            .bind(&uuid)
            .execute(pool.inner())
            .await;
        let _ = docker(&["rm", "-f", &container_id]).await;
        if let Some(volume) = &link.volume_name {
            let _ = docker(&["volume", "rm", volume]).await;
        }
        return Err(error);
    }
    for _ in 0..30 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port as u16))
            .await
            .is_ok()
        {
            return Ok(connection);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Ok(connection)
}

#[tauri::command]
pub async fn docker_link_connection(
    pool: State<'_, SqlitePool>,
    request: LinkDockerDatabaseRequest,
) -> Result<Connection, String> {
    if request.name.trim().is_empty() || request.port <= 0 || request.port > 65535 {
        return Err("A name and valid host port are required".to_string());
    }
    let draft = docker_prepare_connection(request.container_id.clone()).await?;
    if draft.engine != request.engine {
        return Err("The selected database type does not match the container".to_string());
    }
    let uuid = request
        .connection_uuid
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let data = ConnectionFormData {
        connection_type: request.engine.db_type().to_string(),
        name: request.name.trim().to_string(),
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
    let connection = if request.connection_uuid.is_some() {
        sqlx::query_as::<_, Connection>(
            r#"UPDATE connections SET type = ?, name = ?, host = ?, port = ?, database = ?,
            username = ?, password = ?, ssl = 0, db_type = ?, file_path = NULL,
            updated_at = datetime('now') WHERE uuid = ? RETURNING *"#,
        )
        .bind(&data.connection_type)
        .bind(&data.name)
        .bind(&data.host)
        .bind(data.port)
        .bind(&data.database)
        .bind(&data.username)
        .bind(&data.password)
        .bind(&data.db_type)
        .bind(&uuid)
        .fetch_one(pool.inner())
        .await
        .map_err(|error| error.to_string())?
    } else {
        insert_connection(pool.inner(), &uuid, &data).await?
    };
    sqlx::query("DELETE FROM docker_connections WHERE connection_uuid = ?")
        .bind(&uuid)
        .execute(pool.inner())
        .await
        .map_err(|error| error.to_string())?;
    insert_link(
        pool.inner(),
        &DockerLink {
            connection_uuid: uuid,
            ownership: "linked".to_string(),
            docker_context: current_context().await.unwrap_or_default(),
            container_id: draft.container_id,
            container_name: draft.container_name,
            engine: request.engine.db_type().to_string(),
            image: draft.image,
            internal_port: request.engine.internal_port(),
            compose_project: draft.compose_project,
            compose_service: draft.compose_service,
            volume_name: None,
        },
    )
    .await?;
    Ok(connection)
}

async fn get_link(pool: &SqlitePool, uuid: &str) -> Result<Option<DockerLink>, String> {
    sqlx::query_as("SELECT * FROM docker_connections WHERE connection_uuid = ?")
        .bind(uuid)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())
}

async fn resolve_container(link: &DockerLink) -> Result<String, String> {
    let context = current_context().await?;
    if !link.docker_context.is_empty() && context != link.docker_context {
        return Err(format!(
            "This connection belongs to Docker context '{}'. Switch contexts or relink it.",
            link.docker_context
        ));
    }
    if inspect_container(&link.container_id).await.is_ok() {
        return Ok(link.container_id.clone());
    }
    if let Ok(inspect) = inspect_container(&link.container_name).await {
        return Ok(inspect["Id"]
            .as_str()
            .unwrap_or(&link.container_name)
            .to_string());
    }
    Err("Docker container is missing. Relink this connection.".to_string())
}

pub async fn ensure_created_connection_running(
    pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    let Some(link) = get_link(pool, uuid).await? else {
        return Ok(());
    };
    if link.ownership != "created" {
        return Ok(());
    }
    let container = resolve_container(&link).await?;
    let inspect = inspect_container(&container).await?;
    if !inspect["State"]["Running"].as_bool().unwrap_or(false) {
        docker(&["start", &container]).await?;
    }
    let inspect = inspect_container(&container).await?;
    if let Some(port) = host_port(&inspect, link.internal_port) {
        sqlx::query("UPDATE connections SET port = ? WHERE uuid = ?")
            .bind(port)
            .bind(uuid)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_connection_states(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DockerConnectionState>, String> {
    let links: Vec<DockerLink> = sqlx::query_as("SELECT * FROM docker_connections")
        .fetch_all(pool.inner())
        .await
        .map_err(|error| error.to_string())?;
    let mut states = Vec::with_capacity(links.len());
    for link in links {
        let status = match resolve_container(&link).await {
            Ok(container) => match inspect_container(&container).await {
                Ok(value) if value["State"]["Running"].as_bool().unwrap_or(false) => "running",
                Ok(_) => "stopped",
                Err(_) => "missing",
            },
            Err(_) => "missing",
        };
        states.push(DockerConnectionState {
            connection_uuid: link.connection_uuid,
            ownership: link.ownership,
            container_name: link.container_name,
            status: status.to_string(),
        });
    }
    Ok(states)
}

#[tauri::command]
pub async fn docker_control_connection(
    pool: State<'_, SqlitePool>,
    uuid: String,
    action: String,
) -> Result<(), String> {
    let link = get_link(pool.inner(), &uuid)
        .await?
        .ok_or_else(|| "Connection is not linked to Docker".to_string())?;
    let container = resolve_container(&link).await?;
    match action.as_str() {
        "start" | "stop" | "restart" => docker(&[&action, &container]).await.map(|_| ()),
        _ => Err("Unsupported Docker action".to_string()),
    }
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
    let engine = match connection.db_type.as_str() {
        "postgres" | "postgresql" => DockerDatabaseEngine::Postgres,
        "redis" => DockerDatabaseEngine::Redis,
        "clickhouse" => DockerDatabaseEngine::Clickhouse,
        _ => return Err("Connection is not supported by Docker management".to_string()),
    };
    get_link(pool.inner(), &uuid)
        .await?
        .ok_or_else(|| "Connection is not linked to Docker".to_string())?;
    Ok(connection_string(
        engine,
        &connection.username,
        &connection.password,
        connection.port,
        &connection.database,
    ))
}

pub async fn remove_docker_resources(
    pool: &SqlitePool,
    uuid: &str,
    delete_data: bool,
) -> Result<(), String> {
    let Some(link) = get_link(pool, uuid).await? else {
        return Ok(());
    };
    if !delete_data {
        return Ok(());
    }
    let container = resolve_container(&link).await?;
    if link.ownership == "created" {
        docker(&["rm", "-f", &container]).await?;
        if let Some(volume) = link.volume_name {
            docker(&["volume", "rm", &volume]).await?;
        }
    } else {
        docker(&["rm", "-f", "-v", &container]).await?;
    }
    Ok(())
}

pub async fn stop_created_databases(pool: &SqlitePool) {
    let links: Vec<DockerLink> =
        sqlx::query_as("SELECT * FROM docker_connections WHERE ownership = 'created'")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    for link in links {
        if let Ok(container) = resolve_container(&link).await {
            let _ = docker(&["stop", "--time", "5", &container]).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_connection_strings_with_encoded_credentials() {
        assert_eq!(
            connection_string(
                DockerDatabaseEngine::Postgres,
                "app user",
                "p@ss/word",
                54321,
                "app db"
            ),
            "postgresql://app%20user:p%40ss%2Fword@127.0.0.1:54321/app%20db?sslmode=disable"
        );
        assert_eq!(
            connection_string(DockerDatabaseEngine::Redis, "default", "secret", 63791, "0"),
            "redis://default:secret@127.0.0.1:63791/0"
        );
        assert_eq!(
            connection_string(
                DockerDatabaseEngine::Clickhouse,
                "default",
                "secret",
                81231,
                "default"
            ),
            "http://default:secret@127.0.0.1:81231/?database=default"
        );
    }

    #[test]
    fn detects_supported_engines_by_image_or_internal_port() {
        assert_eq!(
            detect_engine("postgres:17-alpine", &[]),
            Some(DockerDatabaseEngine::Postgres)
        );
        assert_eq!(
            detect_engine("my-company/database", &[6379]),
            Some(DockerDatabaseEngine::Redis)
        );
        assert_eq!(
            detect_engine("clickhouse/clickhouse-server:25.8-alpine", &[8123]),
            Some(DockerDatabaseEngine::Clickhouse)
        );
        assert_eq!(detect_engine("nginx:alpine", &[80]), None);
    }

    #[test]
    fn reads_redis_password_from_container_command() {
        let inspect = serde_json::json!({
            "Config": {
                "Cmd": ["redis-server", "--appendonly", "yes", "--requirepass", "secret"]
            }
        });

        assert_eq!(command_option(&inspect, "--requirepass"), "secret");
    }
}
