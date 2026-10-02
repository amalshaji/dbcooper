use crate::ai::providers::harness_models::{self, HarnessModelCatalog};
use crate::ai::{self, AiHarnessStatus, AiProvider, AiStatus, QueryGenerationContext};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn generate_query(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    session_id: String,
    instruction: String,
    context: QueryGenerationContext,
) -> Result<(), String> {
    println!("[AI] Starting query generation for session: {}", session_id);

    ai::generate_query(app, pool.inner(), session_id, instruction, context).await
}

#[tauri::command]
pub async fn detect_ai_harnesses() -> Result<Vec<AiHarnessStatus>, String> {
    Ok(ai::detect_harnesses().await)
}

#[tauri::command]
pub async fn get_ai_status(pool: State<'_, SqlitePool>) -> Result<AiStatus, String> {
    ai::get_status(pool.inner()).await
}

#[tauri::command]
pub async fn list_ai_harness_models(provider: String) -> Result<HarnessModelCatalog, String> {
    let provider = AiProvider::from_setting(Some(&provider))?;
    Ok(harness_models::list_models(provider).await)
}
