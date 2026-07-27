use crate::db::models::ConnectionFormData;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;
use uuid::Uuid;

pub(crate) const DEFAULT_HOST: &str = "127.0.0.1";
pub(crate) const MANAGED_LABEL_KEY: &str = "com.dbcooper.managed";
pub(crate) const CONNECTION_LABEL_KEY: &str = "com.dbcooper.connection";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerDatabaseEngine {
    Postgres,
    Mysql,
    Mariadb,
    Redis,
    Clickhouse,
}

impl DockerDatabaseEngine {
    pub(crate) fn db_type(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
            Self::Mariadb => "mariadb",
            Self::Redis => "redis",
            Self::Clickhouse => "clickhouse",
        }
    }

    pub(crate) fn internal_port(self) -> i64 {
        match self {
            Self::Postgres => 5432,
            Self::Mysql | Self::Mariadb => 3306,
            Self::Redis => 6379,
            Self::Clickhouse => 8123,
        }
    }

    pub(crate) fn image(self) -> &'static str {
        match self {
            Self::Postgres => "postgres:17-alpine",
            Self::Mysql => "mysql:8.4",
            Self::Mariadb => "mariadb:11.4",
            Self::Redis => "redis:7-alpine",
            Self::Clickhouse => "clickhouse/clickhouse-server:25.8-alpine",
        }
    }

    pub(crate) fn volume_path(self) -> &'static str {
        match self {
            Self::Postgres => "/var/lib/postgresql/data",
            Self::Mysql | Self::Mariadb => "/var/lib/mysql",
            Self::Redis => "/data",
            Self::Clickhouse => "/var/lib/clickhouse",
        }
    }

    pub(crate) fn defaults(self) -> (&'static str, &'static str) {
        match self {
            Self::Postgres => ("postgres", "postgres"),
            Self::Mysql | Self::Mariadb => ("dbcooper", "root"),
            Self::Redis => ("0", "default"),
            Self::Clickhouse => ("default", "default"),
        }
    }

    pub(crate) fn from_db_type(value: &str) -> Option<Self> {
        match value {
            "postgres" | "postgresql" => Some(Self::Postgres),
            "mysql" => Some(Self::Mysql),
            "mariadb" => Some(Self::Mariadb),
            "redis" => Some(Self::Redis),
            "clickhouse" => Some(Self::Clickhouse),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerOperation {
    Start,
    Stop,
    Restart,
}

impl DockerOperation {
    pub(crate) fn command(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerOwnership {
    Created,
    Linked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerConnectionStatus {
    Running,
    Stopped,
    Missing,
    Unavailable,
}

impl DockerOwnership {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Linked => "linked",
        }
    }
}

impl TryFrom<&str> for DockerOwnership {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "created" => Ok(Self::Created),
            "linked" => Ok(Self::Linked),
            _ => Err(format!("Unsupported Docker ownership: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub detection: DockerEngineDetection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DockerEngineDetection {
    Unsupported,
    Detected { engine: DockerDatabaseEngine },
    Ambiguous { engines: [DockerDatabaseEngine; 2] },
}

impl DockerEngineDetection {
    pub(crate) fn resolve(
        &self,
        selected: Option<DockerDatabaseEngine>,
    ) -> Result<DockerDatabaseEngine, String> {
        match (self, selected) {
            (Self::Detected { engine }, None) => Ok(*engine),
            (Self::Detected { engine }, Some(selected)) if selected == *engine => Ok(*engine),
            (Self::Ambiguous { engines }, Some(selected)) if engines.contains(&selected) => {
                Ok(selected)
            }
            (Self::Unsupported, _) => Err("This container is not a supported database".to_string()),
            (Self::Ambiguous { .. }, None) => {
                Err("Choose whether this port 3306 container is MySQL or MariaDB".to_string())
            }
            _ => Err("The selected database type does not match the container".to_string()),
        }
    }
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
pub struct DockerConnectionState {
    pub connection_uuid: String,
    pub ownership: DockerOwnership,
    pub container_name: String,
    pub status: DockerConnectionStatus,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DockerLink {
    pub(crate) connection_uuid: String,
    pub(crate) ownership: String,
    pub(crate) docker_context: String,
    pub(crate) container_id: String,
    pub(crate) container_name: String,
    pub(crate) engine: String,
    pub(crate) image: String,
    pub(crate) internal_port: i64,
    pub(crate) compose_project: Option<String>,
    pub(crate) compose_service: Option<String>,
    pub(crate) volume_name: Option<String>,
}

impl DockerLink {
    pub(crate) fn ownership(&self) -> Result<DockerOwnership, String> {
        DockerOwnership::try_from(self.ownership.as_str())
    }
}

pub(crate) struct ManagedDatabasePlan {
    pub(crate) uuid: String,
    pub(crate) container_name: String,
    pub(crate) volume_name: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) database: String,
    pub(crate) engine: DockerDatabaseEngine,
    pub(crate) run_args: Vec<String>,
}

impl ManagedDatabasePlan {
    pub(crate) fn new(engine: DockerDatabaseEngine) -> Self {
        let uuid = Uuid::new_v4().to_string();
        let suffix = &uuid[..8];
        let container_name = format!("dbcooper-{}-{suffix}", engine.db_type());
        let volume_name = format!("dbcooper-{uuid}-data");
        let password = Uuid::new_v4().simple().to_string();
        let username = if engine == DockerDatabaseEngine::Redis {
            "default"
        } else {
            "dbcooper"
        }
        .to_string();
        let database = if engine == DockerDatabaseEngine::Redis {
            "0"
        } else {
            "dbcooper"
        }
        .to_string();
        let mut run_args = vec![
            "run".to_string(),
            "-d".to_string(),
            "--name".to_string(),
            container_name.clone(),
            "--label".to_string(),
            format!("{MANAGED_LABEL_KEY}=true"),
            "--label".to_string(),
            format!("{CONNECTION_LABEL_KEY}={uuid}"),
            "-p".to_string(),
            format!("{DEFAULT_HOST}::{}", engine.internal_port()),
            "-v".to_string(),
            format!("{volume_name}:{}", engine.volume_path()),
        ];
        match engine {
            DockerDatabaseEngine::Postgres => run_args.extend([
                "-e".into(),
                format!("POSTGRES_USER={username}"),
                "-e".into(),
                format!("POSTGRES_PASSWORD={password}"),
                "-e".into(),
                format!("POSTGRES_DB={database}"),
            ]),
            DockerDatabaseEngine::Mysql => run_args.extend([
                "-e".into(),
                format!("MYSQL_USER={username}"),
                "-e".into(),
                format!("MYSQL_PASSWORD={password}"),
                "-e".into(),
                format!("MYSQL_DATABASE={database}"),
                "-e".into(),
                format!("MYSQL_ROOT_PASSWORD={password}"),
            ]),
            DockerDatabaseEngine::Mariadb => run_args.extend([
                "-e".into(),
                format!("MARIADB_USER={username}"),
                "-e".into(),
                format!("MARIADB_PASSWORD={password}"),
                "-e".into(),
                format!("MARIADB_DATABASE={database}"),
                "-e".into(),
                format!("MARIADB_ROOT_PASSWORD={password}"),
            ]),
            DockerDatabaseEngine::Redis => {}
            DockerDatabaseEngine::Clickhouse => run_args.extend([
                "-e".into(),
                format!("CLICKHOUSE_USER={username}"),
                "-e".into(),
                format!("CLICKHOUSE_PASSWORD={password}"),
                "-e".into(),
                format!("CLICKHOUSE_DB={database}"),
                "-e".into(),
                "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1".into(),
            ]),
        }
        run_args.push(engine.image().to_string());
        if engine == DockerDatabaseEngine::Redis {
            run_args.extend([
                "redis-server".into(),
                "--appendonly".into(),
                "yes".into(),
                "--requirepass".into(),
                password.clone(),
            ]);
        }
        Self {
            uuid,
            container_name,
            volume_name,
            username,
            password,
            database,
            engine,
            run_args,
        }
    }

    pub(crate) fn connection_data(&self, name: &str, port: i64) -> ConnectionFormData {
        ConnectionFormData {
            connection_type: self.engine.db_type().to_string(),
            name: name.to_string(),
            host: DEFAULT_HOST.to_string(),
            port,
            database: self.database.clone(),
            username: self.username.clone(),
            password: self.password.clone(),
            ssl: false,
            db_type: self.engine.db_type().to_string(),
            file_path: None,
            ssh_enabled: false,
            ssh_host: String::new(),
            ssh_port: 22,
            ssh_user: String::new(),
            ssh_password: String::new(),
            ssh_key_path: String::new(),
            ssh_use_key: false,
        }
    }

    pub(crate) fn link(&self, context: String, container_id: String) -> DockerLink {
        DockerLink {
            connection_uuid: self.uuid.clone(),
            ownership: DockerOwnership::Created.as_str().to_string(),
            docker_context: context,
            container_id,
            container_name: self.container_name.clone(),
            engine: self.engine.db_type().to_string(),
            image: self.engine.image().to_string(),
            internal_port: self.engine.internal_port(),
            compose_project: None,
            compose_service: None,
            volume_name: Some(self.volume_name.clone()),
        }
    }
}

pub(crate) fn detect_engine(image: &str, ports: &[i64]) -> DockerEngineDetection {
    let image = image.to_ascii_lowercase();
    if image.contains("mariadb") {
        DockerEngineDetection::Detected {
            engine: DockerDatabaseEngine::Mariadb,
        }
    } else if image.contains("mysql") {
        DockerEngineDetection::Detected {
            engine: DockerDatabaseEngine::Mysql,
        }
    } else if image.contains("postgres") || ports.contains(&5432) {
        DockerEngineDetection::Detected {
            engine: DockerDatabaseEngine::Postgres,
        }
    } else if image.contains("redis") || ports.contains(&6379) {
        DockerEngineDetection::Detected {
            engine: DockerDatabaseEngine::Redis,
        }
    } else if image.contains("clickhouse") || ports.contains(&8123) {
        DockerEngineDetection::Detected {
            engine: DockerDatabaseEngine::Clickhouse,
        }
    } else if ports.contains(&3306) {
        DockerEngineDetection::Ambiguous {
            engines: [DockerDatabaseEngine::Mysql, DockerDatabaseEngine::Mariadb],
        }
    } else {
        DockerEngineDetection::Unsupported
    }
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

fn authority_host(value: &str) -> String {
    let value = value.trim();
    if value.contains(':') && !(value.starts_with('[') && value.ends_with(']')) {
        format!("[{value}]")
    } else {
        value.to_string()
    }
}

pub(crate) fn connection_string(
    engine: DockerDatabaseEngine,
    host: &str,
    username: &str,
    password: &str,
    port: i64,
    database: &str,
) -> String {
    let host = authority_host(host);
    let user = encode_component(username);
    let password = encode_component(password);
    let database = encode_component(database);
    match engine {
        DockerDatabaseEngine::Postgres => {
            format!("postgresql://{user}:{password}@{host}:{port}/{database}?sslmode=disable")
        }
        DockerDatabaseEngine::Mysql | DockerDatabaseEngine::Mariadb => {
            format!("mysql://{user}:{password}@{host}:{port}/{database}")
        }
        DockerDatabaseEngine::Redis => {
            format!("redis://{user}:{password}@{host}:{port}/{database}")
        }
        DockerDatabaseEngine::Clickhouse => {
            format!("http://{user}:{password}@{host}:{port}/?database={database}")
        }
    }
}

pub(crate) fn managed_container_matches(
    link: &DockerLink,
    labels: &HashMap<String, String>,
) -> bool {
    if labels.get(MANAGED_LABEL_KEY).map(String::as_str) != Some("true") {
        return false;
    }
    match labels.get(CONNECTION_LABEL_KEY) {
        Some(uuid) => uuid == &link.connection_uuid,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_connection_strings_with_the_stored_host() {
        assert_eq!(
            connection_string(
                DockerDatabaseEngine::Postgres,
                "localhost",
                "app user",
                "p@ss/word",
                54321,
                "app db"
            ),
            "postgresql://app%20user:p%40ss%2Fword@localhost:54321/app%20db?sslmode=disable"
        );
        assert_eq!(
            connection_string(
                DockerDatabaseEngine::Postgres,
                "::1",
                "postgres",
                "secret",
                5432,
                "postgres"
            ),
            "postgresql://postgres:secret@[::1]:5432/postgres?sslmode=disable"
        );
    }

    #[test]
    fn managed_plan_labels_the_container_with_connection_identity() {
        let plan = ManagedDatabasePlan::new(DockerDatabaseEngine::Postgres);
        assert!(plan.volume_name.contains(&plan.uuid));
        assert!(plan
            .run_args
            .windows(2)
            .any(|args| args == ["--label", &format!("{CONNECTION_LABEL_KEY}={}", plan.uuid)]));
    }

    #[test]
    fn rejects_a_managed_container_labeled_for_another_connection() {
        let plan = ManagedDatabasePlan::new(DockerDatabaseEngine::Postgres);
        let link = plan.link("desktop-linux".to_string(), "container".to_string());
        let labels = HashMap::from([
            (MANAGED_LABEL_KEY.to_string(), "true".to_string()),
            (
                CONNECTION_LABEL_KEY.to_string(),
                "another-connection".to_string(),
            ),
        ]);
        assert!(!managed_container_matches(&link, &labels));
    }

    #[test]
    fn detects_supported_engines_by_image_or_internal_port() {
        assert_eq!(
            detect_engine("postgres:17-alpine", &[]),
            DockerEngineDetection::Detected {
                engine: DockerDatabaseEngine::Postgres
            }
        );
        assert_eq!(
            detect_engine("my-company/database", &[6379]),
            DockerEngineDetection::Detected {
                engine: DockerDatabaseEngine::Redis
            }
        );
        assert_eq!(
            detect_engine("clickhouse/clickhouse-server:25.8-alpine", &[]),
            DockerEngineDetection::Detected {
                engine: DockerDatabaseEngine::Clickhouse
            }
        );
        assert_eq!(
            detect_engine("my-company/analytics", &[8123]),
            DockerEngineDetection::Detected {
                engine: DockerDatabaseEngine::Clickhouse
            }
        );
        assert_eq!(
            detect_engine("nginx:alpine", &[80]),
            DockerEngineDetection::Unsupported
        );
        assert_eq!(
            detect_engine("company/database", &[3306]),
            DockerEngineDetection::Ambiguous {
                engines: [DockerDatabaseEngine::Mysql, DockerDatabaseEngine::Mariadb]
            }
        );
    }

    #[test]
    fn resolves_only_engines_allowed_by_the_detection_state() {
        let ambiguous = detect_engine("company/database", &[3306]);
        assert_eq!(
            ambiguous.resolve(Some(DockerDatabaseEngine::Mariadb)),
            Ok(DockerDatabaseEngine::Mariadb)
        );
        assert!(ambiguous.resolve(None).is_err());

        let detected = detect_engine("mysql:8.4", &[]);
        assert!(detected
            .resolve(Some(DockerDatabaseEngine::Postgres))
            .is_err());
    }

    #[test]
    fn creates_mysql_family_containers_with_persistent_storage() {
        let mysql = ManagedDatabasePlan::new(DockerDatabaseEngine::Mysql);
        assert!(mysql.run_args.contains(&"mysql:8.4".to_string()));
        assert!(
            mysql
                .run_args
                .windows(2)
                .any(|args| args[0] == "-e"
                    && args[1] == format!("MYSQL_DATABASE={}", mysql.database))
        );
        assert!(mysql
            .run_args
            .windows(2)
            .any(|args| args[0] == "-v"
                && args[1] == format!("{}:/var/lib/mysql", mysql.volume_name)));

        let mariadb = ManagedDatabasePlan::new(DockerDatabaseEngine::Mariadb);
        assert!(mariadb.run_args.contains(&"mariadb:11.4".to_string()));
        assert!(mariadb
            .run_args
            .windows(2)
            .any(|args| args[0] == "-e"
                && args[1] == format!("MARIADB_DATABASE={}", mariadb.database)));
    }

    #[test]
    fn creates_clickhouse_with_http_access_and_persistent_storage() {
        let plan = ManagedDatabasePlan::new(DockerDatabaseEngine::Clickhouse);

        assert_eq!(plan.username, "dbcooper");
        assert_eq!(plan.database, "dbcooper");
        assert!(plan
            .run_args
            .windows(2)
            .any(|args| args == ["-p", "127.0.0.1::8123"]));
        assert!(plan
            .run_args
            .windows(2)
            .any(|args| args == ["-v", &format!("{}:/var/lib/clickhouse", plan.volume_name)]));
        assert!(plan
            .run_args
            .windows(2)
            .any(|args| args == ["-e", "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1"]));
        assert!(plan
            .run_args
            .contains(&"clickhouse/clickhouse-server:25.8-alpine".to_string()));
    }

    #[test]
    fn formats_clickhouse_http_connection_string() {
        assert_eq!(
            connection_string(
                DockerDatabaseEngine::Clickhouse,
                "localhost",
                "app user",
                "p@ss/word",
                18123,
                "analytics db",
            ),
            "http://app%20user:p%40ss%2Fword@localhost:18123/?database=analytics%20db"
        );
    }
}
