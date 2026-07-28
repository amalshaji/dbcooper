use crate::ai::prompts::harness_prompt;
use crate::ai::settings::AiProvider;
use crate::ai::{clean_generated_sql, emit_chunk, emit_done};
use futures_util::future::join_all;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, ChildStdout, Command},
    time::timeout,
};

const HARNESS_TIMEOUT: Duration = Duration::from_secs(120);
const HARNESS_DETECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Serialize)]
pub struct AiHarnessStatus {
    pub provider: String,
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

fn path_has_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = path.metadata() {
            return metadata.permissions().mode() & 0o111 != 0;
        }
        false
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn candidate_executable_paths(command: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path_env) = env::var_os("PATH") {
        paths.extend(env::split_paths(&path_env).map(|path| path.join(command)));
    }

    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin").join(command));
        paths.push(home.join(".opencode/bin").join(command));
    }

    paths.push(PathBuf::from("/opt/homebrew/bin").join(command));
    paths.push(PathBuf::from("/usr/local/bin").join(command));
    paths.push(PathBuf::from("/usr/bin").join(command));

    paths
}

fn find_executable(command: &str) -> Option<PathBuf> {
    candidate_executable_paths(command)
        .into_iter()
        .find(|path| path_has_executable(path))
}

fn gui_path() -> Option<String> {
    let mut entries = Vec::new();
    if let Some(existing) = env::var_os("PATH") {
        entries.extend(env::split_paths(&existing));
    }
    if let Some(home) = dirs::home_dir() {
        entries.push(home.join(".local/bin"));
        entries.push(home.join(".opencode/bin"));
    }
    entries.push(PathBuf::from("/opt/homebrew/bin"));
    entries.push(PathBuf::from("/usr/local/bin"));
    entries.push(PathBuf::from("/usr/bin"));
    env::join_paths(entries)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

async fn create_workdir() -> Result<PathBuf, String> {
    let dir = env::temp_dir().join(format!("dbcooper-ai-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create AI harness workdir: {}", e))?;
    Ok(dir)
}

fn base_command(command_path: PathBuf, workdir: &Path) -> Command {
    let mut command = Command::new(command_path);
    command.current_dir(workdir);
    command.kill_on_drop(true);
    if let Some(path) = gui_path() {
        command.env("PATH", path);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
}

fn build_opencode_command(prompt: &str, command_path: PathBuf, workdir: &Path) -> Command {
    let mut command = base_command(command_path, workdir);
    command.args(["run", "--pure", "--dir"]);
    command.arg(workdir);
    command.args(["--format", "default", prompt]);
    command
}

async fn run_opencode_completion(prompt: &str, command_path: PathBuf) -> Result<String, String> {
    let workdir = create_workdir().await?;
    let mut command = build_opencode_command(prompt, command_path, &workdir);
    let output_result = timeout(HARNESS_TIMEOUT, command.output()).await;
    let _ = tokio::fs::remove_dir_all(&workdir).await;
    let output = output_result
        .map_err(|_| "OpenCode timed out".to_string())?
        .map_err(|error| format!("OpenCode failed: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("OpenCode exited with an error: {details}"));
    }

    if stdout.is_empty() {
        return Err("OpenCode returned an empty response".to_string());
    }

    Ok(stdout)
}

fn claude_text_delta(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line).ok()?;
    (value.get("type")?.as_str()? == "stream_event"
        && value.pointer("/event/type")?.as_str()? == "content_block_delta"
        && value.pointer("/event/delta/type")?.as_str()? == "text_delta")
        .then(|| {
            value
                .pointer("/event/delta/text")?
                .as_str()
                .map(str::to_string)
        })?
}

fn claude_result_text(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line).ok()?;
    (value.get("type")?.as_str()? == "result" && !value.get("is_error")?.as_bool()?)
        .then(|| value.get("result")?.as_str().map(str::to_string))?
}

fn codex_text_delta(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line).ok()?;
    (value.get("method")?.as_str()? == "item/agentMessage/delta")
        .then(|| value.pointer("/params/delta")?.as_str().map(str::to_string))?
}

fn codex_final_message(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line).ok()?;
    (value.get("method")?.as_str()? == "item/completed"
        && value.pointer("/params/item/type")?.as_str()? == "agentMessage")
        .then(|| {
            value
                .pointer("/params/item/text")?
                .as_str()
                .map(str::to_string)
        })?
}

