use super::InspectLevel;
use serde_json::{json, Map, Value};
use std::collections::HashSet;

pub const SAMPLE_ROWS: usize = 50;
const MAX_CELL_CHARS: usize = 200;
const MAX_COLUMNS: usize = 60;
const SCALAR_COLUMN: &str = "value";
/// Below this many values, min/max/mean would expose individual values.
const MIN_VALUES_FOR_STATS: usize = 5;
/// Keeps each observation small enough for model context and CLI argv limits.
const MAX_SAMPLE_BYTES: usize = 24_000;

/// Ordered union of the keys of object rows; scalar rows (e.g. Redis replies)
/// are exposed as a single `value` column.
pub fn columns(rows: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut columns = Vec::new();
    for row in rows {
        match row {
            Value::Object(object) => {
                for key in object.keys() {
                    if seen.insert(key.clone()) {
                        columns.push(key.clone());
                    }
                }
            }
            _ => {
                if seen.insert(SCALAR_COLUMN.to_string()) {
                    columns.push(SCALAR_COLUMN.to_string());
                }
            }
        }
    }
    columns
}

fn cell<'a>(row: &'a Value, column: &str) -> Option<&'a Value> {
    match row {
        Value::Object(object) => object.get(column),
        _ if column == SCALAR_COLUMN => Some(row),
        _ => None,
    }
}

fn as_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
        _ => None,
    }
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn column_type(rows: &[Value], column: &str) -> &'static str {
    let mut kind: Option<&'static str> = None;
    let mut all_numeric = true;
    let mut any = false;
    for value in rows.iter().filter_map(|row| cell(row, column)) {
        if value.is_null() {
            continue;
        }
        any = true;
        all_numeric &= as_number(value).is_some();
        let current = value_kind(value);
        kind = match kind {
            None => Some(current),
            Some(previous) if previous == current => Some(previous),
            Some(_) => Some("mixed"),
        };
    }
    if any && all_numeric {
        "number"
    } else {
        kind.unwrap_or("null")
    }
}

fn truncate_text(text: &str) -> String {
    if text.chars().count() <= MAX_CELL_CHARS {
        return text.to_string();
    }
    let truncated: String = text.chars().take(MAX_CELL_CHARS).collect();
    format!("{truncated}…")
}

fn sample_cell(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(truncate_text(text)),
        Value::Array(_) | Value::Object(_) => Value::String(truncate_text(&value.to_string())),
        other => other.clone(),
    }
}

fn column_summary(rows: &[Value], column: &str, kind: &str) -> Value {
    let mut nulls = 0usize;
    let mut distinct = HashSet::new();
    let mut numbers = Vec::new();
    for row in rows {
        match cell(row, column) {
            None | Some(Value::Null) => nulls += 1,
            Some(value) => {
                distinct.insert(value.to_string());
                if kind == "number" {
                    numbers.extend(as_number(value));
                }
            }
        }
    }

    let mut summary = json!({
        "name": column,
        "type": kind,
        "nulls": nulls,
        "distinct": distinct.len(),
    });
    if numbers.len() >= MIN_VALUES_FOR_STATS {
        let min = numbers.iter().copied().fold(f64::INFINITY, f64::min);
        let max = numbers.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let mean = numbers.iter().sum::<f64>() / numbers.len() as f64;
        summary["min"] = json!(min);
        summary["max"] = json!(max);
        summary["mean"] = json!(mean);
    }
    summary
}

