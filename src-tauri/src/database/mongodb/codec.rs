use mongodb::bson::{Bson, Document};
use serde_json::Value;

const DEFAULT_PAGE_SIZE: u32 = 100;
const MAX_PAGE_SIZE: u32 = 1_000;

pub fn validate_connection_uri(uri: &str) -> Result<(), String> {
    if uri.len() > 8 * 1024 {
        return Err("MongoDB URI must be 8 KiB or less".to_string());
    }
    if !(uri.starts_with("mongodb://") || uri.starts_with("mongodb+srv://")) {
        return Err("MongoDB URI must start with mongodb:// or mongodb+srv://".to_string());
    }
    Ok(())
}

pub(super) fn safe_error(context: &str, error: impl std::fmt::Display, uri: &str) -> String {
    let mut message = error.to_string().replace(uri, "[redacted MongoDB URI]");
    if let Some((_, authority)) = uri.split_once("://") {
        if let Some((credentials, _)) = authority.split_once('@') {
            if !credentials.is_empty() {
                message = message.replace(credentials, "[redacted]");
            }
        }
    }
    format!("{context}: {message}")
}

pub(super) fn json_document(value: Value, field: &str) -> Result<Document, String> {
    match serde_json::from_value::<Bson>(value)
        .map_err(|error| format!("Invalid Extended JSON in {field}: {error}"))?
    {
        Bson::Document(document) => Ok(document),
        _ => Err(format!("{field} must be a JSON object")),
    }
}

pub(super) fn bson_json(value: Bson) -> Value {
    value.into_canonical_extjson()
}

pub(super) fn page_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE)
}

pub fn ensure_read_only_pipeline(pipeline: &[Value]) -> Result<(), String> {
    for stage in pipeline {
        let object = stage
            .as_object()
            .ok_or_else(|| "Each aggregation stage must be a JSON object".to_string())?;
        if object.contains_key("$out") || object.contains_key("$merge") {
            return Err("$out and $merge are not allowed in read-only aggregations".to_string());
        }
    }
    Ok(())
}

pub fn is_system_namespace(database: &str, collection: &str) -> bool {
    matches!(database, "config" | "local")
        || database.starts_with("__mdb_internal_")
        || collection.starts_with("system.")
}

pub fn ensure_mutable_namespace(database: &str, collection: &str) -> Result<(), String> {
    if is_system_namespace(database, collection) {
        return Err(format!(
            "MongoDB system namespace {database}.{collection} is read-only in DBcooper"
        ));
    }
    Ok(())
}
