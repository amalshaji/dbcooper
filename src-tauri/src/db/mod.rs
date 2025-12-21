use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;
use thiserror::Error;

pub mod models;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("Migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("Failed to get data directory")]
    DataDir,
}

pub type DbResult<T> = Result<T, DbError>;

fn get_db_path() -> DbResult<PathBuf> {
    let data_dir = dirs::data_local_dir().ok_or(DbError::DataDir)?;
    let app_dir = data_dir.join("dbcooper");
    std::fs::create_dir_all(&app_dir).ok();
    Ok(app_dir.join("db.sqlite3"))
}

pub async fn init_pool() -> DbResult<SqlitePool> {
    let db_path = get_db_path()?;
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

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
        .connect(&db_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
