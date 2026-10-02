use super::prompt::harness_chat_prompt;
use super::{ChatModel, Role, Turn};
use crate::ai::providers::{harness, openai};
use crate::ai::settings::{AiProvider, AiSettings};
use crate::ai::ChatMessage;
use async_trait::async_trait;

/// Total prompt budget; older turns are dropped first so long conversations
/// stay within model context.
const MAX_PROMPT_BYTES: usize = 300_000;

fn fit_transcript<'a>(system: &str, transcript: &'a [Turn]) -> &'a [Turn] {
    let mut size = system.len();
    let mut start = transcript.len();
    while start > 0 {
        let next = size + transcript[start - 1].content.len();
        if next > MAX_PROMPT_BYTES && start < transcript.len() {
            break;
        }
        size = next;
        start -= 1;
    }
    &transcript[start..]
}

pub struct ProviderModel {
    pub settings: AiSettings,
}

#[async_trait]
impl ChatModel for ProviderModel {
    async fn complete(&self, system: &str, transcript: &[Turn]) -> Result<String, String> {
        let transcript = fit_transcript(system, transcript);
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
    use super::{fit_transcript, MAX_PROMPT_BYTES};
    use crate::ai::chat::{Role, Turn};

    fn turn(size: usize) -> Turn {
        Turn {
            role: Role::User,
            content: "x".repeat(size),
        }
    }

    #[test]
    fn keeps_recent_turns_within_the_budget() {
        let turns = vec![turn(200_000), turn(90_000), turn(100_000)];
        let kept = fit_transcript("system", &turns);
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().map(|turn| turn.content.len()).sum::<usize>() <= MAX_PROMPT_BYTES);

        let oversized = vec![turn(10), turn(MAX_PROMPT_BYTES * 2)];
        assert_eq!(fit_transcript("system", &oversized).len(), 1);
    }
}
