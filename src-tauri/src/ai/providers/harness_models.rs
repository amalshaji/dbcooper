use super::harness::run_harness_command;
use crate::ai::settings::AiProvider;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const CODEX_LIST_TIMEOUT: Duration = Duration::from_secs(15);
const OPENCODE_LIST_TIMEOUT: Duration = Duration::from_secs(30);
const CLAUDE_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_MODELS: [(&str, &str); 4] = [
    ("fable", "Fable (latest)"),
    ("opus", "Opus (latest)"),
    ("sonnet", "Sonnet (latest)"),
    ("haiku", "Haiku (latest)"),
];
const CODEX_FALLBACK_EFFORTS: [&str; 4] = ["low", "medium", "high", "xhigh"];

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HarnessModel {
    pub id: String,
    pub name: String,
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HarnessModelCatalog {
    pub provider: String,
    pub models: Vec<HarnessModel>,
    /// Thinking levels offered when no specific model is selected.
    pub efforts: Vec<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct CodexModels {
    models: Vec<CodexModel>,
}

#[derive(Deserialize)]
struct CodexModel {
    slug: String,
    display_name: Option<String>,
    visibility: Option<String>,
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevel>,
}

#[derive(Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// Thinking levels in first-seen order across models.
fn union_efforts(models: &[HarnessModel]) -> Vec<String> {
    let mut efforts: Vec<String> = Vec::new();
    for effort in models.iter().flat_map(|model| &model.efforts) {
        if !efforts.contains(effort) {
            efforts.push(effort.clone());
        }
    }
    efforts
}

pub fn parse_codex_models(json: &str) -> Result<Vec<HarnessModel>, String> {
    let parsed: CodexModels =
        serde_json::from_str(json).map_err(|e| format!("Unexpected Codex model list: {e}"))?;
    Ok(parsed
        .models
        .into_iter()
        .filter(|model| model.visibility.as_deref() != Some("hide"))
        .map(|model| HarnessModel {
            name: model.display_name.unwrap_or_else(|| model.slug.clone()),
            id: model.slug,
            efforts: model
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect(),
            default_effort: model.default_reasoning_level,
        })
        .collect())
}

fn is_opencode_model_header(line: &str) -> bool {
    !line.is_empty()
        && !line.starts_with(char::is_whitespace)
        && !line.starts_with(['{', '}'])
        && line.contains('/')
        && !line.contains(char::is_whitespace)
}

fn opencode_model(id: &str, metadata: &str) -> HarnessModel {
    let metadata: Value = serde_json::from_str(metadata).unwrap_or(Value::Null);
    HarnessModel {
        id: id.to_string(),
        name: metadata
            .get("name")
            .and_then(Value::as_str)
            .map(|name| format!("{name} ({id})"))
            .unwrap_or_else(|| id.to_string()),
        efforts: metadata
            .get("variants")
            .and_then(Value::as_object)
            .map(|variants| variants.keys().cloned().collect())
            .unwrap_or_default(),
        default_effort: None,
    }
}

/// `opencode models --verbose` prints `provider/model` followed by a JSON
/// metadata block for each model.
pub fn parse_opencode_models(output: &str) -> Vec<HarnessModel> {
    let mut models = Vec::new();
    let mut current: Option<(String, String)> = None;
    for line in output.lines() {
        if is_opencode_model_header(line) {
            if let Some((id, metadata)) = current.take() {
                models.push(opencode_model(&id, &metadata));
            }
            current = Some((line.to_string(), String::new()));
        } else if let Some((_, metadata)) = current.as_mut() {
            metadata.push_str(line);
            metadata.push('\n');
        }
    }
    if let Some((id, metadata)) = current {
        models.push(opencode_model(&id, &metadata));
    }
    models
}

pub async fn list_models(provider: AiProvider) -> HarnessModelCatalog {
    let (models, fallback_efforts, error) = match provider {
        AiProvider::ClaudeCode => (
            CLAUDE_MODELS
                .iter()
                .map(|(id, name)| HarnessModel {
                    id: id.to_string(),
                    name: name.to_string(),
                    efforts: strings(&CLAUDE_EFFORTS),
                    default_effort: None,
                })
                .collect(),
            strings(&CLAUDE_EFFORTS),
            None,
        ),
        AiProvider::CodexCli => {
            match run_harness_command(provider, &["debug", "models"], CODEX_LIST_TIMEOUT)
                .await
                .and_then(|output| parse_codex_models(&output))
            {
                Ok(models) => (models, strings(&CODEX_FALLBACK_EFFORTS), None),
                Err(error) => (Vec::new(), strings(&CODEX_FALLBACK_EFFORTS), Some(error)),
            }
        }
        AiProvider::OpencodeCli => {
            match run_harness_command(provider, &["models", "--verbose"], OPENCODE_LIST_TIMEOUT)
                .await
            {
                Ok(output) => (parse_opencode_models(&output), Vec::new(), None),
                Err(error) => (Vec::new(), Vec::new(), Some(error)),
            }
        }
        AiProvider::OpenAI => (
            Vec::new(),
            Vec::new(),
            Some("Model listing is only available for CLI harnesses".to_string()),
        ),
    };

    let efforts = if fallback_efforts.is_empty() {
        union_efforts(&models)
    } else {
        fallback_efforts
    };
    HarnessModelCatalog {
        provider: provider.as_str().to_string(),
        models,
        efforts,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_codex_models, parse_opencode_models, union_efforts};

    #[test]
    fn parses_visible_codex_models_with_reasoning_levels() {
        let models = parse_codex_models(
            r#"{"models":[
                {"slug":"gpt-a","display_name":"GPT-A","visibility":"list","default_reasoning_level":"medium",
                 "supported_reasoning_levels":[{"effort":"low","description":"x"},{"effort":"high","description":"y"}]},
                {"slug":"hidden","visibility":"hide","supported_reasoning_levels":[]},
                {"slug":"gpt-b"}
            ]}"#,
        )
        .unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "GPT-A");
        assert_eq!(models[0].efforts, vec!["low", "high"]);
        assert_eq!(models[0].default_effort.as_deref(), Some("medium"));
        assert_eq!(models[1].name, "gpt-b");
        assert!(parse_codex_models("not json").is_err());
    }

    #[test]
    fn parses_opencode_verbose_output_and_plain_lists() {
        let models = parse_opencode_models(
            "opencode/a\n{\n  \"name\": \"Model A\",\n  \"variants\": {\"low\": {}, \"high\": {}}\n}\nanthropic/b\n{\n  \"variants\": {}\n}\n",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "opencode/a");
        assert_eq!(models[0].name, "Model A (opencode/a)");
        assert_eq!(models[0].efforts, vec!["low", "high"]);
        assert!(models[1].efforts.is_empty());

        let plain = parse_opencode_models("opencode/a\nopencode/b\n");
        assert_eq!(plain.len(), 2);
        assert_eq!(plain[1].name, "opencode/b");

        assert_eq!(union_efforts(&models), vec!["low", "high"]);
    }
}
