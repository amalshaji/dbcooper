//! Settings persistence shared between Tauri commands and internal services.
//!
//! Canonical `&SqlitePool`-based accessors for the `settings` key/value table.
//! Both the `settings` Tauri commands and the embedded MCP server's control
//! layer go through these so the SQL lives in exactly one place.

use crate::db::models::Setting;
use sqlx::SqlitePool;

/// Read a setting value by key. `Ok(None)` when the key is absent.
pub async fn get(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    let row: Option<Setting> = sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.map(|s| s.value))
}

/// Insert or replace a setting value.
pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
