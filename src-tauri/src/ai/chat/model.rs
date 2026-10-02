use super::prompt::harness_chat_prompt;
use super::{ChatModel, Role, Turn};
use crate::ai::providers::{harness, openai};
use crate::ai::settings::{AiProvider, AiSettings};
use crate::ai::ChatMessage;
use async_trait::async_trait;

/// Hard limit on the full prompt sent to any provider, including the
/// harness wrapper. The schema-bearing system prompt is capped first, then
/// the newest turns are kept (the newest one truncated if it alone is too big).
const MAX_PROMPT_BYTES: usize = 300_000;
const MAX_SYSTEM_BYTES: usize = 120_000;
/// Room for the harness wrapper text around the system prompt and transcript.
const PROMPT_OVERHEAD_BYTES: usize = 1_024;
/// Role label and separators added per turn when a transcript is flattened.
const TURN_OVERHEAD_BYTES: usize = 32;
const TRUNCATED: &str = "\n… [truncated to fit the prompt budget]";

fn truncate_bytes(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max.saturating_sub(TRUNCATED.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{TRUNCATED}", &text[..end])
}

fn fit_prompt(system: &str, transcript: &[Turn]) -> (String, Vec<Turn>) {
    let system = truncate_bytes(system, MAX_SYSTEM_BYTES);
    let mut remaining = MAX_PROMPT_BYTES - PROMPT_OVERHEAD_BYTES - system.len();
    let mut kept = Vec::new();
    for turn in transcript.iter().rev() {
        let cost = turn.content.len() + TURN_OVERHEAD_BYTES;
        if cost <= remaining {
            remaining -= cost;
            kept.push(turn.clone());
            continue;
        }
        if kept.is_empty() && remaining > TURN_OVERHEAD_BYTES + TRUNCATED.len() {
            kept.push(Turn {
                role: turn.role,
                content: truncate_bytes(&turn.content, remaining - TURN_OVERHEAD_BYTES),
            });
        }
        break;
    }
    kept.reverse();
    (system, kept)
}

pub struct ProviderModel {
    pub settings: AiSettings,
}

#[async_trait]
impl ChatModel for ProviderModel {
    async fn complete(&self, system: &str, transcript: &[Turn]) -> Result<String, String> {
        let (system, transcript) = fit_prompt(system, transcript);
        let (system, transcript) = (system.as_str(), transcript.as_slice());
        match self.settings.provider {
            AiProvider::OpenAI => {
                let messages = std::iter::once(ChatMessage {
                    role: "system".to_string(),
                    content: system.to_string(),
                })
                .chain(transcript.iter().map(|turn| {
                    ChatMessage {
                        role: match turn.role {
                            Role::User => "user",
                            Role::Assistant => "assistant",
                        }
                        .to_string(),
                        content: turn.content.clone(),
                    }
                }))
                .collect();
                openai::complete(&self.settings, messages).await
            }
            provider => {
                harness::run_completion(
                    provider,
                    &harness_chat_prompt(system, transcript),
                    &self.settings.harness,
                )
                .await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fit_prompt, MAX_PROMPT_BYTES, MAX_SYSTEM_BYTES, PROMPT_OVERHEAD_BYTES};
    use crate::ai::chat::prompt::harness_chat_prompt;
    use crate::ai::chat::{Role, Turn};

    fn turn(size: usize) -> Turn {
        Turn {
            role: Role::User,
            content: "é".repeat(size / 2),
        }
    }

    #[test]
    fn keeps_recent_turns_within_the_budget() {
        let turns = vec![turn(200_000), turn(90_000), turn(100_000)];
        let (_, kept) = fit_prompt("system", &turns);
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn bounds_the_full_flattened_prompt() {
        assert!(harness_chat_prompt("", &[]).len() < PROMPT_OVERHEAD_BYTES);

        let huge_system = "s".repeat(MAX_SYSTEM_BYTES * 3);
        for transcript in [
            vec![turn(MAX_PROMPT_BYTES * 2)],
            vec![turn(10), turn(MAX_PROMPT_BYTES * 2)],
            (0..40).map(|_| turn(20_000)).collect(),
        ] {
            let (system, kept) = fit_prompt(&huge_system, &transcript);
            assert!(system.len() <= MAX_SYSTEM_BYTES);
            assert!(!kept.is_empty());
            let prompt = harness_chat_prompt(&system, &kept);
            assert!(prompt.len() <= MAX_PROMPT_BYTES, "{}", prompt.len());
        }
    }
}
