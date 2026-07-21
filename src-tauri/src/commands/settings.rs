use crate::db::models::Setting;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_setting(
    pool: State<'_, SqlitePool>,
    key: String,
) -> Result<Option<String>, String> {
    crate::db::settings::get(pool.inner(), &key).await
}

#[tauri::command]
pub async fn set_setting(
    pool: State<'_, SqlitePool>,
    key: String,
    value: String,
) -> Result<(), String> {
    crate::db::settings::set(pool.inner(), &key, &value).await
}

#[tauri::command]
pub async fn set_settings(
    pool: State<'_, SqlitePool>,
    settings: HashMap<String, String>,
) -> Result<(), String> {
    let mut tx = pool.inner().begin().await.map_err(|e| e.to_string())?;

    for (key, value) in settings {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(
    pool: State<'_, SqlitePool>,
) -> Result<HashMap<String, String>, String> {
    let settings: Vec<Setting> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    let map: HashMap<String, String> = settings.into_iter().map(|s| (s.key, s.value)).collect();
    Ok(map)
}
