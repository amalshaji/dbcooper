#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docker_logs_are_preferred_without_exposing_container_identity() {
        let capabilities = capabilities_for(ObservabilityEngine::Postgres, true);

        assert_eq!(capabilities[0].id, "docker");
        assert_eq!(
            capabilities[0].availability,
            ObservabilityAvailability::Available
        );
        assert!(capabilities.iter().all(|capability| {
            !capability.id.contains("container")
                && !capability.label.to_lowercase().contains("container")
        }));
    }

    #[test]
    fn unsupported_engines_are_reported_conservatively() {
        for engine in [ObservabilityEngine::Sqlite, ObservabilityEngine::D1] {
            let capabilities = capabilities_for(engine, false);

            assert!(capabilities.iter().all(|capability| {
                capability.availability == ObservabilityAvailability::Unavailable
            }));
        }
    }

    #[test]
    fn stateful_or_privileged_sources_are_conservative() {
        let duckdb = capabilities_for(ObservabilityEngine::Duckdb, false);
        assert_eq!(
            duckdb[0].availability,
            ObservabilityAvailability::Unavailable
        );

        let mongodb = capabilities_for(ObservabilityEngine::Mongodb, false);
        let mongo_activity = mongodb
            .iter()
            .find(|source| source.id == "activity")
            .unwrap();
        assert_eq!(
            mongo_activity.availability,
            ObservabilityAvailability::Degraded
        );
        assert!(mongo_activity
            .reason
            .as_deref()
            .unwrap()
            .contains("privilege"));

        let redis = capabilities_for(ObservabilityEngine::Redis, false);
        let slowlog = redis.iter().find(|source| source.id == "slowlog").unwrap();
        assert_eq!(slowlog.availability, ObservabilityAvailability::Degraded);
        assert!(slowlog.reason.as_deref().unwrap().contains("privilege"));
    }

    #[test]
    fn untrusted_lines_are_utf8_safely_bounded() {
        let oversized = format!("{}unsafe", "🧪".repeat(MAX_ENTRY_BYTES));
        let bounded = bound_text(&oversized);

        assert!(bounded.len() <= MAX_ENTRY_BYTES);
        assert!(bounded.ends_with(TRUNCATION_MARKER));
        assert!(std::str::from_utf8(bounded.as_bytes()).is_ok());
    }

    #[test]
    fn overlapping_polls_only_emit_the_new_suffix() {
        let previous = vec!["a".to_string(), "same".to_string(), "same".to_string()];
        let current = vec!["same".to_string(), "same".to_string(), "new".to_string()];

        assert_eq!(new_suffix(&previous, &current), &["new".to_string()]);
    }
}
use serde::{Deserialize, Serialize};

pub const MAX_ENTRY_BYTES: usize = 16 * 1024;
pub const MAX_SNAPSHOT_ENTRIES: usize = 200;
pub const TRUNCATION_MARKER: &str = "… [truncated]";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservabilityEngine {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
    Duckdb,
    Redis,
    Clickhouse,
    D1,
    Mongodb,
}

