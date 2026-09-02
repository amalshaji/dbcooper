use super::{
    bound_text, ObservabilityEngine, ObservabilityEntry, ObservabilityEntryKind, ObservabilityLevel,
};
use serde_json::Value;

struct ParsedLine {
    timestamp: Option<String>,
    level: ObservabilityLevel,
    message: String,
    context: Option<String>,
}

fn level(value: &str) -> ObservabilityLevel {
    match value
        .trim_matches(|character: char| !character.is_ascii_alphabetic())
        .to_ascii_lowercase()
        .as_str()
    {
        "trace" => ObservabilityLevel::Trace,
        "debug" => ObservabilityLevel::Debug,
        "info" | "information" | "notice" | "note" | "system" | "log" => ObservabilityLevel::Info,
        "warn" | "warning" => ObservabilityLevel::Warn,
        "error" | "err" => ObservabilityLevel::Error,
        "fatal" | "critical" | "crit" | "panic" => ObservabilityLevel::Fatal,
        _ => ObservabilityLevel::Unknown,
    }
}

fn postgres(raw: &str) -> Option<ParsedLine> {
    let timestamp_end = raw.find(" UTC [")? + " UTC".len();
    let timestamp = raw[..timestamp_end].to_string();
    if timestamp.split_whitespace().next()?.contains('T') {
        return None;
    }
    let remainder = raw[timestamp_end..].strip_prefix(" [")?;
    let pid_end = remainder.find(']')?;
    let pid = &remainder[..pid_end];
    if pid.is_empty() || !pid.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let remainder = remainder[pid_end + 1..].trim_start();
    let (severity, message) = remainder.split_once(':')?;
    let parsed_level = level(severity);
    (parsed_level != ObservabilityLevel::Unknown).then(|| ParsedLine {
        timestamp: Some(timestamp),
        level: parsed_level,
        message: message.trim_start().to_string(),
        context: Some(format!("pid {pid}")),
    })
}

fn take_bracket(value: &str) -> Option<(&str, &str)> {
    let value = value.strip_prefix('[')?;
    let end = value.find(']')?;
    Some((&value[..end], value[end + 1..].trim_start()))
}

fn mysql(raw: &str) -> Option<ParsedLine> {
    let (timestamp, remainder) = raw.split_once(' ')?;
    if !timestamp.contains('T') {
        return None;
    }
    let (thread, mut remainder) = remainder.trim_start().split_once(' ')?;
    if !thread.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (severity, next) = take_bracket(remainder.trim_start())?;
    remainder = next;
    let mut context = Vec::new();
    while let Some((part, next)) = take_bracket(remainder) {
        context.push(part);
        remainder = next;
    }
    Some(ParsedLine {
        timestamp: Some(timestamp.to_string()),
        level: level(severity),
        message: remainder.to_string(),
        context: (!context.is_empty()).then(|| context.join(" · ")),
    })
}

fn clickhouse(raw: &str) -> Option<ParsedLine> {
    let first_space = raw.find(' ')?;
    let second_space = raw[first_space + 1..].find(' ')? + first_space + 1;
    let timestamp = raw[..second_space].to_string();
    let remainder = raw[second_space..].trim_start().strip_prefix('[')?;
    let pid_end = remainder.find(']')?;
    let pid = remainder[..pid_end].trim();
    let mut remainder = remainder[pid_end + 1..].trim_start();
    if remainder.starts_with('{') {
        remainder = remainder[remainder.find('}')? + 1..].trim_start();
    }
    let remainder = remainder.strip_prefix('<')?;
    let level_end = remainder.find('>')?;
    Some(ParsedLine {
        timestamp: Some(timestamp),
        level: level(&remainder[..level_end]),
        message: remainder[level_end + 1..].trim_start().to_string(),
        context: Some(format!("pid {pid}")),
    })
}

