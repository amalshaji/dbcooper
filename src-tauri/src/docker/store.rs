use super::model::DockerLink;
use crate::db::models::{Connection, ConnectionFormData};
use sqlx::{Sqlite, SqlitePool, Transaction};

async fn insert_connection(
    transaction: &mut Transaction<'_, Sqlite>,
    uuid: &str,
    data: &ConnectionFormData,
) -> Result<Connection, String> {
    sqlx::query_as::<_, Connection>(
        r#"INSERT INTO connections
        (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path,
         ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, 0, '', 22, '', '', '', 0)
        RETURNING *"#,
    )
    .bind(uuid)
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(&data.db_type)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| error.to_string())
}

async fn insert_link(
    transaction: &mut Transaction<'_, Sqlite>,
    link: &DockerLink,
) -> Result<(), String> {
    sqlx::query(
        r#"INSERT INTO docker_connections
        (connection_uuid, ownership, docker_context, container_id, container_name, engine, image,
         internal_port, compose_project, compose_service, volume_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&link.connection_uuid)
    .bind(&link.ownership)
    .bind(&link.docker_context)
    .bind(&link.container_id)
    .bind(&link.container_name)
    .bind(&link.engine)
    .bind(&link.image)
    .bind(link.internal_port)
    .bind(&link.compose_project)
    .bind(&link.compose_service)
    .bind(&link.volume_name)
    .execute(&mut **transaction)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub(crate) async fn insert_connection_with_link(
    pool: &SqlitePool,
    uuid: &str,
    data: &ConnectionFormData,
    link: &DockerLink,
) -> Result<Connection, String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let connection = insert_connection(&mut transaction, uuid, data).await?;
    insert_link(&mut transaction, link).await?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

pub(crate) async fn get_link(pool: &SqlitePool, uuid: &str) -> Result<Option<DockerLink>, String> {
    sqlx::query_as("SELECT * FROM docker_connections WHERE connection_uuid = ?")
        .bind(uuid)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())
}

pub(crate) async fn get_links(pool: &SqlitePool) -> Result<Vec<DockerLink>, String> {
    sqlx::query_as("SELECT * FROM docker_connections")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())
}

pub(crate) async fn get_created_links(pool: &SqlitePool) -> Result<Vec<DockerLink>, String> {
    sqlx::query_as("SELECT * FROM docker_connections WHERE ownership = 'created'")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())
}

pub(crate) async fn update_runtime_identity(
    pool: &SqlitePool,
    uuid: &str,
    container_id: &str,
    container_name: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE docker_connections SET container_id = ?, container_name = ? WHERE connection_uuid = ?",
    )
    .bind(container_id)
    .bind(container_name)
    .bind(uuid)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub(crate) async fn update_connection_port(
    pool: &SqlitePool,
    uuid: &str,
    port: i64,
) -> Result<(), String> {
    sqlx::query("UPDATE connections SET port = ?, updated_at = datetime('now') WHERE uuid = ?")
        .bind(port)
        .bind(uuid)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) async fn delete_connection_with_link(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<DockerLink>, String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM connections WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    let link = sqlx::query_as("SELECT * FROM docker_connections WHERE connection_uuid = ?")
        .bind(&uuid)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(link)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docker::model::{DockerDatabaseEngine, ManagedDatabasePlan};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn rolls_back_connection_when_link_insert_fails() {
        let pool = test_pool().await;
        let plan = ManagedDatabasePlan::new(DockerDatabaseEngine::Postgres);
        let data = plan.connection_data("Local Postgres", 55432);
        let mut link = plan.link("desktop-linux".to_string(), "container".to_string());
        link.ownership = "invalid".to_string();

        assert!(insert_connection_with_link(&pool, &plan.uuid, &data, &link)
            .await
            .is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM connections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
