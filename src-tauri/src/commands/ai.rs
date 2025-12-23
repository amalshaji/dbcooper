use crate::db::models::Setting;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};

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
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OpenAIError {
    error: OpenAIErrorDetail,
}

#[derive(Debug, Deserialize)]
struct OpenAIErrorDetail {
    message: String,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamResponse {
    choices: Vec<StreamChoice>,
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
    // Get settings from database
    let settings: Vec<Setting> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    let settings_map: HashMap<String, String> =
        settings.into_iter().map(|s| (s.key, s.value)).collect();

    let api_key = settings_map
        .get("openai_api_key")
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "OpenAI API key not configured. Please add it in Settings.".to_string())?
        .clone();

    let endpoint = settings_map
        .get("openai_endpoint")
        .filter(|e| !e.is_empty())
        .cloned()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    let model = settings_map
        .get("openai_model")
        .filter(|m| !m.is_empty())
        .cloned()
        .unwrap_or_else(|| "gpt-4.1".to_string());

    // Build schema description
    let schema_description = tables
        .iter()
        .map(|t| {
            let cols = t.columns.as_ref().map_or(String::new(), |columns| {
                let col_desc: Vec<String> = columns
                    .iter()
                    .map(|c| {
                        format!(
                            "{} ({}{})",
                            c.name,
                            c.column_type,
                            if c.nullable { ", nullable" } else { "" }
                        )
                    })
                    .collect();
                format!("\n  Columns: {}", col_desc.join(", "))
            });
            format!("{}.{}{}", t.schema, t.name, cols)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    // Determine database-specific prompt
    let (db_name, syntax_note) = match db_type.to_lowercase().as_str() {
        "sqlite" | "sqlite3" => ("SQLite", "Use SQLite syntax"),
        "mysql" => ("MySQL", "Use MySQL syntax"),
        "redis" => ("Redis", "Generate Redis commands"),
        _ => ("PostgreSQL", "Use PostgreSQL syntax"),
    };

    let system_prompt = format!(
        r#"You are a {} SQL expert. Generate SQL queries based on user instructions.

Available tables and schemas:
{}

Rules:
- Return ONLY the raw SQL query, no markdown formatting, no code blocks, no explanations
- {}
- Consider the existing SQL if provided as context"#,
        db_name, schema_description, syntax_note
    );

    let user_prompt = if existing_sql.is_empty() {
        format!("Generate SQL query: {}", instruction)
    } else {
        format!(
            "Modify this SQL query:\n```sql\n{}\n```\n\nInstruction: {}",
            existing_sql, instruction
        )
    };

    let request = OpenAIRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
        temperature: 0.3,
        stream: true,
    };

    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to call OpenAI API: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        let error_msg = if let Ok(error) = serde_json::from_str::<OpenAIError>(&error_text) {
            error.error.message
        } else {
            format!("API error: {}", error_text)
        };
        let _ = app.emit(
            "ai-error",
            AiErrorPayload {
                session_id,
                error: error_msg.clone(),
            },
        );
        return Err(error_msg);
    }

    // Stream the response
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    continue;
                }

                if let Ok(parsed) = serde_json::from_str::<StreamResponse>(data) {
                    if let Some(choice) = parsed.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            full_response.push_str(content);
                            let _ = app.emit(
                                "ai-chunk",
                                AiChunkPayload {
                                    chunk: content.clone(),
                                    session_id: session_id.clone(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    // Clean up the response - remove markdown code blocks if present
    let cleaned = full_response
        .trim()
        .trim_start_matches("```sql")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    // Emit done event with the full cleaned response
    let _ = app.emit(
        "ai-done",
        AiDonePayload {
            session_id,
            full_response: cleaned,
        },
    );

    Ok(())
}