/// What the model is allowed to see about a query result at a given level.
/// Charts never depend on this: the UI renders from the full result locally.
pub fn observation(step: usize, rows: &[Value], truncated: bool, level: InspectLevel) -> Value {
    let all_columns = columns(rows);
    let visible: Vec<&String> = all_columns.iter().take(MAX_COLUMNS).collect();

    let column_info: Vec<Value> = visible
        .iter()
        .map(|column| {
            let kind = column_type(rows, column);
            if level >= InspectLevel::Summary {
                column_summary(rows, column, kind)
            } else {
                json!({ "name": column, "type": kind })
            }
        })
        .collect();

    let mut result = json!({
        "step": step,
        "status": "ok",
        "row_count": rows.len(),
        "truncated": truncated,
        "inspect": level,
        "columns": column_info,
    });
    if all_columns.len() > MAX_COLUMNS {
        result["omitted_columns"] = json!(all_columns.len() - MAX_COLUMNS);
    }

    if level == InspectLevel::Rows {
        let sample: Vec<Value> = rows
            .iter()
            .take(SAMPLE_ROWS)
            .map(|row| {
                let object: Map<String, Value> = visible
                    .iter()
                    .map(|column| {
                        let value = cell(row, column).map(sample_cell).unwrap_or(Value::Null);
                        ((*column).clone(), value)
                    })
                    .collect();
                Value::Object(object)
            })
            .collect();
        let mut sample = sample;
        while sample.len() > 1 && Value::Array(sample.clone()).to_string().len() > MAX_SAMPLE_BYTES
        {
            sample.truncate(sample.len() / 2);
        }
        if sample.len() < rows.len().min(SAMPLE_ROWS) {
            result["sample_truncated_to"] = json!(sample.len());
        }
        result["rows"] = Value::Array(sample);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::{columns, observation, redact_error, SAMPLE_ROWS};
    use crate::ai::chat::InspectLevel;
    use serde_json::{json, Value};

    fn rows() -> Vec<Value> {
        vec![
            json!({"month": "2026-01", "revenue": "120.50", "note": "secret"}),
            json!({"month": "2026-02", "revenue": 80, "note": null}),
        ]
    }

    #[test]
    fn collects_ordered_column_union_and_scalar_rows() {
        let mixed = vec![json!({"a": 1}), json!({"b": 2, "a": 3})];
        assert_eq!(columns(&mixed), vec!["a", "b"]);
        assert_eq!(columns(&[json!(["x", "y"])]), vec!["value"]);
    }

    #[test]
    fn none_level_exposes_only_shape() {
        let result = observation(1, &rows(), false, InspectLevel::None);
        assert_eq!(result["row_count"], 2);
        assert_eq!(
            result["columns"][1],
            json!({"name": "revenue", "type": "number"})
        );
        assert!(result.get("rows").is_none());
        assert!(!result.to_string().contains("secret"));
        assert!(!result.to_string().contains("120.5"));
    }

    #[test]
    fn summary_level_adds_statistics_without_raw_values() {
        let many: Vec<Value> = (0..6)
            .map(|index| json!({"revenue": 80 + index * 8, "note": "secret"}))
            .collect();
        let result = observation(1, &many, false, InspectLevel::Summary);
        assert_eq!(result["columns"][0]["min"], 80.0);
        assert_eq!(result["columns"][0]["max"], 120.0);
        assert!(result.get("rows").is_none());
        assert!(!result.to_string().contains("secret"));
    }

    #[test]
    fn summary_level_hides_statistics_for_few_values() {
        let result = observation(1, &rows(), false, InspectLevel::Summary);
        assert!(result["columns"][1].get("min").is_none());
        assert_eq!(result["columns"][2]["nulls"], 1);
    }

    #[test]
    fn rows_level_samples_and_truncates() {
        let many: Vec<Value> = (0..SAMPLE_ROWS + 10)
            .map(|index| json!({"id": index, "body": "x".repeat(500)}))
            .collect();
        let result = observation(2, &many, true, InspectLevel::Rows);
        let sample = result["rows"].as_array().unwrap();
        assert_eq!(sample.len(), SAMPLE_ROWS);
        assert!(sample[0]["body"].as_str().unwrap().chars().count() <= 201);
        assert_eq!(result["truncated"], true);
    }
}

/// Quoted fragments in database errors often echo values (e.g. a failed cast
/// of `'alice@example.com'`), so they are hidden below the `rows` level.
pub fn redact_error(error: &str) -> String {
    let mut redacted = String::with_capacity(error.len());
    let mut quote: Option<char> = None;
    for ch in error.chars() {
        match quote {
            Some(open) if ch == open => {
                redacted.push('…');
                redacted.push(ch);
                quote = None;
            }
            Some(_) => {}
            None => {
                redacted.push(ch);
                if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                }
            }
        }
    }
    if quote.is_some() {
        redacted.push('…');
    }
    redacted
}

#[cfg(test)]
mod redaction_tests {
    use super::{observation, redact_error};
    use crate::ai::chat::InspectLevel;
    use serde_json::{json, Value};

    #[test]
    fn hides_quoted_values_in_errors() {
        assert_eq!(
            redact_error(r#"invalid input syntax for type integer: "alice@example.com""#),
            r#"invalid input syntax for type integer: "…""#
        );
        assert_eq!(
            redact_error("column 'salary' does not exist"),
            "column '…' does not exist"
        );
        assert_eq!(
            redact_error("syntax error at end of input"),
            "syntax error at end of input"
        );
    }

    #[test]
    fn caps_sample_size() {
        let wide: Vec<Value> = (0..50)
            .map(|index| json!({"id": index, "a": "x".repeat(190), "b": "y".repeat(190), "c": "z".repeat(190)}))
            .collect();
        let result = observation(1, &wide, false, InspectLevel::Rows);
        assert!(result["rows"].to_string().len() <= 24_000);
        assert!(result["sample_truncated_to"].as_u64().unwrap() < 50);
    }
}
