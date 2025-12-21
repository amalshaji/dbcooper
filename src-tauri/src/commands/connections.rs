use crate::db::models::{Connection, ConnectionFormData};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_connections(pool: State<'_, SqlitePool>) -> Result<Vec<Connection>, String> {
    sqlx::query_as::<_, Connection>("SELECT * FROM connections ORDER BY id DESC")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_by_uuid(
    pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<Connection, String> {
    sqlx::query_as::<_, Connection>("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_connection(
    pool: State<'_, SqlitePool>,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    let uuid = Uuid::new_v4().to_string();
    let ssl = if data.ssl { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
        r#"
        INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&uuid)
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(ssl)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_connection(
    pool: State<'_, SqlitePool>,
    id: i64,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    let ssl = if data.ssl { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
        r#"
        UPDATE connections
        SET type = ?, name = ?, host = ?, port = ?, database = ?, username = ?, password = ?, ssl = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(ssl)
    .bind(id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}