impl TryFrom<&str> for ObservabilityEngine {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value.to_ascii_lowercase().as_str() {
            "postgres" | "postgresql" => Ok(Self::Postgres),
            "mysql" => Ok(Self::Mysql),
            "mariadb" => Ok(Self::Mariadb),
            "sqlite" | "sqlite3" => Ok(Self::Sqlite),
            "duckdb" => Ok(Self::Duckdb),
            "redis" => Ok(Self::Redis),
            "clickhouse" => Ok(Self::Clickhouse),
            "d1" | "cloudflare-d1" => Ok(Self::D1),
            "mongodb" | "mongo" => Ok(Self::Mongodb),
            _ => Err("This database type does not support observability".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservabilityMode {
    Logs,
    Activity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservabilityAvailability {
    Available,
    Degraded,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservabilitySourceCapability {
    pub id: String,
    pub label: String,
    pub modes: Vec<ObservabilityMode>,
    pub availability: ObservabilityAvailability,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservabilityEntryKind {
    Line,
    Activity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservabilityLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservabilityEntry {
    pub id: String,
    pub kind: ObservabilityEntryKind,
    pub raw: String,
    pub timestamp: Option<String>,
    pub level: ObservabilityLevel,
    pub message: String,
    pub context: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObservabilityStopReason {
    Requested,
    Disconnected,
    SourceEnded,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ObservabilityStreamEvent {
    Snapshot {
        stream_id: String,
        entries: Vec<ObservabilityEntry>,
    },
    Error {
        stream_id: Option<String>,
        code: String,
        message: String,
        recoverable: bool,
    },
    Stopped {
        stream_id: String,
        reason: ObservabilityStopReason,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartObservabilityStreamResponse {
    pub stream_id: String,
}

fn capability(
    id: &str,
    label: &str,
    mode: ObservabilityMode,
    availability: ObservabilityAvailability,
    reason: Option<&str>,
) -> ObservabilitySourceCapability {
    ObservabilitySourceCapability {
        id: id.to_string(),
        label: label.to_string(),
        modes: vec![mode],
        availability,
        reason: reason.map(str::to_string),
    }
}

fn docker_capability(has_docker_link: bool) -> ObservabilitySourceCapability {
    capability(
        "docker",
        "Docker logs",
        ObservabilityMode::Logs,
        if has_docker_link {
            ObservabilityAvailability::Available
        } else {
            ObservabilityAvailability::Unavailable
        },
        (!has_docker_link).then_some("No DBcooper-linked Docker container"),
    )
}

pub fn capabilities_for(
    engine: ObservabilityEngine,
    has_docker_link: bool,
) -> Vec<ObservabilitySourceCapability> {
    let activity = || {
        capability(
            "activity",
            "Current activity",
            ObservabilityMode::Activity,
            ObservabilityAvailability::Available,
            None,
        )
    };
    match engine {
        ObservabilityEngine::Postgres | ObservabilityEngine::Mysql => vec![
            docker_capability(has_docker_link),
            capability(
                "server-log",
                "Server log",
                ObservabilityMode::Logs,
                ObservabilityAvailability::Degraded,
                Some("Availability depends on server configuration and privileges"),
            ),
            activity(),
        ],
        ObservabilityEngine::Mariadb => vec![docker_capability(has_docker_link), activity()],
        ObservabilityEngine::Clickhouse => vec![
            docker_capability(has_docker_link),
            capability(
                "server-log",
                "Server text log",
                ObservabilityMode::Logs,
                ObservabilityAvailability::Degraded,
                Some("The system.text_log table must be enabled and readable"),
            ),
            activity(),
        ],
        ObservabilityEngine::Mongodb => vec![
            docker_capability(has_docker_link),
            capability(
                "database-log",
                "Database log",
                ObservabilityMode::Logs,
                ObservabilityAvailability::Degraded,
                Some("The getLog privilege is required"),
            ),
            capability(
                "activity",
                "Current activity",
                ObservabilityMode::Activity,
                ObservabilityAvailability::Degraded,
                Some("The legacy currentOp command depends on cluster privileges"),
            ),
        ],
        ObservabilityEngine::Redis => vec![
            docker_capability(has_docker_link),
            capability(
                "slowlog",
                "Slow log",
                ObservabilityMode::Activity,
                ObservabilityAvailability::Degraded,
                Some("Availability depends on SLOWLOG privileges and server configuration"),
            ),
            capability(
                "monitor",
                "MONITOR",
                ObservabilityMode::Activity,
                ObservabilityAvailability::Unavailable,
                Some("MONITOR requires a dedicated connection and is not available in this build"),
            ),
        ],
        ObservabilityEngine::Duckdb => vec![capability(
            "duckdb-log",
            "DuckDB logging",
            ObservabilityMode::Logs,
            ObservabilityAvailability::Unavailable,
            Some("Live logging would mutate session-global DuckDB logger state"),
        )],
        ObservabilityEngine::Sqlite | ObservabilityEngine::D1 => vec![
            capability(
                "server-log",
                "Server log",
                ObservabilityMode::Logs,
                ObservabilityAvailability::Unavailable,
                Some("Live logs are not available for this database"),
            ),
            capability(
                "activity",
                "Current activity",
                ObservabilityMode::Activity,
                ObservabilityAvailability::Unavailable,
                Some("Live activity is not available for this database"),
            ),
        ],
    }
}

pub fn bound_text(value: &str) -> String {
    if value.len() <= MAX_ENTRY_BYTES {
        return value.to_string();
    }
    let mut end = MAX_ENTRY_BYTES.saturating_sub(TRUNCATION_MARKER.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], TRUNCATION_MARKER)
}

pub fn new_suffix<'a, T: PartialEq>(previous: &[T], current: &'a [T]) -> &'a [T] {
    let overlap = (0..=previous.len().min(current.len()))
        .rev()
        .find(|&length| previous[previous.len() - length..] == current[..length])
        .unwrap_or(0);
    &current[overlap..]
}
