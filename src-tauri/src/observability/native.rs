use super::{
    bound_text, new_suffix, parse_log_entry, ObservabilityEngine, ObservabilityEntry,
    ObservabilityEntryKind, ObservabilityLevel, ObservabilityMode, ObservabilityStreamEvent,
    MAX_SNAPSHOT_ENTRIES,
};
use crate::database::pool_manager::PoolManager;
use serde_json::Value;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::time::{Duration, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const POSTGRES_LOG_QUERY: &str = "SELECT CASE WHEN pg_current_logfile() IS NULL THEN '' ELSE convert_from(pg_read_binary_file(pg_current_logfile(), GREATEST((pg_stat_file(pg_current_logfile())).size - 262144, 0), 262144), current_setting('server_encoding')) END AS message";
const MYSQL_LOG_QUERY: &str = "SELECT LOGGED AS timestamp, PRIO AS severity, ERROR_CODE AS code, SUBSYSTEM AS subsystem, DATA AS message FROM performance_schema.error_log ORDER BY LOGGED DESC LIMIT 200";
const CLICKHOUSE_LOG_QUERY: &str = "SELECT event_time_microseconds AS timestamp, level AS severity, logger_name, message FROM system.text_log ORDER BY event_time_microseconds DESC LIMIT 200";
const POSTGRES_ACTIVITY_QUERY: &str = "SELECT pid, usename AS username, datname AS database, client_addr::text AS client, state, wait_event_type, wait_event, query_start, left(query, 4096) AS query FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY query_start DESC NULLS LAST, pid ASC LIMIT 200";
const MYSQL_ACTIVITY_QUERY: &str = "SELECT ID AS id, USER AS username, HOST AS host, DB AS database, COMMAND AS command, TIME AS seconds, STATE AS state, LEFT(INFO, 4096) AS query FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() ORDER BY TIME DESC, ID ASC LIMIT 200";
const CLICKHOUSE_ACTIVITY_QUERY: &str = "SELECT query_id, user, address, elapsed, read_rows, memory_usage, left(query, 4096) AS query FROM system.processes WHERE query_id != queryID() LIMIT 200";
const REDIS_SLOWLOG_QUERY: &str = "SLOWLOG GET 200";

pub(crate) struct NativeSource<'a> {
    engine: ObservabilityEngine,
    mode: ObservabilityMode,
    id: &'a str,
}

impl<'a> NativeSource<'a> {
    pub(crate) fn new(engine: ObservabilityEngine, mode: ObservabilityMode, id: &'a str) -> Self {
        Self { engine, mode, id }
    }
}

fn fixed_query(
    engine: ObservabilityEngine,
    mode: ObservabilityMode,
    source: &str,
) -> Option<&'static str> {
    match (engine, mode, source) {
        (ObservabilityEngine::Postgres, ObservabilityMode::Logs, "server-log") => {
            Some(POSTGRES_LOG_QUERY)
        }
        (ObservabilityEngine::Mysql, ObservabilityMode::Logs, "server-log") => {
            Some(MYSQL_LOG_QUERY)
        }
        (ObservabilityEngine::Clickhouse, ObservabilityMode::Logs, "server-log") => {
            Some(CLICKHOUSE_LOG_QUERY)
        }
        (ObservabilityEngine::Postgres, ObservabilityMode::Activity, "activity") => {
            Some(POSTGRES_ACTIVITY_QUERY)
        }
        (
            ObservabilityEngine::Mysql | ObservabilityEngine::Mariadb,
            ObservabilityMode::Activity,
            "activity",
        ) => Some(MYSQL_ACTIVITY_QUERY),
        (ObservabilityEngine::Clickhouse, ObservabilityMode::Activity, "activity") => {
            Some(CLICKHOUSE_ACTIVITY_QUERY)
        }
        (ObservabilityEngine::Redis, ObservabilityMode::Activity, "slowlog") => {
            Some(REDIS_SLOWLOG_QUERY)
        }
        _ => None,
    }
}