fn mongodb(raw: &str) -> Option<ParsedLine> {
    let value = serde_json::from_str::<Value>(raw).ok()?;
    let message = value.get("msg")?.as_str()?.to_string();
    let timestamp = value
        .get("t")
        .and_then(|time| time.get("$date"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let severity = value.get("s").and_then(Value::as_str).unwrap_or("");
    let parsed_level = match severity {
        value if value.starts_with('D') => ObservabilityLevel::Debug,
        "F" => ObservabilityLevel::Fatal,
        "E" => ObservabilityLevel::Error,
        "W" => ObservabilityLevel::Warn,
        "I" => ObservabilityLevel::Info,
        value => level(value),
    };
    let context = ["c", "ctx"]
        .into_iter()
        .filter_map(|name| value.get(name).and_then(Value::as_str))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    Some(ParsedLine {
        timestamp,
        level: parsed_level,
        message,
        context: (!context.is_empty()).then_some(context),
    })
}

fn redis(raw: &str) -> Option<ParsedLine> {
    let mut parts = raw.splitn(7, ' ');
    let process = parts.next()?;
    let day = parts.next()?;
    let month = parts.next()?;
    let year = parts.next()?;
    let time = parts.next()?;
    let marker = parts.next()?;
    let message = parts.next()?;
    if !process.contains(':') || !matches!(marker, "." | "-" | "*" | "#") {
        return None;
    }
    let parsed_level = match marker {
        "." => ObservabilityLevel::Trace,
        "-" => ObservabilityLevel::Debug,
        "*" => ObservabilityLevel::Info,
        "#" => ObservabilityLevel::Warn,
        _ => ObservabilityLevel::Unknown,
    };
    Some(ParsedLine {
        timestamp: Some(format!("{day} {month} {year} {time}")),
        level: parsed_level,
        message: message.to_string(),
        context: Some(process.to_string()),
    })
}

fn generic(raw: &str) -> ParsedLine {
    let mut remainder = raw;
    let mut timestamp = None;
    if let Some((first, rest)) = remainder.split_once(' ') {
        let is_iso_timestamp =
            first.contains('T') && first.as_bytes().first().is_some_and(u8::is_ascii_digit);
        let is_time_only = first.len() >= 8
            && first.as_bytes().get(2) == Some(&b':')
            && first.as_bytes().get(5) == Some(&b':');
        if is_iso_timestamp || is_time_only {
            timestamp = Some(first.to_string());
            remainder = rest;
        } else if first.len() == 10
            && first.as_bytes().get(4) == Some(&b'-')
            && rest.len() >= 8
            && rest.as_bytes().get(2) == Some(&b':')
            && rest.as_bytes().get(5) == Some(&b':')
        {
            let time_end = rest.find(' ').unwrap_or(rest.len());
            timestamp = Some(format!("{first} {}", &rest[..time_end]));
            remainder = rest[time_end..].trim_start();
        }
    }

    let mut parsed_level = ObservabilityLevel::Unknown;
    if let Some((candidate, rest)) = remainder.split_once(' ') {
        let candidate_level = level(candidate);
        if candidate_level != ObservabilityLevel::Unknown {
            parsed_level = candidate_level;
            remainder = rest.trim_start_matches([':', '|', '-']).trim_start();
        }
    }

    let mut context = None;
    let context_start = [remainder.find(" {"), remainder.find(" [")]
        .into_iter()
        .flatten()
        .min();
    if let Some(start) = context_start {
        let suffix = &remainder[start + 1..];
        let is_context = (suffix.starts_with('{') && suffix.ends_with('}'))
            || (suffix.starts_with('[') && suffix.ends_with(']'));
        if is_context {
            context = Some(suffix.to_string());
            remainder = remainder[..start].trim_end();
        }
    }

    ParsedLine {
        timestamp,
        level: parsed_level,
        message: if remainder.is_empty() { raw } else { remainder }.to_string(),
        context,
    }
}

fn parse_engine_line(engine: ObservabilityEngine, raw: &str) -> Option<ParsedLine> {
    match engine {
        ObservabilityEngine::Postgres => postgres(raw),
        ObservabilityEngine::Mysql | ObservabilityEngine::Mariadb => mysql(raw),
        ObservabilityEngine::Clickhouse => clickhouse(raw),
        ObservabilityEngine::Mongodb => mongodb(raw),
        ObservabilityEngine::Redis => redis(raw),
        _ => None,
    }
}

pub(crate) fn parse_log_entry(
    engine: ObservabilityEngine,
    id: String,
    raw: String,
    kind: ObservabilityEntryKind,
) -> ObservabilityEntry {
    let bounded_raw = bound_text(&raw);
    let parsed = parse_engine_line(engine, &bounded_raw).or_else(|| {
        let (transport_timestamp, inner) = bounded_raw.split_once(' ')?;
        if !transport_timestamp.contains('T')
            || !transport_timestamp
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_digit)
        {
            return None;
        }
        parse_engine_line(engine, inner)
    });
    let parsed = parsed.unwrap_or_else(|| generic(&bounded_raw));
    ObservabilityEntry {
        id,
        kind,
        raw: bounded_raw,
        timestamp: parsed.timestamp.map(|value| bound_text(&value)),
        level: parsed.level,
        message: bound_text(&parsed.message),
        context: parsed.context.map(|value| bound_text(&value)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(engine: ObservabilityEngine, raw: &str) -> ObservabilityEntry {
        parse_log_entry(
            engine,
            "line-1".to_string(),
            raw.to_string(),
            ObservabilityEntryKind::Line,
        )
    }

    #[test]
    fn parses_postgres_with_or_without_a_docker_transport_timestamp() {
        let engine_line = "2026-08-31 10:22:31.245 UTC [4812] ERROR: relation users does not exist";
        for raw in [
            engine_line.to_string(),
            format!("2026-08-31T10:22:32.000000000Z {engine_line}"),
        ] {
            let entry = parse(ObservabilityEngine::Postgres, &raw);
            assert_eq!(
                entry.timestamp.as_deref(),
                Some("2026-08-31 10:22:31.245 UTC")
            );
            assert_eq!(entry.level, ObservabilityLevel::Error);
            assert_eq!(entry.message, "relation users does not exist");
            assert_eq!(entry.context.as_deref(), Some("pid 4812"));
            assert_eq!(entry.raw, raw);
        }
    }

    #[test]
    fn parses_mysql_and_mariadb_error_lines() {
        let raw = "2026-08-31T10:22:31.245Z 0 [Warning] [MY-010068] [Server] CA certificate is self signed";
        for engine in [ObservabilityEngine::Mysql, ObservabilityEngine::Mariadb] {
            let entry = parse(engine, raw);
            assert_eq!(entry.level, ObservabilityLevel::Warn);
            assert_eq!(entry.message, "CA certificate is self signed");
            assert_eq!(entry.context.as_deref(), Some("MY-010068 · Server"));
        }
    }

    #[test]
    fn parses_clickhouse_text_log_lines() {
        let entry = parse(
            ObservabilityEngine::Clickhouse,
            "2026.08.31 10:22:31.245 [ 991 ] {} <Error> TCPHandler: query failed",
        );
        assert_eq!(entry.timestamp.as_deref(), Some("2026.08.31 10:22:31.245"));
        assert_eq!(entry.level, ObservabilityLevel::Error);
        assert_eq!(entry.message, "TCPHandler: query failed");
        assert_eq!(entry.context.as_deref(), Some("pid 991"));
    }

    #[test]
    fn parses_mongodb_structured_log_json() {
        let raw = r#"{"t":{"$date":"2026-08-31T10:22:31.245Z"},"s":"W","c":"NETWORK","ctx":"conn12","msg":"Slow query"}"#;
        let entry = parse(ObservabilityEngine::Mongodb, raw);
        assert_eq!(entry.timestamp.as_deref(), Some("2026-08-31T10:22:31.245Z"));
        assert_eq!(entry.level, ObservabilityLevel::Warn);
        assert_eq!(entry.message, "Slow query");
        assert_eq!(entry.context.as_deref(), Some("NETWORK · conn12"));
    }

    #[test]
    fn parses_redis_server_lines() {
        let entry = parse(
            ObservabilityEngine::Redis,
            "2411:M 31 Aug 2026 10:22:31.245 # Error accepting a client connection",
        );
        assert_eq!(entry.timestamp.as_deref(), Some("31 Aug 2026 10:22:31.245"));
        assert_eq!(entry.level, ObservabilityLevel::Warn);
        assert_eq!(entry.message, "Error accepting a client connection");
        assert_eq!(entry.context.as_deref(), Some("2411:M"));
    }

    #[test]
    fn parses_generic_docker_lines_without_inventing_engine_metadata() {
        let entry = parse(
            ObservabilityEngine::Sqlite,
            "2026-08-31T10:22:31.245Z [WARN] connection stalled {\"pool\":\"primary\"}",
        );
        assert_eq!(entry.timestamp.as_deref(), Some("2026-08-31T10:22:31.245Z"));
        assert_eq!(entry.level, ObservabilityLevel::Warn);
        assert_eq!(entry.message, "connection stalled");
        assert_eq!(entry.context.as_deref(), Some("{\"pool\":\"primary\"}"));
    }

    #[test]
    fn preserves_time_only_timestamps_and_spaced_trailing_context() {
        let entry = parse(
            ObservabilityEngine::Sqlite,
            "12:00:00.125 WARN connection stalled {\"pool\": \"primary replica\"}",
        );
        assert_eq!(entry.timestamp.as_deref(), Some("12:00:00.125"));
        assert_eq!(entry.level, ObservabilityLevel::Warn);
        assert_eq!(entry.message, "connection stalled");
        assert_eq!(
            entry.context.as_deref(),
            Some("{\"pool\": \"primary replica\"}")
        );
    }
}
