use super::model::{
    detect_engine, DockerContainerSummary, DockerDatabaseEngine, CONNECTION_LABEL_KEY,
    MANAGED_LABEL_KEY,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const CREATE_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Deserialize)]
struct ContainerListRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    name: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Ports", default)]
    ports: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct ContainerConfig {
    #[serde(rename = "Image", default)]
    pub(crate) image: String,
    #[serde(rename = "Env", default)]
    pub(crate) env: Vec<String>,
    #[serde(rename = "Cmd", default)]
    pub(crate) command: Vec<String>,
    #[serde(rename = "Labels", default)]
    pub(crate) labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct ContainerState {
    #[serde(rename = "Running", default)]
    pub(crate) running: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct PortBinding {
    #[serde(rename = "HostPort", default)]
    host_port: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct NetworkSettings {
    #[serde(rename = "Ports", default)]
    ports: HashMap<String, Option<Vec<PortBinding>>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct ContainerInspect {
    #[serde(rename = "Id", default)]
    pub(crate) id: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Config", default)]
    pub(crate) config: ContainerConfig,
    #[serde(rename = "State", default)]
    pub(crate) state: ContainerState,
    #[serde(rename = "NetworkSettings", default)]
    network_settings: NetworkSettings,
}

impl ContainerInspect {
    pub(crate) fn name(&self) -> &str {
        self.name.trim_start_matches('/')
    }

    pub(crate) fn exposed_ports(&self) -> Vec<i64> {
        self.network_settings
            .ports
            .keys()
            .filter_map(|port| port.split('/').next()?.parse().ok())
            .collect()
    }

    pub(crate) fn host_port(&self, internal_port: i64) -> Option<i64> {
        self.network_settings
            .ports
            .get(&format!("{internal_port}/tcp"))?
            .as_ref()?
            .first()?
            .host_port
            .parse()
            .ok()
    }

    pub(crate) fn env(&self) -> HashMap<String, String> {
        self.config
            .env
            .iter()
            .filter_map(|entry| entry.split_once('='))
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    pub(crate) fn command_option(&self, option: &str) -> String {
        self.config
            .command
            .windows(2)
            .find(|pair| pair[0] == option)
            .map(|pair| pair[1].clone())
            .unwrap_or_default()
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

pub(crate) async fn command(args: &[String], timeout: Duration) -> Result<String, String> {
    let mut process = Command::new(docker_path()?);
    process.args(args).kill_on_drop(true);
    let child = process.output();
    let output = tokio::time::timeout(timeout, child)
        .await
        .map_err(|_| {
            format!(
                "Docker command timed out after {} seconds",
                timeout.as_secs()
            )
        })?
        .map_err(|error| format!("Failed to run Docker: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr);
        Err(message.trim().to_string())
    }
}

pub(crate) async fn short(args: &[&str]) -> Result<String, String> {
    let args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    command(&args, DEFAULT_COMMAND_TIMEOUT).await
}

pub(crate) async fn create(args: &[String]) -> Result<String, String> {
    command(args, CREATE_COMMAND_TIMEOUT).await
}

pub(crate) async fn current_context() -> Result<String, String> {
    short(&["context", "show"]).await
}

pub(crate) async fn daemon_version() -> Result<String, String> {
    short(&["version", "--format", "{{.Server.Version}}"]).await
}

pub(crate) async fn list_containers() -> Result<Vec<DockerContainerSummary>, String> {
    let output = short(&["ps", "-a", "--format", "{{json .}}"]).await?;
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let row: ContainerListRow = serde_json::from_str(line)
                .map_err(|error| format!("Docker returned invalid container data: {error}"))?;
            let ports = container_ports(&row.ports);
            let engine = detect_engine(&row.image, &ports);
            Ok(DockerContainerSummary {
                id: row.id,
                name: row.name,
                image: row.image,
                state: row.state,
                compatible: engine.is_some(),
                engine,
            })
        })
        .collect()
}

fn container_ports(value: &str) -> Vec<i64> {
    value
        .split(',')
        .filter_map(|binding| {
            let container = binding
                .trim()
                .rsplit_once("->")
                .map_or(binding, |(_, port)| port);
            container.split('/').next()?.trim().parse().ok()
        })
        .collect()
}

pub(crate) async fn inspect(container_id: &str) -> Result<ContainerInspect, String> {
    if container_id.trim().is_empty() {
        return Err("Container id is required".to_string());
    }
    let output = short(&["inspect", container_id]).await?;
    serde_json::from_str::<Vec<ContainerInspect>>(&output)
        .map_err(|error| format!("Docker returned invalid container data: {error}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "Container was not found".to_string())
}

pub(crate) async fn find_one_by_labels(
    labels: &[(&str, &str)],
) -> Result<Option<ContainerInspect>, String> {
    let mut args = vec![
        "ps".to_string(),
        "-aq".to_string(),
        "--no-trunc".to_string(),
    ];
    for (key, value) in labels {
        args.extend(["--filter".to_string(), format!("label={key}={value}")]);
    }
    let output = command(&args, DEFAULT_COMMAND_TIMEOUT).await?;
    let ids = output
        .lines()
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    match ids.as_slice() {
        [] => Ok(None),
        [id] => inspect(id).await.map(Some),
        _ => Err("More than one Docker container matches this connection".to_string()),
    }
}

pub(crate) async fn env_value(
    container_id: &str,
    env: &HashMap<String, String>,
    key: &str,
) -> Result<String, String> {
    if let Some(value) = env.get(key) {
        return Ok(value.clone());
    }
    let file_key = format!("{key}_FILE");
    match env.get(&file_key) {
        Some(path) => short(&["exec", container_id, "cat", path]).await,
        None => Ok(String::new()),
    }
}

pub(crate) async fn wait_until_ready(
    container_id: &str,
    engine: DockerDatabaseEngine,
    username: &str,
    password: &str,
    database: &str,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
    loop {
        let args = match engine {
            DockerDatabaseEngine::Postgres => vec![
                "exec",
                container_id,
                "pg_isready",
                "-U",
                username,
                "-d",
                database,
            ],
            DockerDatabaseEngine::Redis => vec![
                "exec",
                container_id,
                "redis-cli",
                "--user",
                username,
                "-a",
                password,
                "ping",
            ],
            DockerDatabaseEngine::Clickhouse => vec![
                "exec",
                container_id,
                "clickhouse-client",
                "--user",
                username,
                "--password",
                password,
                "--database",
                database,
                "--query",
                "SELECT 1",
            ],
        };
        if short(&args).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("The database did not become ready within 45 seconds".to_string());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

pub(crate) async fn remove_created(container_id: &str, volume_name: &str) -> Result<(), String> {
    let container_result = short(&["rm", "-f", container_id]).await;
    let volume_result = short(&["volume", "rm", volume_name]).await;
    match (container_result, volume_result) {
        (Ok(_), Ok(_)) => Ok(()),
        (Err(container), Ok(_)) => Err(container),
        (Ok(_), Err(volume)) => Err(volume),
        (Err(container), Err(volume)) => Err(format!("{container}; {volume}")),
    }
}

pub(crate) async fn stop_containers(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut args = vec!["stop".to_string(), "--time".to_string(), "5".to_string()];
    args.extend_from_slice(ids);
    command(&args, Duration::from_secs(15)).await.map(|_| ())
}

pub(crate) fn managed_connection_labels(uuid: &str) -> [(&str, &str); 2] {
    [(MANAGED_LABEL_KEY, "true"), (CONNECTION_LABEL_KEY, uuid)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_container_ports_without_matching_host_port_substrings() {
        assert_eq!(
            container_ports("127.0.0.1:55432->5432/tcp, 6379/tcp"),
            vec![5432, 6379]
        );
        assert_eq!(container_ports("127.0.0.1:15432->80/tcp"), vec![80]);
    }
}