pub(crate) fn native_source_is_supported(
    engine: ObservabilityEngine,
    mode: ObservabilityMode,
    source: &str,
) -> bool {
    fixed_query(engine, mode, source).is_some()
        || matches!(
            (engine, mode, source),
            (
                ObservabilityEngine::Mongodb,
                ObservabilityMode::Logs,
                "database-log"
            ) | (
                ObservabilityEngine::Mongodb,
                ObservabilityMode::Activity,
                "activity"
            )
        )
}

fn string_field<'a>(row: &'a Value, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| row.get(*name).and_then(Value::as_str))
}

fn normalized_level(value: Option<&str>) -> ObservabilityLevel {
    match value.unwrap_or("").to_ascii_lowercase().as_str() {
        "trace" => ObservabilityLevel::Trace,
        "debug" => ObservabilityLevel::Debug,
        "info" | "information" | "notice" | "note" | "system" => ObservabilityLevel::Info,
        "warn" | "warning" => ObservabilityLevel::Warn,
        "error" | "err" => ObservabilityLevel::Error,
        "fatal" | "critical" | "crit" => ObservabilityLevel::Fatal,
        _ => ObservabilityLevel::Unknown,
    }
}

fn activity_entry_id(engine: ObservabilityEngine, row: &Value) -> Option<String> {
    let (engine, value) = match engine {
        ObservabilityEngine::Postgres => ("postgres", row.get("pid")),
        ObservabilityEngine::Mysql => ("mysql", row.get("id")),
        ObservabilityEngine::Mariadb => ("mariadb", row.get("id")),
        ObservabilityEngine::Clickhouse => ("clickhouse", row.get("query_id")),
        ObservabilityEngine::Redis => ("redis", row.as_array().and_then(|row| row.first())),
        ObservabilityEngine::Mongodb => ("mongodb", row.get("opid")),
        ObservabilityEngine::Sqlite | ObservabilityEngine::Duckdb | ObservabilityEngine::D1 => {
            return None;
        }
    };
    let value = value.filter(|value| !value.is_null())?;
    let value = value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string());
    Some(format!("{engine}:{value}"))
}

fn row_entry(
    engine: ObservabilityEngine,
    row: Value,
    kind: ObservabilityEntryKind,
) -> ObservabilityEntry {
    let raw = match &row {
        Value::String(value) => value.clone(),
        _ => serde_json::to_string(&row).unwrap_or_else(|_| "Unprintable database output".into()),
    };
    let id = if kind == ObservabilityEntryKind::Activity {
        activity_entry_id(engine, &row)
    } else {
        None
    }
    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut entry = parse_log_entry(engine, id, raw, kind);
    if let Some(timestamp) = string_field(&row, &["timestamp", "logged", "query_start"]) {
        entry.timestamp = Some(bound_text(timestamp));
    }
    if let Some(message) = string_field(&row, &["message", "query", "info", "command"]) {
        entry.message = bound_text(message);
    }
    if let Some(raw_level) = string_field(&row, &["severity", "level", "prio"]) {
        entry.level = normalized_level(Some(raw_level));
    }
    entry
}

fn flatten_redis_slowlog(rows: Vec<Value>) -> Vec<Value> {
    match rows.as_slice() {
        [Value::Array(entries)] => entries.clone(),
        _ => rows,
    }
}