fn codex_turn_completion(line: &str) -> Option<Result<(), String>> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("method")?.as_str()? != "turn/completed" {
        return None;
    }

    match value.pointer("/params/turn/status")?.as_str()? {
        "completed" => Some(Ok(())),
        "failed" | "interrupted" => Some(Err(value
            .pointer("/params/turn/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Codex generation did not complete")
            .to_string())),
        _ => None,
    }
}

async fn collect_stderr(mut stderr: tokio::process::ChildStderr) -> Result<String, String> {
    let mut bytes = Vec::new();
    stderr
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).trim().to_string())
}

async fn run_claude_completion(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    command_path: PathBuf,
) -> Result<String, String> {
    let workdir = create_workdir().await?;
    let mut command = base_command(command_path, &workdir);
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

    let result = timeout(HARNESS_TIMEOUT, async {
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
        let mut response = String::new();
        let mut final_response = None;

        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            if let Some(delta) = claude_text_delta(&line) {
                response.push_str(&delta);
                emit_chunk(app, session_id, delta);
            } else if let Some(result) = claude_result_text(&line) {
                final_response = Some(result);
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

        if response.is_empty() {
            response = final_response
                .filter(|text| !text.is_empty())
                .ok_or_else(|| "Claude Code returned an empty response".to_string())?;
            emit_chunk(app, session_id, response.clone());
        }
        Ok(response)
    })
    .await
    .map_err(|_| "Claude Code timed out".to_string())?;

    let _ = tokio::fs::remove_dir_all(&workdir).await;
    result
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

fn rpc_error(value: &Value) -> Option<String> {
    value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn read_rpc_result(
    lines: &mut Lines<BufReader<ChildStdout>>,
    request_id: u64,
) -> Result<Value, String> {
    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }
        if let Some(error) = rpc_error(&value) {
            return Err(error);
        }
        return value
            .get("result")
            .cloned()
            .ok_or_else(|| "Codex app-server returned an invalid response".to_string());
    }
    Err("Codex app-server closed unexpectedly".to_string())
}

async fn run_codex_completion(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    command_path: PathBuf,
) -> Result<String, String> {
    let workdir = create_workdir().await?;
    let mut command = base_command(command_path, &workdir);
    command
        .args(["app-server", "--disable", "remote_control", "--stdio"])
        .stdin(Stdio::piped());

    let result = timeout(HARNESS_TIMEOUT, async {
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
                "params": {
                    "clientInfo": {
                        "name": "dbcooper",
                        "title": "DBcooper",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
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

        let mut response = String::new();
        let mut final_response = None;
        let mut completed = false;
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            let value = serde_json::from_str::<Value>(&line).ok();
            if value.as_ref().and_then(rpc_error).is_some()
                && value
                    .as_ref()
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_u64)
                    == Some(3)
            {
                return Err(value.as_ref().and_then(rpc_error).unwrap_or_default());
            }
            if let Some(delta) = codex_text_delta(&line) {
                response.push_str(&delta);
                emit_chunk(app, session_id, delta);
            } else if let Some(message) = codex_final_message(&line) {
                final_response = Some(message);
            }
            if let Some(completion) = codex_turn_completion(&line) {
                completion?;
                completed = true;
                break;
            }
        }

        let _ = child.kill().await;
        let _ = child.wait().await;
        let stderr = stderr_task.await.map_err(|error| error.to_string())??;
        if !completed {
            return Err(if stderr.is_empty() {
                "Codex app-server closed before completing the turn".to_string()
            } else {
                format!("Codex app-server closed before completing the turn: {stderr}")
            });
        }
        if response.is_empty() {
            response = final_response
                .filter(|text| !text.is_empty())
                .ok_or_else(|| {
                    if stderr.is_empty() {
                        "Codex CLI returned an empty response".to_string()
                    } else {
                        format!("Codex CLI returned an empty response: {stderr}")
                    }
                })?;
            emit_chunk(app, session_id, response.clone());
        }
        Ok(response)
    })
    .await
    .map_err(|_| "Codex CLI timed out".to_string())?;

    let _ = tokio::fs::remove_dir_all(&workdir).await;
    result
}

async fn run_completion(
    app: &AppHandle,
    session_id: &str,
    provider: AiProvider,
    prompt: &str,
) -> Result<String, String> {
    let command_name = provider
        .command_name()
        .ok_or_else(|| "Invalid AI harness provider".to_string())?;
    let command_path = find_executable(command_name).ok_or_else(|| {
        format!(
            "{} CLI not found. Install it or make `{}` available on PATH.",
            provider.display_name(),
            command_name
        )
    })?;

    match provider {
        AiProvider::ClaudeCode => {
            run_claude_completion(app, session_id, prompt, command_path).await
        }
        AiProvider::CodexCli => run_codex_completion(app, session_id, prompt, command_path).await,
        AiProvider::OpencodeCli => {
            let response = run_opencode_completion(prompt, command_path).await?;
            emit_chunk(app, session_id, response.clone());
            Ok(response)
        }
        AiProvider::OpenAI => Err("Invalid AI harness provider".to_string()),
    }
}

pub async fn generate_sql(
    app: AppHandle,
    session_id: String,
    provider: AiProvider,
    system_prompt: String,
    user_prompt: String,
) -> Result<(), String> {
    let prompt = harness_prompt(&system_prompt, &user_prompt);
    let response = run_completion(&app, &session_id, provider, &prompt).await?;
    let cleaned = clean_generated_sql(&response);
    emit_done(&app, session_id, cleaned);
    Ok(())
}

pub async fn detect_provider(provider: AiProvider) -> AiHarnessStatus {
    let command_name = provider.command_name().unwrap_or_default();
    let Some(path) = find_executable(command_name) else {
        return AiHarnessStatus {
            provider: provider.as_str().to_string(),
            name: provider.display_name().to_string(),
            available: false,
            path: None,
            version: None,
            error: Some(format!("`{}` not found", command_name)),
        };
    };

    let mut command = Command::new(&path);
    command.arg("--version");
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command.kill_on_drop(true);
    if let Some(path_env) = gui_path() {
        command.env("PATH", path_env);
    }

    match timeout(HARNESS_DETECT_TIMEOUT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let version = if stdout.is_empty() { stderr } else { stdout };
            AiHarnessStatus {
                provider: provider.as_str().to_string(),
                name: provider.display_name().to_string(),
                available: true,
                path: Some(path.to_string_lossy().into_owned()),
                version: version.lines().next().map(str::to_string),
                error: None,
            }
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            AiHarnessStatus {
                provider: provider.as_str().to_string(),
                name: provider.display_name().to_string(),
                available: false,
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                error: Some(if stderr.is_empty() {
                    "Version check failed".to_string()
                } else {
                    stderr
                }),
            }
        }
        Ok(Err(error)) => AiHarnessStatus {
            provider: provider.as_str().to_string(),
            name: provider.display_name().to_string(),
            available: false,
            path: Some(path.to_string_lossy().into_owned()),
            version: None,
            error: Some(error.to_string()),
        },
        Err(_) => AiHarnessStatus {
            provider: provider.as_str().to_string(),
            name: provider.display_name().to_string(),
            available: false,
            path: Some(path.to_string_lossy().into_owned()),
            version: None,
            error: Some("Version check timed out".to_string()),
        },
    }
}

