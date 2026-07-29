mod claude;
mod codex;
mod opencode;
mod process;

use self::process::{find_executable, gui_path, DETECT_TIMEOUT};
use crate::ai::prompts::harness_prompt;
use crate::ai::settings::AiProvider;
use crate::ai::{clean_generated_sql, emit_chunk, emit_done};
use futures_util::future::join_all;
use serde::Serialize;
use std::{path::PathBuf, process::Stdio};
use tauri::AppHandle;
use tokio::{process::Command, time::timeout};

#[derive(Clone, Serialize)]
pub struct AiHarnessStatus {
    pub provider: String,
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
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
        AiProvider::ClaudeCode => claude::run(app, session_id, prompt, command_path).await,
        AiProvider::CodexCli => codex::run(app, session_id, prompt, command_path).await,
        AiProvider::OpencodeCli => {
            let response = opencode::run(prompt, command_path).await?;
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

fn unavailable_status(
    provider: AiProvider,
    path: Option<PathBuf>,
    error: String,
) -> AiHarnessStatus {
    AiHarnessStatus {
        provider: provider.as_str().to_string(),
        name: provider.display_name().to_string(),
        available: false,
        path: path.map(|path| path.to_string_lossy().into_owned()),
        version: None,
        error: Some(error),
    }
}

pub async fn detect_provider(provider: AiProvider) -> AiHarnessStatus {
    let command_name = provider.command_name().unwrap_or_default();
    let Some(path) = find_executable(command_name) else {
        return unavailable_status(provider, None, format!("`{command_name}` not found"));
    };

    let mut command = Command::new(&path);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path_env) = gui_path() {
        command.env("PATH", path_env);
    }

    match timeout(DETECT_TIMEOUT, command.output()).await {
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
            unavailable_status(
                provider,
                Some(path),
                if stderr.is_empty() {
                    "Version check failed".to_string()
                } else {
                    stderr
                },
            )
        }
        Ok(Err(error)) => unavailable_status(provider, Some(path), error.to_string()),
        Err(_) => unavailable_status(provider, Some(path), "Version check timed out".to_string()),
    }
}

pub async fn detect_harnesses() -> Vec<AiHarnessStatus> {
    join_all(AiProvider::harnesses().map(detect_provider)).await
}