async fn fetch_rows(
    pool_manager: &PoolManager,
    connection_uuid: &str,
    engine: ObservabilityEngine,
    mode: ObservabilityMode,
    source: &str,
) -> Result<Vec<Value>, String> {
    if engine == ObservabilityEngine::Mongodb {
        let driver = pool_manager.get_mongo_driver(connection_uuid).await?;
        return match mode {
            ObservabilityMode::Logs => driver.recent_log_events().await,
            ObservabilityMode::Activity => driver.current_activity().await,
        };
    }
    let query = fixed_query(engine, mode, source)
        .ok_or_else(|| "The selected observability source is unavailable".to_string())?;
    let result = pool_manager
        .execute_query_read_only(connection_uuid, query)
        .await?;
    if result.error.is_some() {
        return Err(
            "The selected observability source is unavailable with the current server configuration or privileges"
                .to_string(),
        );
    }
    Ok(if engine == ObservabilityEngine::Redis {
        flatten_redis_slowlog(result.data)
    } else {
        result.data
    })
}

fn send_snapshot(
    channel: &Channel<ObservabilityStreamEvent>,
    stream_id: &str,
    entries: Vec<ObservabilityEntry>,
) -> Result<(), String> {
    channel
        .send(ObservabilityStreamEvent::Snapshot {
            stream_id: stream_id.to_string(),
            entries,
        })
        .map_err(|_| "The observability viewer was closed".to_string())
}

