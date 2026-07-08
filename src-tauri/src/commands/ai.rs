use crate::ai::{self, AiHarnessStatus, AiStatus, TableSchema};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn generate_sql(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    session_id: String,
    db_type: String,
    instruction: String,
    existing_sql: String,
    tables: Vec<TableSchema>,
) -> Result<(), String> {
    println!("[AI] Starting SQL generation for session: {}", session_id);
    println!("[AI] DB type: {}", db_type);
    println!("[AI] Tables count: {}", tables.len());

    ai::generate_sql(
        app,
        pool.inner(),
        session_id,
        db_type,
        instruction,
        existing_sql,
        tables,
    )
    .await
}

#[tauri::command]
pub async fn detect_ai_harnesses() -> Result<Vec<AiHarnessStatus>, String> {
    Ok(ai::detect_harnesses().await)
}

#[tauri::command]
pub async fn get_ai_status(pool: State<'_, SqlitePool>) -> Result<AiStatus, String> {
    ai::get_status(pool.inner()).await
}