pub async fn detect_harnesses() -> Vec<AiHarnessStatus> {
    join_all(AiProvider::harnesses().map(detect_provider)).await
}

#[cfg(test)]
mod tests {
    use super::{
        claude_result_text, claude_text_delta, codex_final_message, codex_text_delta,
        codex_turn_completion,
    };

    #[test]
    fn extracts_claude_partial_text_deltas() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"SELECT "}}}"#;

        assert_eq!(claude_text_delta(line).as_deref(), Some("SELECT "));
        assert_eq!(
            claude_text_delta(
                r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}}"#,
            ),
            None
        );
    }

    #[test]
    fn extracts_claude_result_as_a_non_streaming_fallback() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"SELECT 1;"}"#;

        assert_eq!(claude_result_text(line).as_deref(), Some("SELECT 1;"));
    }

    #[test]
    fn extracts_codex_agent_message_deltas() {
        let line = r#"{"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","delta":"SELECT "}}"#;

        assert_eq!(codex_text_delta(line).as_deref(), Some("SELECT "));
    }

    #[test]
    fn extracts_codex_completed_message_as_a_non_streaming_fallback() {
        let line = r#"{"method":"item/completed","params":{"item":{"id":"item-1","type":"agentMessage","text":"SELECT 1;"}}}"#;

        assert_eq!(codex_final_message(line).as_deref(), Some("SELECT 1;"));
    }

    #[test]
    fn recognizes_codex_turn_completion_and_failures() {
        let completed =
            r#"{"method":"turn/completed","params":{"turn":{"status":"completed","error":null}}}"#;
        let failed = r#"{"method":"turn/completed","params":{"turn":{"status":"failed","error":{"message":"model unavailable"}}}}"#;

        assert_eq!(codex_turn_completion(completed), Some(Ok(())));
        assert_eq!(
            codex_turn_completion(failed),
            Some(Err("model unavailable".to_string()))
        );
    }
}
