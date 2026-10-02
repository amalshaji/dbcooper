use crate::ai::settings::AiSettings;
use crate::ai::{
    clean_generated_query, emit_chunk, emit_done, emit_error, ChatMessage, OpenAIError,
    OpenAIRequest, StreamResponse,
};
use futures_util::StreamExt;
use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

fn api_key(settings: &AiSettings) -> Result<String, String> {
    settings
        .api_key
        .clone()
        .ok_or_else(|| "OpenAI API key not configured. Please add it in Settings.".to_string())
}

fn completions_request(
    settings: &AiSettings,
    api_key: &str,
    request: &OpenAIRequest,
) -> Result<reqwest::RequestBuilder, String> {
    let url = format!(
        "{}/chat/completions",
        settings.endpoint.trim_end_matches('/')
    );
    Ok(client()?
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(request))
}

fn api_error_message(error_text: &str) -> String {
    if let Ok(error) = serde_json::from_str::<OpenAIError>(error_text) {
        error.error.message
    } else {
        format!("API error: {}", error_text)
    }
}

#[derive(Deserialize)]
struct CompletionResponse {
    choices: Vec<CompletionChoice>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}

#[derive(Deserialize)]
struct CompletionMessage {
    content: Option<String>,
}

pub async fn complete(settings: &AiSettings, messages: Vec<ChatMessage>) -> Result<String, String> {
    let api_key = api_key(settings)?;
    let request = OpenAIRequest {
        model: settings.model.clone(),
        messages,
        temperature: 0.2,
        stream: false,
    };
    let response = completions_request(settings, &api_key, &request)?
        .send()
        .await
        .map_err(|e| format!("Failed to call OpenAI API: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(api_error_message(&error_text));
    }

    let body: CompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI API response: {}", e))?;
    body.choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "The AI provider returned an empty response".to_string())
}

fn parse_stream_content(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?.trim();
    if data == "[DONE]" {
        return None;
    }

    serde_json::from_str::<StreamResponse>(data)
        .ok()?
        .choices
        .into_iter()
        .next()?
        .delta
        .content
}

pub async fn generate_query(
    app: AppHandle,
    session_id: String,
    settings: AiSettings,
    system_prompt: String,
    user_prompt: String,
) -> Result<(), String> {
    let api_key = api_key(&settings)?;

    let request = OpenAIRequest {
        model: settings.model.clone(),
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

    let response = completions_request(&settings, &api_key, &request)?
        .send()
        .await
        .map_err(|e| format!("Failed to call OpenAI API: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        let error_msg = api_error_message(&error_text);
        emit_error(&app, session_id, error_msg.clone());
        return Err(error_msg);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_response = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_pos).collect();
            let line = line.trim_end_matches(|c| c == '\r' || c == '\n');

            if let Some(content) = parse_stream_content(line) {
                full_response.push_str(&content);
                emit_chunk(&app, &session_id, content);
            }
        }
    }

    if let Some(content) = parse_stream_content(buffer.trim_end_matches(|c| c == '\r' || c == '\n'))
    {
        full_response.push_str(&content);
        emit_chunk(&app, &session_id, content);
    }

    emit_done(&app, session_id, clean_generated_query(&full_response));
    Ok(())
}
