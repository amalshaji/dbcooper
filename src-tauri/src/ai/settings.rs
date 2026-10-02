use crate::ai::providers::harness::HarnessOptions;
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

    /// Settings keys holding this harness's model and thinking level.
    pub fn harness_option_keys(self) -> Option<(String, String)> {
        self.command_name()?;
        let prefix = self.as_str();
        Some((format!("{prefix}_model"), format!("{prefix}_effort")))
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
    pub chat_data_access: Option<String>,
    pub harness: HarnessOptions,
}

pub async fn load(pool: &SqlitePool) -> Result<AiSettings, String> {
    let mut keys: Vec<String> = [
        "ai_provider",
        "openai_api_key",
        "openai_endpoint",
        "openai_model",
        "ai_chat_data_access",
    ]
    .map(String::from)
    .to_vec();
    for (model_key, effort_key) in AiProvider::harnesses()
        .into_iter()
        .filter_map(AiProvider::harness_option_keys)
    {
        keys.extend([model_key, effort_key]);
    }
    let sql = format!(
        "SELECT key, value FROM settings WHERE key IN ({})",
        vec!["?"; keys.len()].join(", ")
    );
    let settings: Vec<Setting> = keys
        .iter()
        .fold(sqlx::query_as(&sql), |query, key| query.bind(key))
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

    let chat_data_access = settings_map.get("ai_chat_data_access").cloned();
    let non_empty = |key: &str| {
        settings_map
            .get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let harness = provider
        .harness_option_keys()
        .map(|(model_key, effort_key)| HarnessOptions {
            model: non_empty(&model_key),
            effort: non_empty(&effort_key),
        })
        .unwrap_or_default();

    Ok(AiSettings {
        provider,
        api_key,
        endpoint,
        model,
        chat_data_access,
        harness,
    })
}

#[cfg(test)]
mod tests {
    use super::{load, AiProvider};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool(settings: &[(&str, &str)]) -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for (key, value) in settings {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool
    }

    #[test]
    fn harness_option_keys_follow_the_provider_id() {
        assert_eq!(
            AiProvider::CodexCli.harness_option_keys(),
            Some((
                "codex_cli_model".to_string(),
                "codex_cli_effort".to_string()
            ))
        );
        assert_eq!(AiProvider::OpenAI.harness_option_keys(), None);
    }

    #[tokio::test]
    async fn loads_only_the_selected_harness_options() {
        let settings = load(
            &pool(&[
                ("ai_provider", "codex_cli"),
                ("codex_cli_model", " gpt-a "),
                ("codex_cli_effort", ""),
                ("claude_code_model", "opus"),
            ])
            .await,
        )
        .await
        .unwrap();

        assert_eq!(settings.harness.model.as_deref(), Some("gpt-a"));
        assert_eq!(settings.harness.effort, None);
    }
}
