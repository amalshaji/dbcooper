use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};

pub mod prompts;
pub mod providers;
pub mod settings;

pub use providers::harness::{detect_harnesses, AiHarnessStatus};
pub use settings::AiProvider;

#[derive(Debug, Serialize, Deserialize)]
pub struct TableSchema {
    pub schema: String,
    pub name: String,
    pub columns: Option<Vec<ColumnSchema>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnSchema {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
    pub nullable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub stream: bool,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIError {
    pub error: OpenAIErrorDetail,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIErrorDetail {
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct StreamChoice {
    pub delta: StreamDelta,
}

#[derive(Debug, Deserialize)]
pub struct StreamDelta {
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StreamResponse {
    pub choices: Vec<StreamChoice>,
}

#[derive(Clone, Serialize)]
struct AiChunkPayload {
    chunk: String,
    session_id: String,
}

#[derive(Clone, Serialize)]
struct AiDonePayload {
    session_id: String,
    full_response: String,
}

#[derive(Clone, Serialize)]
struct AiErrorPayload {
    session_id: String,
    error: String,
}

#[derive(Clone, Serialize)]
pub struct AiStatus {
    provider: String,
    configured: bool,
    error: Option<String>,
}

pub fn emit_chunk(app: &AppHandle, session_id: &str, chunk: String) {
    let _ = app.emit(
        "ai-chunk",
        AiChunkPayload {
            chunk,
            session_id: session_id.to_string(),
        },
    );
}

pub fn emit_done(app: &AppHandle, session_id: String, full_response: String) {
    let _ = app.emit(
        "ai-done",
        AiDonePayload {
            session_id,
            full_response,
        },
    );
}

pub fn emit_error(app: &AppHandle, session_id: String, error: String) {
    let _ = app.emit("ai-error", AiErrorPayload { session_id, error });
}

pub fn clean_generated_sql(response: &str) -> String {
    let mut cleaned = response.trim();

    if let Some(without_fence) = cleaned.strip_prefix("```") {
        cleaned = without_fence.trim_start();
        if let Some(newline_pos) = cleaned.find('\n') {
            let first_line = cleaned[..newline_pos].trim();
            if first_line.is_empty() || first_line.eq_ignore_ascii_case("sql") {
                cleaned = &cleaned[newline_pos + 1..];
            }
        }
        if let Some(end_pos) = cleaned.rfind("```") {
            cleaned = &cleaned[..end_pos];
        }
    }

    cleaned.trim().to_string()
}

pub async fn generate_sql(
    app: AppHandle,
    pool: &SqlitePool,
    session_id: String,
    db_type: String,
    instruction: String,
    existing_sql: String,
    tables: Vec<TableSchema>,
) -> Result<(), String> {
    let settings = settings::load(pool).await?;
    let (system_prompt, user_prompt) =
        prompts::sql_prompts(&db_type, &instruction, &existing_sql, &tables);

    match settings.provider {
        AiProvider::OpenAI => {
            providers::openai::generate_sql(app, session_id, settings, system_prompt, user_prompt)
                .await
        }
        provider => {
            providers::harness::generate_sql(app, session_id, provider, system_prompt, user_prompt)
                .await
        }
    }
}

pub async fn get_status(pool: &SqlitePool) -> Result<AiStatus, String> {
    let settings = settings::load(pool).await?;
    let (configured, error) = match settings.provider {
        AiProvider::OpenAI => (
            settings.api_key.as_ref().is_some_and(|key| !key.is_empty()),
            None,
        ),
        provider => match providers::harness::detect_provider(provider).await {
            status if status.available => (true, None),
            status => (false, status.error),
        },
    };

    Ok(AiStatus {
        provider: settings.provider.as_str().to_string(),
        configured,
        error,
    })
}
