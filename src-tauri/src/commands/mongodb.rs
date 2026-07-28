use crate::database::mongodb::{
    CreateMongoIndexRequest, MongoAggregateRequest, MongoDatabaseInfo, MongoDeleteRequest,
    MongoDocumentMutation, MongoDocumentPage, MongoFindRequest, MongoIndexInfo,
    MongoMutationResult, MongoReplaceRequest, MongoValidatorSettings, SetMongoValidatorRequest,
};
use crate::database::pool_manager::PoolManager;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn mongo_test_connection(
    connection_uri: String,
) -> Result<crate::db::models::TestConnectionResult, String> {
    let driver = crate::database::mongodb::MongoDriver::connect(connection_uri).await?;
    let result = driver.ping().await;
    driver.shutdown().await;
    result
}

async fn driver(
    manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<Arc<crate::database::mongodb::MongoDriver>, String> {
    manager.ensure_connected(sqlite_pool, uuid).await?;
    manager.get_mongo_driver(uuid).await
}

#[tauri::command]
pub async fn mongo_list_catalog(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<Vec<MongoDatabaseInfo>, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .catalog()
        .await
}

#[tauri::command]
pub async fn mongo_find(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: MongoFindRequest,
) -> Result<MongoDocumentPage, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .find(request)
        .await
}

#[tauri::command]
pub async fn mongo_aggregate(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: MongoAggregateRequest,
) -> Result<MongoDocumentPage, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .aggregate(request)
        .await
}

#[tauri::command]
pub async fn mongo_insert_one(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: MongoDocumentMutation,
) -> Result<MongoMutationResult, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .insert_one(request)
        .await
}

#[tauri::command]
pub async fn mongo_replace_one(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: MongoReplaceRequest,
) -> Result<MongoMutationResult, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .replace_one(request)
        .await
}

#[tauri::command]
pub async fn mongo_delete_one(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: MongoDeleteRequest,
) -> Result<MongoMutationResult, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .delete_one(request)
        .await
}

#[tauri::command]
pub async fn mongo_create_collection(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    database: String,
    collection: String,
) -> Result<(), String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .create_collection(&database, &collection)
        .await
}

#[tauri::command]
pub async fn mongo_drop_collection(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    database: String,
    collection: String,
) -> Result<(), String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .drop_collection(&database, &collection)
        .await
}

#[tauri::command]
pub async fn mongo_list_indexes(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    database: String,
    collection: String,
) -> Result<Vec<MongoIndexInfo>, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .list_indexes(&database, &collection)
        .await
}

#[tauri::command]
pub async fn mongo_create_index(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: CreateMongoIndexRequest,
) -> Result<String, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .create_index(request)
        .await
}

#[tauri::command]
pub async fn mongo_drop_index(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    database: String,
    collection: String,
    name: String,
) -> Result<(), String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .drop_index(&database, &collection, &name)
        .await
}

#[tauri::command]
pub async fn mongo_get_validator(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    database: String,
    collection: String,
) -> Result<MongoValidatorSettings, String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .get_validator(&database, &collection)
        .await
}

#[tauri::command]
pub async fn mongo_set_validator(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: SetMongoValidatorRequest,
) -> Result<(), String> {
    driver(&pool_manager, sqlite_pool.inner(), &uuid)
        .await?
        .set_validator(request)
        .await
}
