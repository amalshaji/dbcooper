use fs2::FileExt;
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};

const VERSION: &str = "1.5.5";
const MAX_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES: u64 = 96 * 1024 * 1024;
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(50);
const APP_IDENTIFIER: &str = "com.amalshaji.dbcooper";
pub const PROGRESS_EVENT: &str = "duckdb-helper-progress";

static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone)]
struct Archive {
    url: String,
    sha256: &'static str,
    executable_name: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbHelperStatus {
    pub version: &'static str,
    pub path: String,
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuckDbHelperProgress {
    stage: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

fn archive_for(os: &str, arch: &str) -> Result<Archive, String> {
    let (filename, sha256, executable_name) = match (os, arch) {
        ("linux", "x86_64") => (
            "duckdb_cli-linux-amd64.zip",
            "08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05",
            "duckdb",
        ),
        ("linux", "aarch64") => (
            "duckdb_cli-linux-arm64.zip",
            "02163197027a42149147364d31fa67cac82108517a4be43304a1cc226eaef07a",
            "duckdb",
        ),
        ("macos", "x86_64") => (
            "duckdb_cli-osx-amd64.zip",
            "47cbda17c5d4643a58833617dfae649a6a8722d7e54435a08161b98ac1c4e832",
            "duckdb",
        ),
        ("macos", "aarch64") => (
            "duckdb_cli-osx-arm64.zip",
            "da5177b8869c4ed8c65d514fb47a8ed0f6fa7427f103304932d5e83851e46abd",
            "duckdb",
        ),
        ("windows", "x86_64") => (
            "duckdb_cli-windows-amd64.zip",
            "e1428b7114a841626b5054723731cbf45c6df91b42ae1a6c355f88fad1f6dc4c",
            "duckdb.exe",
        ),
        ("windows", "aarch64") => (
            "duckdb_cli-windows-arm64.zip",
            "9d0370d085684e1619ecc5efb2656cde930c50f1418380f0ae9d0379ddf06b12",
            "duckdb.exe",
        ),
        _ => return Err(format!("DuckDB support is not available for {os}/{arch}")),
    };

    Ok(Archive {
        url: format!("https://github.com/duckdb/duckdb/releases/download/v{VERSION}/{filename}"),
        sha256,
        executable_name,
    })
}

fn current_archive() -> Result<Archive, String> {
    archive_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = APP_DATA_DIR.get() {
        return Ok(path.clone());
    }
    dirs::data_dir()
        .map(|path| path.join(APP_IDENTIFIER))
        .ok_or_else(|| "Could not determine the application data directory".to_string())
}

pub fn set_app_data_dir(path: PathBuf) {
    let _ = APP_DATA_DIR.set(path);
}

pub fn helper_path() -> Result<PathBuf, String> {
    let archive = current_archive()?;
    Ok(app_data_dir()?
        .join("duckdb")
        .join(VERSION)
        .join(archive.executable_name))
}

fn marker_path(executable: &Path) -> PathBuf {
    executable.with_extension("verified")
}

fn is_installed(executable: &Path, archive: &Archive) -> bool {
    executable.is_file()
        && std::fs::read_to_string(marker_path(executable))
            .is_ok_and(|value| value.trim() == archive.sha256)
}

pub fn is_helper_installed() -> bool {
    current_archive()
        .and_then(|archive| helper_path().map(|path| is_installed(&path, &archive)))
        .unwrap_or(false)
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = hex::encode(Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err("DuckDB helper integrity verification failed".to_string())
    }
}

fn extract_executable(bytes: &[u8], executable_name: &str) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Invalid DuckDB helper archive: {error}"))?;
    let mut file = archive
        .by_name(executable_name)
        .map_err(|_| "DuckDB helper archive does not contain the CLI executable".to_string())?;
    if file.size() > MAX_EXECUTABLE_BYTES {
        return Err("DuckDB helper executable exceeds the allowed size".to_string());
    }
    let mut executable = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut executable)
        .map_err(|error| format!("Could not extract DuckDB helper: {error}"))?;
    Ok(executable)
}

fn report_progress(
    reporter: Option<&(dyn Fn(DuckDbHelperProgress) + Send + Sync)>,
    stage: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    if let Some(reporter) = reporter {
        reporter(DuckDbHelperProgress {
            stage,
            downloaded_bytes,
            total_bytes,
        });
    }
}

fn should_emit_download_progress(
    last_emit: Instant,
    now: Instant,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) -> bool {
    total_bytes.is_some_and(|total| downloaded_bytes >= total)
        || now.duration_since(last_emit) >= PROGRESS_EMIT_INTERVAL
}

async fn download_archive(
    reporter: Option<&(dyn Fn(DuckDbHelperProgress) + Send + Sync)>,
    archive: &Archive,
) -> Result<Vec<u8>, String> {
    let response = reqwest::Client::new()
        .get(&archive.url)
        .send()
        .await
        .map_err(|error| format!("Could not download DuckDB helper: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not download DuckDB helper: {error}"))?;
    let total = response.content_length();
    if total.is_some_and(|total| total > MAX_ARCHIVE_BYTES as u64) {
        return Err("DuckDB helper download exceeds the allowed size".to_string());
    }

    report_progress(reporter, "downloading", 0, total);

    let mut bytes = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = response.bytes_stream();
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("DuckDB helper download failed: {error}"))?;
        if bytes.len() + chunk.len() > MAX_ARCHIVE_BYTES {
            return Err("DuckDB helper download exceeds the allowed size".to_string());
        }
        bytes.extend_from_slice(&chunk);
        let now = Instant::now();
        if should_emit_download_progress(last_emit, now, bytes.len() as u64, total) {
            report_progress(reporter, "downloading", bytes.len() as u64, total);
            last_emit = now;
        }
    }
    Ok(bytes)
}

