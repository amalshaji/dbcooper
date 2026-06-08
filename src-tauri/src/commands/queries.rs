use crate::db::models::{QueryHistory, SavedQuery, SavedQueryFormData};
use sqlx::SqlitePool;
use tauri::State;

#[tauri::command]
pub async fn get_saved_queries(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
) -> Result<Vec<SavedQuery>, String> {
    sqlx::query_as::<_, SavedQuery>(
        "SELECT * FROM saved_queries WHERE connection_uuid = ? ORDER BY updated_at DESC",
    )
    .bind(&connection_uuid)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_saved_query(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
    data: SavedQueryFormData,
) -> Result<SavedQuery, String> {
    sqlx::query_as::<_, SavedQuery>(
        r#"
        INSERT INTO saved_queries (connection_uuid, name, query)
        VALUES (?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&connection_uuid)
    .bind(&data.name)
    .bind(&data.query)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_saved_query(
    pool: State<'_, SqlitePool>,
    id: i64,
    data: SavedQueryFormData,
) -> Result<SavedQuery, String> {
    sqlx::query_as::<_, SavedQuery>(
        r#"
        UPDATE saved_queries
        SET name = ?, query = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind(&data.name)
    .bind(&data.query)
    .bind(id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_saved_query(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    sqlx::query("DELETE FROM saved_queries WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// Record a query run in history and prune to the newest 10 per connection.
/// Fire-and-forget from the UI: failures must not block query results.
#[tauri::command]
pub async fn record_query_history(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
    query: String,
    status: String,
    time_taken_ms: Option<i64>,
    row_count: Option<i64>,
    rows_affected: Option<i64>,
    error: Option<String>,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO query_history
            (connection_uuid, query, status, time_taken_ms, row_count, rows_affected, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&connection_uuid)
    .bind(&query)
    .bind(&status)
    .bind(time_taken_ms)
    .bind(row_count)
    .bind(rows_affected)
    .bind(&error)
    .execute(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    // Keep only the newest 10 runs for this connection.
    sqlx::query(
        r#"
        DELETE FROM query_history
        WHERE connection_uuid = ?
          AND id NOT IN (
            SELECT id FROM query_history
            WHERE connection_uuid = ?
            ORDER BY executed_at DESC, id DESC
            LIMIT 10
          )
        "#,
    )
    .bind(&connection_uuid)
    .bind(&connection_uuid)
    .execute(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_query_history(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
) -> Result<Vec<QueryHistory>, String> {
    sqlx::query_as::<_, QueryHistory>(
        "SELECT * FROM query_history WHERE connection_uuid = ? ORDER BY executed_at DESC, id DESC LIMIT 10",
    )
    .bind(&connection_uuid)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_query_history(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
) -> Result<bool, String> {
    sqlx::query("DELETE FROM query_history WHERE connection_uuid = ?")
        .bind(&connection_uuid)
        .execute(pool.inner())
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}
