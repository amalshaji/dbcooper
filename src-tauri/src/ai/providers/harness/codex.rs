use super::process::{collect_stderr, command, with_workdir, COMPLETION_TIMEOUT};
use crate::ai::emit_chunk;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio};
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, ChildStdout},
    time::timeout,
};

#[derive(Debug, Deserialize)]
struct RawMessage {
    id: Option<u64>,
    method: Option<String>,
    result: Option<Value>,
    error: Option<RpcError>,
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct DeltaParams {
    delta: String,
}

#[derive(Debug, Deserialize)]
struct ItemCompletedParams {
    item: CompletedItem,
}

#[derive(Debug, Deserialize)]
struct CompletedItem {
    #[serde(rename = "type")]
    item_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TurnCompletedParams {
    turn: CompletedTurn,
}

#[derive(Debug, Deserialize)]
struct CompletedTurn {
    status: String,
    error: Option<RpcError>,
}

#[derive(Debug, PartialEq)]
enum CodexEvent {
    Delta(String),
    Final(String),
    TurnCompleted,
    TurnFailed(String),
    Ignore,
}

enum CodexMessage {
    Rpc {
        id: u64,
        result: Option<Value>,
        error: Option<String>,
    },
    Event(CodexEvent),
}

fn parse_message(line: &str) -> CodexMessage {
    let Ok(raw) = serde_json::from_str::<RawMessage>(line) else {
        return CodexMessage::Event(CodexEvent::Ignore);
    };
    if let Some(id) = raw.id {
        return CodexMessage::Rpc {
            id,
            result: raw.result,
            error: raw.error.map(|error| error.message),
        };
    }

    let event = match raw.method.as_deref() {
        Some("item/agentMessage/delta") => raw
            .params
            .and_then(|params| serde_json::from_value::<DeltaParams>(params).ok())
            .map(|params| CodexEvent::Delta(params.delta))
            .unwrap_or(CodexEvent::Ignore),
        Some("item/completed") => raw
            .params
            .and_then(|params| serde_json::from_value::<ItemCompletedParams>(params).ok())
            .filter(|params| params.item.item_type == "agentMessage")
            .and_then(|params| params.item.text)
            .map(CodexEvent::Final)
            .unwrap_or(CodexEvent::Ignore),
        Some("turn/completed") => raw
            .params
            .and_then(|params| serde_json::from_value::<TurnCompletedParams>(params).ok())
            .map(|params| match params.turn.status.as_str() {
                "completed" => CodexEvent::TurnCompleted,
                "failed" | "interrupted" => CodexEvent::TurnFailed(
                    params
                        .turn
                        .error
                        .map(|error| error.message)
                        .unwrap_or_else(|| "Codex generation did not complete".to_string()),
                ),
                _ => CodexEvent::Ignore,
            })
            .unwrap_or(CodexEvent::Ignore),
        _ => CodexEvent::Ignore,
    };
    CodexMessage::Event(event)
}

#[derive(Default)]
struct Transcript {
    streamed: String,
    final_response: Option<String>,
    completed: bool,
}

impl Transcript {
    fn record(&mut self, event: CodexEvent) -> Result<Option<String>, String> {
        match event {
            CodexEvent::Delta(delta) => {
                self.streamed.push_str(&delta);
                Ok(Some(delta))
            }
            CodexEvent::Final(response) => {
                self.final_response = Some(response);
                Ok(None)
            }
            CodexEvent::TurnCompleted => {
                self.completed = true;
                Ok(None)
            }
            CodexEvent::TurnFailed(error) => Err(error),
            CodexEvent::Ignore => Ok(None),
        }
    }