async fn install_executable(
    executable: &[u8],
    destination: &Path,
    archive: &Archive,
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Invalid DuckDB helper destination".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Could not create DuckDB helper directory: {error}"))?;
    let temporary = staging_path(destination);
    let result = async {
        tokio::fs::write(&temporary, executable)
            .await
            .map_err(|error| format!("Could not write DuckDB helper: {error}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o700))
                .await
                .map_err(|error| format!("Could not make DuckDB helper executable: {error}"))?;
        }

        let _ = tokio::fs::remove_file(marker_path(destination)).await;
        replace_file_atomically(&temporary, destination).await?;
        tokio::fs::write(marker_path(destination), archive.sha256)
            .await
            .map_err(|error| format!("Could not record DuckDB helper verification: {error}"))?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

#[cfg(not(windows))]
async fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    tokio::fs::rename(source, destination)
        .await
        .map_err(|error| format!("Could not install DuckDB helper: {error}"))
}

#[cfg(windows)]
async fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    tokio::task::spawn_blocking(move || {
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            Err(format!(
                "Could not install DuckDB helper: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    })
    .await
    .map_err(|error| format!("Could not install DuckDB helper: {error}"))?
}

fn staging_path(destination: &Path) -> PathBuf {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("duckdb");
    destination.with_file_name(format!(
        "{file_name}.{}.download",
        uuid::Uuid::new_v4().simple()
    ))
}

struct InstallFileLock(std::fs::File);

impl Drop for InstallFileLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

async fn acquire_install_file_lock(path: PathBuf) -> Result<InstallFileLock, String> {
    tokio::task::spawn_blocking(move || {
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("Could not open DuckDB helper install lock: {error}"))?;
        file.lock_exclusive()
            .map_err(|error| format!("Could not lock DuckDB helper installation: {error}"))?;
        Ok(InstallFileLock(file))
    })
    .await
    .map_err(|error| format!("Could not acquire DuckDB helper install lock: {error}"))?
}

async fn ensure_duckdb_helper_inner(
    reporter: Option<&(dyn Fn(DuckDbHelperProgress) + Send + Sync)>,
) -> Result<DuckDbHelperStatus, String> {
    let archive = current_archive()?;
    let destination = helper_path()?;
    let lock = INSTALL_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().await;
    let parent = destination
        .parent()
        .ok_or_else(|| "Invalid DuckDB helper destination".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Could not create DuckDB helper directory: {error}"))?;
    let _file_guard = acquire_install_file_lock(parent.join(".install.lock")).await?;

    if is_installed(&destination, &archive) {
        report_progress(reporter, "ready", 0, None);
        return Ok(DuckDbHelperStatus {
            version: VERSION,
            path: destination.to_string_lossy().into_owned(),
            downloaded: false,
        });
    }

    report_progress(reporter, "downloading", 0, None);
    let bytes = download_archive(reporter, &archive).await?;
    report_progress(
        reporter,
        "verifying",
        bytes.len() as u64,
        Some(bytes.len() as u64),
    );
    verify_sha256(&bytes, archive.sha256)?;
    let executable_name = archive.executable_name;
    let executable =
        tokio::task::spawn_blocking(move || extract_executable(&bytes, executable_name))
            .await
            .map_err(|error| format!("Could not extract DuckDB helper: {error}"))??;
    report_progress(reporter, "installing", 0, None);
    install_executable(&executable, &destination, &archive).await?;
    report_progress(reporter, "ready", 0, None);

    Ok(DuckDbHelperStatus {
        version: VERSION,
        path: destination.to_string_lossy().into_owned(),
        downloaded: true,
    })
}

pub async fn ensure_duckdb_helper_silent() -> Result<DuckDbHelperStatus, String> {
    ensure_duckdb_helper_inner(None).await
}

#[tauri::command]
pub async fn ensure_duckdb_helper(app: AppHandle) -> Result<DuckDbHelperStatus, String> {
    let reporter = |progress| {
        let _ = app.emit(PROGRESS_EVENT, progress);
    };
    ensure_duckdb_helper_inner(Some(&reporter)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_the_pinned_archive_for_supported_targets() {
        let archive = archive_for("macos", "aarch64").unwrap();

        assert_eq!(VERSION, "1.5.5");
        assert!(archive.url.ends_with("duckdb_cli-osx-arm64.zip"));
        assert_eq!(archive.sha256.len(), 64);
    }

    #[test]
    fn rejects_unsupported_targets() {
        let error = archive_for("freebsd", "x86_64").unwrap_err();

        assert!(error.contains("not available"));
    }

    #[test]
    fn rejects_downloads_with_the_wrong_digest() {
        let error = verify_sha256(b"tampered", &"0".repeat(64)).unwrap_err();

        assert!(error.contains("integrity"));
    }

    #[test]
    fn accepts_downloads_with_the_pinned_digest() {
        verify_sha256(
            b"abc",
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )
        .unwrap();
    }

    #[test]
    fn throttles_chunk_updates_but_always_emits_completion() {
        let start = Instant::now();

        assert!(!should_emit_download_progress(
            start,
            start + Duration::from_millis(20),
            10,
            Some(100),
        ));
        assert!(should_emit_download_progress(
            start,
            start + Duration::from_millis(60),
            20,
            Some(100),
        ));
        assert!(should_emit_download_progress(
            start,
            start + Duration::from_millis(20),
            100,
            Some(100),
        ));
    }

    #[test]
    fn uses_a_unique_staging_path_for_each_install_attempt() {
        let destination = Path::new("/tmp/duckdb/1.5.5/duckdb");

        assert_ne!(staging_path(destination), staging_path(destination));
    }

    #[tokio::test]
    async fn holds_an_exclusive_install_lock_across_file_handles() {
        let directory = tempfile::tempdir().unwrap();
        let lock_path = directory.path().join(".install.lock");
        let first = acquire_install_file_lock(lock_path.clone()).await.unwrap();
        let second = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(lock_path)
            .unwrap();

        assert!(second.try_lock_exclusive().is_err());
        drop(first);
        assert!(second.try_lock_exclusive().is_ok());
    }

    #[tokio::test]
    async fn installs_only_a_complete_verified_executable() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("duckdb");
        let archive = Archive {
            url: "https://example.invalid/duckdb.zip".to_string(),
            sha256: "verified-digest",
            executable_name: "duckdb",
        };
        std::fs::write(&destination, b"incomplete executable").unwrap();

        install_executable(b"duckdb executable", &destination, &archive)
            .await
            .unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"duckdb executable");
        assert!(is_installed(&destination, &archive));
        assert!(std::fs::read_dir(directory.path())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".download")));
    }
}