pub(crate) async fn run_native_source(
    pool_manager: Arc<PoolManager>,
    connection_uuid: &str,
    source: NativeSource<'_>,
    stream_id: &str,
    channel: &Channel<ObservabilityStreamEvent>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    let mut previous = Vec::<String>::new();
    let mut initialized = false;
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => return Ok(()),
            _ = ticker.tick() => {
                let fetch = tokio::time::timeout(
                    Duration::from_secs(10),
                    fetch_rows(
                        &pool_manager,
                        connection_uuid,
                        source.engine,
                        source.mode,
                        source.id,
                    ),
                );
                let mut rows = tokio::select! {
                    _ = cancellation.cancelled() => return Ok(()),
                    result = fetch => result
                        .map_err(|_| "The observability source timed out".to_string())??,
                };
                if source.mode == ObservabilityMode::Logs
                    && matches!(
                        source.engine,
                        ObservabilityEngine::Mysql
                            | ObservabilityEngine::Clickhouse
                    )
                {
                    rows.reverse();
                }
                let kind = if source.mode == ObservabilityMode::Logs {
                    ObservabilityEntryKind::Line
                } else {
                    ObservabilityEntryKind::Activity
                };
                let mut entries = if source.engine == ObservabilityEngine::Postgres
                    && source.mode == ObservabilityMode::Logs
                {
                    rows.into_iter()
                        .filter_map(|row| row.get("message").and_then(Value::as_str).map(str::to_string))
                        .flat_map(|text| text.lines().map(str::to_string).collect::<Vec<_>>())
                        .rev()
                        .take(MAX_SNAPSHOT_ENTRIES)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .map(|line| row_entry(source.engine, Value::String(line), kind))
                        .collect::<Vec<_>>()
                } else {
                    rows.into_iter()
                        .take(MAX_SNAPSHOT_ENTRIES)
                        .map(|row| row_entry(source.engine, row, kind))
                        .collect::<Vec<_>>()
                };
                if source.mode == ObservabilityMode::Activity {
                    send_snapshot(channel, stream_id, entries)?;
                } else {
                    let current = entries.iter().map(|entry| entry.raw.clone()).collect::<Vec<_>>();
                    if !initialized {
                        send_snapshot(channel, stream_id, entries)?;
                        initialized = true;
                    } else {
                        let fresh = new_suffix(&previous, &current);
                        let keep = fresh.len();
                        if keep > 0 {
                            entries.drain(..entries.len() - keep);
                            send_snapshot(channel, stream_id, entries)?;
                        }
                    }
                    previous = current;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observability::{ObservabilityEngine, ObservabilityMode};
    use serde_json::json;

    #[test]
    fn postgres_activity_query_breaks_query_start_ties_by_pid() {
        let query = fixed_query(
            ObservabilityEngine::Postgres,
            ObservabilityMode::Activity,
            "activity",
        )
        .unwrap();

        assert!(query.contains("ORDER BY query_start DESC NULLS LAST, pid"));
    }

    #[test]
    fn refreshed_activity_rows_keep_their_database_identity() {
        let cases = [
            (
                ObservabilityEngine::Postgres,
                json!({ "pid": 122, "state": "active" }),
                json!({ "pid": 122, "state": "idle" }),
            ),
            (
                ObservabilityEngine::Mysql,
                json!({ "id": "123", "seconds": 1 }),
                json!({ "id": "123", "seconds": 2 }),
            ),
            (
                ObservabilityEngine::Mariadb,
                json!({ "id": "124", "seconds": 1 }),
                json!({ "id": "124", "seconds": 2 }),
            ),
            (
                ObservabilityEngine::Clickhouse,
                json!({ "query_id": "query-1", "elapsed": 0.1 }),
                json!({ "query_id": "query-1", "elapsed": 0.2 }),
            ),
            (
                ObservabilityEngine::Redis,
                json!([42, 1_700_000_000, 1, ["GET", "key"]]),
                json!([42, 1_700_000_000, 2, ["GET", "key"]]),
            ),
            (
                ObservabilityEngine::Mongodb,
                json!({ "opid": "shard-a:125", "secs_running": 1 }),
                json!({ "opid": "shard-a:125", "secs_running": 2 }),
            ),
        ];

        for (engine, first, refreshed) in cases {
            let first = row_entry(engine, first, ObservabilityEntryKind::Activity);
            let refreshed = row_entry(engine, refreshed, ObservabilityEntryKind::Activity);
            assert_eq!(first.id, refreshed.id, "{engine:?}");
        }
    }

    #[test]
    fn different_activity_sessions_have_different_ids() {
        let first = row_entry(
            ObservabilityEngine::Postgres,
            json!({ "pid": 122 }),
            ObservabilityEntryKind::Activity,
        );
        let second = row_entry(
            ObservabilityEngine::Postgres,
            json!({ "pid": 123 }),
            ObservabilityEntryKind::Activity,
        );

        assert_ne!(first.id, second.id);
    }

    #[test]
    fn fixed_activity_queries_match_each_sql_engine() {
        assert!(fixed_query(
            ObservabilityEngine::Postgres,
            ObservabilityMode::Activity,
            "activity"
        )
        .unwrap()
        .contains("pg_stat_activity"));
        assert!(fixed_query(
            ObservabilityEngine::Mysql,
            ObservabilityMode::Activity,
            "activity"
        )
        .unwrap()
        .contains("information_schema.PROCESSLIST"));
        assert!(fixed_query(
            ObservabilityEngine::Mariadb,
            ObservabilityMode::Activity,
            "activity"
        )
        .unwrap()
        .contains("information_schema.PROCESSLIST"));
        let clickhouse = fixed_query(
            ObservabilityEngine::Clickhouse,
            ObservabilityMode::Activity,
            "activity",
        )
        .unwrap();
        assert!(clickhouse.contains("system.processes"));
        assert!(clickhouse.contains("queryID()"));
    }

    #[test]
    fn source_ids_cannot_select_an_arbitrary_query() {
        assert!(fixed_query(
            ObservabilityEngine::Postgres,
            ObservabilityMode::Logs,
            "SELECT current_user"
        )
        .is_none());
    }

    #[test]
    fn mariadb_native_logs_remain_unavailable() {
        assert!(!native_source_is_supported(
            ObservabilityEngine::Mariadb,
            ObservabilityMode::Logs,
            "server-log"
        ));
    }

    #[test]
    fn duckdb_logging_does_not_mutate_the_session() {
        assert!(!native_source_is_supported(
            ObservabilityEngine::Duckdb,
            ObservabilityMode::Logs,
            "duckdb-log"
        ));
        assert!(fixed_query(
            ObservabilityEngine::Duckdb,
            ObservabilityMode::Logs,
            "duckdb-log"
        )
        .is_none());
    }
}
