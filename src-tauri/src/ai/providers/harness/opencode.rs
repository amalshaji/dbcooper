use super::process::{command, with_workdir, COMPLETION_TIMEOUT};
use std::path::PathBuf;
use tokio::time::timeout;

pub(super) async fn run(prompt: &str, command_path: PathBuf) -> Result<String, String> {
    with_workdir(|workdir| async move {
        let mut command = command(command_path, &workdir);
        command.args(["run", "--pure", "--dir"]);
        command.arg(&workdir);
        command.args(["--format", "default", prompt]);

        let output = timeout(COMPLETION_TIMEOUT, command.output())
            .await
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
    })
    .await
}
