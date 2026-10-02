use super::prompt::harness_chat_prompt;
use super::{ChatModel, Role, Turn};
use crate::ai::providers::{harness, openai};
use crate::ai::settings::{AiProvider, AiSettings};
use crate::ai::ChatMessage;
use async_trait::async_trait;

pub struct ProviderModel {
    pub settings: AiSettings,
}

#[async_trait]
impl ChatModel for ProviderModel {
    async fn complete(&self, system: &str, transcript: &[Turn]) -> Result<String, String> {
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
