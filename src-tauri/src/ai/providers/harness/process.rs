use std::{
    env,
    future::Future,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};

pub(super) const COMPLETION_TIMEOUT: Duration = Duration::from_secs(120);
pub(super) const DETECT_TIMEOUT: Duration = Duration::from_secs(5);

fn path_has_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn executable_paths(command: &str) -> Vec<PathBuf> {
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

pub(super) fn find_executable(command: &str) -> Option<PathBuf> {
    executable_paths(command)
        .into_iter()
        .find(|path| path_has_executable(path))
}

pub(super) fn gui_path() -> Option<String> {
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

pub(super) fn command(command_path: PathBuf, workdir: &Path) -> Command {
    let mut command = Command::new(command_path);
    command.current_dir(workdir).kill_on_drop(true);
    if let Some(path) = gui_path() {
        command.env("PATH", path);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
}

pub(super) async fn with_workdir<T, F, Fut>(run: F) -> Result<T, String>
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let workdir = env::temp_dir().join(format!("dbcooper-ai-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&workdir)
        .await
        .map_err(|error| format!("Failed to create AI harness workdir: {error}"))?;
    let result = run(workdir.clone()).await;
    let _ = tokio::fs::remove_dir_all(workdir).await;
    result
}

pub(super) async fn collect_stderr(
    mut stderr: tokio::process::ChildStderr,
) -> Result<String, String> {
    let mut bytes = Vec::new();
    stderr
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::with_workdir;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn removes_the_workdir_after_a_failed_completion() {
        let observed_path = Arc::new(Mutex::new(None));
        let captured_path = Arc::clone(&observed_path);

        let result = with_workdir(|workdir| async move {
            *captured_path.lock().unwrap() = Some(workdir);
            Err::<(), _>("provider failed".to_string())
        })
        .await;

        assert_eq!(result, Err("provider failed".to_string()));
        let workdir = observed_path.lock().unwrap().clone().unwrap();
        assert!(!workdir.exists());
    }
}
