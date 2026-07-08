use crate::db::models::Setting;
use sqlx::SqlitePool;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AiProvider {
    OpenAI,
    ClaudeCode,
    CodexCli,
    OpencodeCli,
}

impl AiProvider {
    pub fn from_setting(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("openai") {
            "openai" => Ok(Self::OpenAI),
            "claude_code" => Ok(Self::ClaudeCode),
            "codex_cli" => Ok(Self::CodexCli),
            "opencode_cli" => Ok(Self::OpencodeCli),
            provider => Err(format!("Unsupported AI provider: {}", provider)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAI => "openai",
            Self::ClaudeCode => "claude_code",
            Self::CodexCli => "codex_cli",
            Self::OpencodeCli => "opencode_cli",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::OpenAI => "OpenAI-compatible API",
            Self::ClaudeCode => "Claude Code",
            Self::CodexCli => "Codex CLI",
            Self::OpencodeCli => "opencode",
        }
    }

    pub fn command_name(self) -> Option<&'static str> {
        match self {
            Self::OpenAI => None,
            Self::ClaudeCode => Some("claude"),
            Self::CodexCli => Some("codex"),
            Self::OpencodeCli => Some("opencode"),
        }
    }

    pub fn harnesses() -> [Self; 3] {
        [Self::ClaudeCode, Self::CodexCli, Self::OpencodeCli]
    }
}

pub struct AiSettings {
    pub provider: AiProvider,
    pub api_key: Option<String>,
    pub endpoint: String,
    pub model: String,
}

pub async fn load(pool: &SqlitePool) -> Result<AiSettings, String> {
    let settings: Vec<Setting> = sqlx::query_as(
        "SELECT key, value FROM settings WHERE key IN ('ai_provider', 'openai_api_key', 'openai_endpoint', 'openai_model')",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let settings_map: HashMap<String, String> =
        settings.into_iter().map(|s| (s.key, s.value)).collect();

    let provider = AiProvider::from_setting(settings_map.get("ai_provider").map(String::as_str))?;
    let api_key = settings_map
        .get("openai_api_key")
        .filter(|key| !key.is_empty())
        .cloned();
    let endpoint = settings_map
        .get("openai_endpoint")
        .filter(|endpoint| !endpoint.is_empty())
        .cloned()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model = settings_map
        .get("openai_model")
        .filter(|model| !model.is_empty())
        .cloned()
        .unwrap_or_else(|| "gpt-4.1".to_string());

    Ok(AiSettings {
        provider,
        api_key,
        endpoint,
        model,
    })
}
