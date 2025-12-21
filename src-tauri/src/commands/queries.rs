use crate::db::models::{SavedQuery, SavedQueryFormData};
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
