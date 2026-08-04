use super::process::{collect_stderr, command, with_workdir, COMPLETION_TIMEOUT};
use crate::ai::emit_chunk;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::{io::AsyncBufReadExt, io::BufReader, time::timeout};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClaudeMessage {
    #[serde(rename = "stream_event")]
    StreamEvent { event: ClaudeStreamEvent },
    #[serde(rename = "result")]
    Result {
        is_error: bool,
        result: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClaudeStreamEvent {
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { delta: ClaudeDelta },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClaudeDelta {
    #[serde(rename = "text_delta")]
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, PartialEq)]
enum ClaudeEvent {
    Delta(String),
    Final(String),
    Ignore,
}

fn parse_event(line: &str) -> ClaudeEvent {
    match serde_json::from_str::<ClaudeMessage>(line) {
        Ok(ClaudeMessage::StreamEvent {
            event:
                ClaudeStreamEvent::ContentBlockDelta {
                    delta: ClaudeDelta::Text { text },
                },
        }) => ClaudeEvent::Delta(text),
        Ok(ClaudeMessage::Result {
            is_error: false,
            result: Some(result),
        }) => ClaudeEvent::Final(result),
        _ => ClaudeEvent::Ignore,
    }
}

#[derive(Default)]
struct Transcript {
    streamed: String,
    final_response: Option<String>,
}

impl Transcript {
    fn record(&mut self, event: ClaudeEvent) -> Option<String> {
        match event {
            ClaudeEvent::Delta(delta) => {
                self.streamed.push_str(&delta);
                Some(delta)
            }
            ClaudeEvent::Final(response) => {
                self.final_response = Some(response);
                None
            }
            ClaudeEvent::Ignore => None,
        }
    }

    fn finish(self) -> Result<(String, bool), String> {
        if !self.streamed.is_empty() {
            return Ok((self.streamed, false));
        }
        self.final_response
            .filter(|response| !response.is_empty())
            .map(|response| (response, true))
            .ok_or_else(|| "Claude Code returned an empty response".to_string())
    }
}

pub(super) async fn run(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    command_path: PathBuf,
) -> Result<String, String> {
    with_workdir(|workdir| async move {
        let mut command = command(command_path, &workdir);
        command.args([
            "--print",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--no-session-persistence",
            "--tools",
            "",
            prompt,
        ]);

        timeout(COMPLETION_TIMEOUT, async {
            let mut child = command
                .spawn()
                .map_err(|error| format!("Failed to start Claude Code: {error}"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to open stdout for Claude Code".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "Failed to open stderr for Claude Code".to_string())?;
            let stderr_task = tokio::spawn(collect_stderr(stderr));
            let mut lines = BufReader::new(stdout).lines();
            let mut transcript = Transcript::default();

            while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
                if let Some(delta) = transcript.record(parse_event(&line)) {
                    emit_chunk(app, session_id, delta);
                }
            }

            let status = child.wait().await.map_err(|error| error.to_string())?;
            let stderr = stderr_task.await.map_err(|error| error.to_string())??;
            if !status.success() {
                return Err(if stderr.is_empty() {
                    "Claude Code exited with an error".to_string()
                } else {
                    format!("Claude Code exited with an error: {stderr}")
                });
            }

            let (response, used_fallback) = transcript.finish()?;
            if used_fallback {
                emit_chunk(app, session_id, response.clone());
            }
            Ok(response)
        })
        .await
        .map_err(|_| "Claude Code timed out".to_string())?
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{parse_event, ClaudeEvent, Transcript};

    #[test]
    fn parses_a_complete_streaming_transcript() {
        let lines = [
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"SELECT "}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"1;"}}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"SELECT 1;"}"#,
        ];
        let mut transcript = Transcript::default();
        let emitted: String = lines
            .iter()
            .filter_map(|line| transcript.record(parse_event(line)))
            .collect();

        assert_eq!(emitted, "SELECT 1;");
        assert_eq!(transcript.finish(), Ok(("SELECT 1;".to_string(), false)));
    }

    #[test]
    fn uses_the_final_result_only_when_no_deltas_arrive() {
        let mut transcript = Transcript::default();
        transcript.record(parse_event(
            r#"{"type":"result","is_error":false,"result":"SELECT 1;"}"#,
        ));

        assert_eq!(transcript.finish(), Ok(("SELECT 1;".to_string(), true)));
        assert_eq!(parse_event("not json"), ClaudeEvent::Ignore);
    }
}
