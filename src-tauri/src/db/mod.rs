use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use thiserror::Error;

const LOCAL_STORE_ENV: &str = "DBCOOPER_LOCAL_STORE";

pub mod models;
pub mod settings;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("Migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("Failed to get data directory")]
    DataDir,
    #[error("DBCOOPER_LOCAL_STORE cannot be empty")]
    InvalidLocalStore,
    #[error("Failed to prepare local store directory {path}: {source}")]
    LocalStore {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

pub type DbResult<T> = Result<T, DbError>;

fn resolve_db_path(
    custom_store: Option<OsString>,
    data_local_dir: Option<PathBuf>,
) -> DbResult<PathBuf> {
    let store_dir = match custom_store {
        Some(path) if path.is_empty() => Err(DbError::InvalidLocalStore),
        Some(path) => Ok(PathBuf::from(path)),
        None => Ok(data_local_dir.ok_or(DbError::DataDir)?.join("dbcooper")),
    }?;

    Ok(store_dir.join("db.sqlite3"))
}

fn prepare_db_path(db_path: &Path) -> DbResult<()> {
    if let Some(parent) = db_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|source| DbError::LocalStore {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

fn get_db_path() -> DbResult<PathBuf> {
    resolve_db_path(std::env::var_os(LOCAL_STORE_ENV), dirs::data_local_dir())
}

async fn init_pool_at(db_path: &Path) -> DbResult<SqlitePool> {
    prepare_db_path(db_path)?;
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("PRAGMA journal_mode = WAL;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA synchronous = NORMAL;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA foreign_keys = ON;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA busy_timeout = 5000;")
                    .execute(&mut *conn)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

pub async fn init_pool() -> DbResult<SqlitePool> {
    let db_path = get_db_path()?;
    init_pool_at(&db_path).await
}

#[cfg(test)]
mod tests {
    use super::{init_pool_at, prepare_db_path, resolve_db_path, DbError};
    use std::ffi::OsString;
    use std::path::PathBuf;

    #[test]
    fn uses_the_default_application_store_when_no_override_is_set() {
        let path = resolve_db_path(None, Some(PathBuf::from("/application-data"))).unwrap();

        assert_eq!(path, PathBuf::from("/application-data/dbcooper/db.sqlite3"));
    }

    #[test]
    fn appends_the_database_filename_to_a_custom_store_directory() {
        let path = resolve_db_path(
            Some(OsString::from("custom_path")),
            Some(PathBuf::from("/application-data")),
        )
        .unwrap();

        assert_eq!(path, PathBuf::from("custom_path/db.sqlite3"));
    }

    #[test]
    fn treats_custom_stores_as_directories_regardless_of_extension() {
        for path in ["custom_path/branch", "custom_path/branch.sqlite3"] {
            let resolved = resolve_db_path(
                Some(OsString::from(path)),
                Some(PathBuf::from("/application-data")),
            )
            .unwrap();

            assert_eq!(resolved, PathBuf::from(path).join("db.sqlite3"));
        }
    }

    #[test]
    fn rejects_an_empty_custom_store() {
        let error = resolve_db_path(
            Some(OsString::new()),
            Some(PathBuf::from("/application-data")),
        )
        .unwrap_err();

        assert!(matches!(error, DbError::InvalidLocalStore));
    }

    #[test]
    fn creates_nested_directories_for_the_database() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("branches/feature/db.sqlite3");

        prepare_db_path(&db_path).unwrap();

        assert!(temp_dir.path().join("branches/feature").is_dir());
    }

    #[test]
    fn reports_when_the_custom_store_directory_cannot_be_created() {
        let temp_dir = tempfile::tempdir().unwrap();
        let blocking_file = temp_dir.path().join("blocking-file");
        std::fs::write(&blocking_file, "not a directory").unwrap();
        let db_path = blocking_file.join("branch/db.sqlite3");

        let error = prepare_db_path(&db_path).unwrap_err();

        assert!(matches!(error, DbError::LocalStore { .. }));
    }

    #[tokio::test]
    async fn opens_database_at_a_store_path_with_url_special_characters() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir
            .path()
            .join("branch%2Fname?draft")
            .join("db.sqlite3");

        let pool = init_pool_at(&db_path).await.unwrap();
        pool.close().await;

        assert!(db_path.is_file());
        assert!(!temp_dir.path().join("branch/name").exists());
    }
}
