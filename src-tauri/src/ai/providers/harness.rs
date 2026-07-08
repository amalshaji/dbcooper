use crate::ai::prompts::harness_prompt;
use crate::ai::settings::AiProvider;
use crate::ai::{clean_generated_sql, emit_chunk, emit_done};
use futures_util::future::join_all;
use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::AppHandle;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

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

fn build_command(
    provider: AiProvider,
    prompt: &str,
    command_path: PathBuf,
    workdir: &Path,
) -> (Command, Option<Vec<u8>>) {
    let mut command = Command::new(command_path);
    command.current_dir(workdir);
    command.kill_on_drop(true);
    if let Some(path) = gui_path() {
        command.env("PATH", path);
    }

    let stdin_payload = match provider {
        AiProvider::ClaudeCode => {
            command.args([
                "--print",
                "--output-format",
                "text",
                "--no-session-persistence",
                "--tools",
                "",
                prompt,
            ]);
            None
        }
        AiProvider::CodexCli => {
            command.args([
                "exec",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--ignore-rules",
                "--skip-git-repo-check",
                "-C",
            ]);
            command.arg(workdir);
            command.arg("-");
            Some(prompt.as_bytes().to_vec())
        }
        AiProvider::OpencodeCli => {
            command.args(["run", "--pure", "--dir"]);
            command.arg(workdir);
            command.args(["--format", "default", prompt]);
            None
        }
        AiProvider::OpenAI => None,
    };

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_payload.is_some() {
        command.stdin(Stdio::piped());
    }

    (command, stdin_payload)
}

async fn run_command(
    provider: AiProvider,
    prompt: &str,
    command_path: PathBuf,
) -> Result<String, String> {
    let workdir = create_workdir().await?;
    let (mut command, stdin_payload) = build_command(provider, prompt, command_path, &workdir);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start {}: {}", provider.display_name(), e))?;

    if let Some(payload) = stdin_payload {
        let Some(mut stdin) = child.stdin.take() else {
            let _ = tokio::fs::remove_dir_all(&workdir).await;
            return Err(format!(
                "Failed to open stdin for {}",
                provider.display_name()
            ));
        };
        if let Err(error) = stdin.write_all(&payload).await {
            let _ = tokio::fs::remove_dir_all(&workdir).await;
            return Err(format!(
                "Failed to write prompt to {}: {}",
                provider.display_name(),
                error
            ));
        }
    }

    let output_result = timeout(HARNESS_TIMEOUT, child.wait_with_output()).await;
    let _ = tokio::fs::remove_dir_all(&workdir).await;
    let output = output_result
        .map_err(|_| format!("{} timed out", provider.display_name()))?
        .map_err(|e| format!("{} failed: {}", provider.display_name(), e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "{} exited with an error: {}",
            provider.display_name(),
            details
        ));
    }

    if stdout.is_empty() {
        return Err(format!(
            "{} returned an empty response",
            provider.display_name()
        ));
    }

    Ok(stdout)
}

async fn run_completion(provider: AiProvider, prompt: &str) -> Result<String, String> {
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

    run_command(provider, prompt, command_path).await
}

pub async fn generate_sql(
    app: AppHandle,
    session_id: String,
    provider: AiProvider,
    system_prompt: String,
    user_prompt: String,
) -> Result<(), String> {
    let prompt = harness_prompt(&system_prompt, &user_prompt);
    let response = run_completion(provider, &prompt).await?;
    let cleaned = clean_generated_sql(&response);
    emit_chunk(&app, &session_id, cleaned.clone());
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