    fn finish(self, stderr: &str) -> Result<(String, bool), String> {
        if !self.completed {
            return Err(if stderr.is_empty() {
                "Codex app-server closed before completing the turn".to_string()
            } else {
                format!("Codex app-server closed before completing the turn: {stderr}")
            });
        }
        if !self.streamed.is_empty() {
            return Ok((self.streamed, false));
        }
        self.final_response
            .filter(|response| !response.is_empty())
            .map(|response| (response, true))
            .ok_or_else(|| {
                if stderr.is_empty() {
                    "Codex CLI returned an empty response".to_string()
                } else {
                    format!("Codex CLI returned an empty response: {stderr}")
                }
            })
    }
}

async fn write_json_line(stdin: &mut ChildStdin, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn read_rpc_result(
    lines: &mut Lines<BufReader<ChildStdout>>,
    request_id: u64,
) -> Result<Value, String> {
    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        if let CodexMessage::Rpc { id, result, error } = parse_message(&line) {
            if id != request_id {
                continue;
            }
            if let Some(error) = error {
                return Err(error);
            }
            return result
                .ok_or_else(|| "Codex app-server returned an invalid response".to_string());
        }
    }
    Err("Codex app-server closed unexpectedly".to_string())
}

pub(super) async fn run(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    command_path: PathBuf,
) -> Result<String, String> {
    with_workdir(|workdir| async move {
        let mut command = command(command_path, &workdir);
        command
            .args(["app-server", "--disable", "remote_control", "--stdio"])
            .stdin(Stdio::piped());

        timeout(COMPLETION_TIMEOUT, async {
            let mut child = command
                .spawn()
                .map_err(|error| format!("Failed to start Codex CLI: {error}"))?;
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to open stdin for Codex CLI".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to open stdout for Codex CLI".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "Failed to open stderr for Codex CLI".to_string())?;
            let stderr_task = tokio::spawn(collect_stderr(stderr));
            let mut lines = BufReader::new(stdout).lines();

            write_json_line(
                &mut stdin,
                json!({
                    "id": 1,
                    "method": "initialize",
                    "params": { "clientInfo": {
                        "name": "dbcooper",
                        "title": "DBcooper",
                        "version": env!("CARGO_PKG_VERSION")
                    }}
                }),
            )
            .await?;
            read_rpc_result(&mut lines, 1).await?;
            write_json_line(&mut stdin, json!({ "method": "initialized" })).await?;

            write_json_line(
                &mut stdin,
                json!({
                    "id": 2,
                    "method": "thread/start",
                    "params": {
                        "cwd": workdir,
                        "approvalPolicy": "never",
                        "sandbox": "read-only",
                        "ephemeral": true
                    }
                }),
            )
            .await?;
            let thread = read_rpc_result(&mut lines, 2).await?;
            let thread_id = thread
                .pointer("/thread/id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Codex app-server did not return a thread id".to_string())?;

            write_json_line(
                &mut stdin,
                json!({
                    "id": 3,
                    "method": "turn/start",
                    "params": {
                        "threadId": thread_id,
                        "input": [{ "type": "text", "text": prompt }]
                    }
                }),
            )
            .await?;

            let mut transcript = Transcript::default();
            while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
                match parse_message(&line) {
                    CodexMessage::Rpc {
                        id: 3,
                        error: Some(error),
                        ..
                    } => return Err(error),
                    CodexMessage::Event(event) => {
                        if let Some(delta) = transcript.record(event)? {
                            emit_chunk(app, session_id, delta);
                        }
                        if transcript.completed {
                            break;
                        }
                    }
                    _ => {}
                }
            }

            let _ = child.kill().await;
            let _ = child.wait().await;
            let stderr = stderr_task.await.map_err(|error| error.to_string())??;
            let (response, used_fallback) = transcript.finish(&stderr)?;
            if used_fallback {
                emit_chunk(app, session_id, response.clone());
            }
            Ok(response)
        })
        .await
        .map_err(|_| "Codex CLI timed out".to_string())?
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{parse_message, CodexEvent, CodexMessage, Transcript};

    fn record_line(transcript: &mut Transcript, line: &str) -> Result<Option<String>, String> {
        match parse_message(line) {
            CodexMessage::Event(event) => transcript.record(event),
            CodexMessage::Rpc { .. } => Ok(None),
        }
    }

    #[test]
    fn parses_a_complete_streaming_transcript() {
        let lines = [
            r#"{"method":"item/agentMessage/delta","params":{"delta":"SELECT "}}"#,
            r#"{"method":"item/agentMessage/delta","params":{"delta":"1;"}}"#,
            r#"{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"SELECT 1;"}}}"#,
            r#"{"method":"turn/completed","params":{"turn":{"status":"completed","error":null}}}"#,
        ];
        let mut transcript = Transcript::default();
        let emitted: String = lines
            .iter()
            .filter_map(|line| record_line(&mut transcript, line).transpose())
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .concat();

        assert_eq!(emitted, "SELECT 1;");
        assert_eq!(transcript.finish(""), Ok(("SELECT 1;".to_string(), false)));
    }

    #[test]
    fn reports_a_failed_turn_from_its_typed_error() {
        let message = parse_message(
            r#"{"method":"turn/completed","params":{"turn":{"status":"failed","error":{"message":"model unavailable"}}}}"#,
        );
        assert!(matches!(
            message,
            CodexMessage::Event(CodexEvent::TurnFailed(error)) if error == "model unavailable"
        ));
    }

    #[test]
    fn uses_the_final_message_only_when_no_deltas_arrive() {
        let mut transcript = Transcript::default();
        record_line(
            &mut transcript,
            r#"{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"SELECT 1;"}}}"#,
        )
        .unwrap();
        record_line(
            &mut transcript,
            r#"{"method":"turn/completed","params":{"turn":{"status":"completed"}}}"#,
        )
        .unwrap();

        assert_eq!(transcript.finish(""), Ok(("SELECT 1;".to_string(), true)));
    }
}
