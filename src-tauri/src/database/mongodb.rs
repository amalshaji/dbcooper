use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{ClientOptions, IndexOptions, ServerApi, ServerApiVersion};
use mongodb::{Client, IndexModel};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

const DEFAULT_PAGE_SIZE: u32 = 100;
const MAX_PAGE_SIZE: u32 = 1_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MongoCollectionInfo {
    pub database: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MongoDatabaseInfo {
    pub name: String,
    pub collections: Vec<MongoCollectionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoFindRequest {
    pub database: String,
    pub collection: String,
    #[serde(default = "empty_document_json")]
    pub filter: Value,
    pub projection: Option<Value>,
    pub sort: Option<Value>,
    pub skip: Option<u64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoAggregateRequest {
    pub database: String,
    pub collection: String,
    #[serde(default)]
    pub pipeline: Vec<Value>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoDocumentPage {
    pub documents: Vec<Value>,
    pub returned_count: usize,
    pub has_more: bool,
    pub execution_time_ms: u128,
    pub estimated_total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoDocumentMutation {
    pub database: String,
    pub collection: String,
    pub document: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoReplaceRequest {
    pub database: String,
    pub collection: String,
    pub id: Value,
    pub document: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoDeleteRequest {
    pub database: String,
    pub collection: String,
    pub id: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoMutationResult {
    pub acknowledged: bool,
    pub id: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoIndexInfo {
    pub name: String,
    pub keys: Value,
    pub unique: bool,
    pub sparse: bool,
    pub expire_after_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoIndexKey {
    pub field: String,
    pub direction: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMongoIndexRequest {
    pub database: String,
    pub collection: String,
    pub keys: Vec<MongoIndexKey>,
    pub name: Option<String>,
    #[serde(default)]
    pub unique: bool,
    #[serde(default)]
    pub sparse: bool,
    pub expire_after_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoValidatorSettings {
    pub validator: Value,
    pub validation_level: String,
    pub validation_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetMongoValidatorRequest {
    pub database: String,
    pub collection: String,
    pub validator: Value,
    pub validation_level: String,
    pub validation_action: String,
}

fn empty_document_json() -> Value {
    Value::Object(Default::default())
}

pub fn validate_connection_uri(uri: &str) -> Result<(), String> {
    if uri.len() > 8 * 1024 {
        return Err("MongoDB URI must be 8 KiB or less".to_string());
    }
    if !(uri.starts_with("mongodb://") || uri.starts_with("mongodb+srv://")) {
        return Err("MongoDB URI must start with mongodb:// or mongodb+srv://".to_string());
    }
    Ok(())
}

fn safe_error(context: &str, error: impl std::fmt::Display, uri: &str) -> String {
    let mut message = error.to_string().replace(uri, "[redacted MongoDB URI]");
    if let Some((_, authority)) = uri.split_once("://") {
        if let Some((credentials, _)) = authority.split_once('@') {
            if !credentials.is_empty() {
                message = message.replace(credentials, "[redacted]");
            }
        }
    }
    format!("{context}: {message}")
}

fn json_document(value: Value, field: &str) -> Result<Document, String> {
    match serde_json::from_value::<Bson>(value)
        .map_err(|error| format!("Invalid Extended JSON in {field}: {error}"))?
    {
        Bson::Document(document) => Ok(document),
        _ => Err(format!("{field} must be a JSON object")),
    }
}

fn bson_json(value: Bson) -> Value {
    value.into_canonical_extjson()
}

fn page_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE)
}

pub fn ensure_read_only_pipeline(pipeline: &[Value]) -> Result<(), String> {
    for stage in pipeline {
        let object = stage
            .as_object()
            .ok_or_else(|| "Each aggregation stage must be a JSON object".to_string())?;
        if object.contains_key("$out") || object.contains_key("$merge") {
            return Err("$out and $merge are not allowed in read-only aggregations".to_string());
        }
    }
    Ok(())
}

pub struct MongoDriver {
    client: Client,
    uri: String,
}

impl MongoDriver {
    pub async fn connect(uri: String) -> Result<Self, String> {
        validate_connection_uri(&uri)?;
        let mut options = ClientOptions::parse(&uri)
            .await
            .map_err(|error| safe_error("Invalid MongoDB URI", error, &uri))?;
        options.app_name = Some("DBcooper".to_string());
        options.server_api = Some(
            ServerApi::builder()
                .version(ServerApiVersion::V1)
                .strict(false)
                .deprecation_errors(false)
                .build(),
        );
        let client = Client::with_options(options)
            .map_err(|error| safe_error("Failed to configure MongoDB", error, &uri))?;
        Ok(Self { client, uri })
    }

    pub async fn ping(&self) -> Result<crate::db::models::TestConnectionResult, String> {
        self.client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|error| safe_error("MongoDB connection failed", error, &self.uri))?;
        Ok(crate::db::models::TestConnectionResult {
            success: true,
            message: "Connected successfully".to_string(),
        })
    }

    pub async fn shutdown(&self) {
        self.client.clone().shutdown().await;
    }

    pub async fn catalog(&self) -> Result<Vec<MongoDatabaseInfo>, String> {
        let mut result = Vec::new();
        let names =
            self.client.list_database_names().await.map_err(|error| {
                safe_error("Failed to list MongoDB databases", error, &self.uri)
            })?;
        for name in names {
            let collections = self
                .client
                .database(&name)
                .list_collection_names()
                .await
                .map_err(|error| {
                    safe_error("Failed to list MongoDB collections", error, &self.uri)
                })?
                .into_iter()
                .map(|collection| MongoCollectionInfo {
                    database: name.clone(),
                    name: collection,
                })
                .collect();
            result.push(MongoDatabaseInfo { name, collections });
        }
        Ok(result)
    }

    pub async fn find(&self, request: MongoFindRequest) -> Result<MongoDocumentPage, String> {
        let started = Instant::now();
        let limit = page_limit(request.limit);
        let filter = json_document(request.filter, "filter")?;
        let collection = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection);
        let mut operation = collection.find(filter).limit(i64::from(limit) + 1);
        if let Some(projection) = request.projection {
            operation = operation.projection(json_document(projection, "projection")?);
        }
        if let Some(sort) = request.sort {
            operation = operation.sort(json_document(sort, "sort")?);
        }
        if let Some(skip) = request.skip {
            operation = operation.skip(skip);
        }
        let cursor = operation
            .await
            .map_err(|error| safe_error("MongoDB find failed", error, &self.uri))?;
        let mut documents: Vec<Document> = cursor
            .try_collect()
            .await
            .map_err(|error| safe_error("MongoDB find failed", error, &self.uri))?;
        let has_more = documents.len() > limit as usize;
        documents.truncate(limit as usize);
        let estimated_total = collection.estimated_document_count().await.ok();
        let documents: Vec<Value> = documents
            .into_iter()
            .map(|document| bson_json(Bson::Document(document)))
            .collect();
        Ok(MongoDocumentPage {
            returned_count: documents.len(),
            documents,
            has_more,
            execution_time_ms: started.elapsed().as_millis(),
            estimated_total,
        })
    }

    pub async fn aggregate(
        &self,
        request: MongoAggregateRequest,
    ) -> Result<MongoDocumentPage, String> {
        let started = Instant::now();
        ensure_read_only_pipeline(&request.pipeline)?;
        let limit = page_limit(request.limit);
        let mut pipeline: Vec<Document> = request
            .pipeline
            .into_iter()
            .map(|stage| json_document(stage, "pipeline stage"))
            .collect::<Result<_, _>>()?;
        pipeline.push(doc! { "$limit": i64::from(limit) + 1 });
        let cursor = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection)
            .aggregate(pipeline)
            .await
            .map_err(|error| safe_error("MongoDB aggregate failed", error, &self.uri))?;
        let mut documents: Vec<Document> = cursor
            .try_collect()
            .await
            .map_err(|error| safe_error("MongoDB aggregate failed", error, &self.uri))?;
        let has_more = documents.len() > limit as usize;
        documents.truncate(limit as usize);
        let documents: Vec<Value> = documents
            .into_iter()
            .map(|document| bson_json(Bson::Document(document)))
            .collect();
        Ok(MongoDocumentPage {
            returned_count: documents.len(),
            documents,
            has_more,
            execution_time_ms: started.elapsed().as_millis(),
            estimated_total: None,
        })
    }

    pub async fn insert_one(
        &self,
        request: MongoDocumentMutation,
    ) -> Result<MongoMutationResult, String> {
        let document = json_document(request.document, "document")?;
        let result = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection)
            .insert_one(document)
            .await
            .map_err(|error| safe_error("MongoDB insert failed", error, &self.uri))?;
        Ok(MongoMutationResult {
            acknowledged: true,
            id: Some(bson_json(result.inserted_id)),
        })
    }

    pub async fn replace_one(
        &self,
        request: MongoReplaceRequest,
    ) -> Result<MongoMutationResult, String> {
        let id: Bson = serde_json::from_value(request.id)
            .map_err(|error| format!("Invalid Extended JSON in _id: {error}"))?;
        let document = json_document(request.document, "document")?;
        if document.get("_id") != Some(&id) {
            return Err("Replacement document must preserve the original _id".to_string());
        }
        let result = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection)
            .replace_one(doc! { "_id": id }, document)
            .await
            .map_err(|error| safe_error("MongoDB replace failed", error, &self.uri))?;
        if result.matched_count != 1 {
            return Err(
                "Document was not found or changed before it could be replaced".to_string(),
            );
        }
        Ok(MongoMutationResult {
            acknowledged: true,
            id: None,
        })
    }

    pub async fn delete_one(
        &self,
        request: MongoDeleteRequest,
    ) -> Result<MongoMutationResult, String> {
        let id: Bson = serde_json::from_value(request.id)
            .map_err(|error| format!("Invalid Extended JSON in _id: {error}"))?;
        let result = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection)
            .delete_one(doc! { "_id": id })
            .await
            .map_err(|error| safe_error("MongoDB delete failed", error, &self.uri))?;
        if result.deleted_count != 1 {
            return Err("Document was not found or changed before it could be deleted".to_string());
        }
        Ok(MongoMutationResult {
            acknowledged: true,
            id: None,
        })
    }

    pub async fn create_collection(&self, database: &str, collection: &str) -> Result<(), String> {
        self.client
            .database(database)
            .create_collection(collection)
            .await
            .map_err(|error| safe_error("Failed to create MongoDB collection", error, &self.uri))?;
        Ok(())
    }

    pub async fn drop_collection(&self, database: &str, collection: &str) -> Result<(), String> {
        self.client
            .database(database)
            .collection::<Document>(collection)
            .drop()
            .await
            .map_err(|error| safe_error("Failed to drop MongoDB collection", error, &self.uri))?;
        Ok(())
    }

    pub async fn list_indexes(
        &self,
        database: &str,
        collection: &str,
    ) -> Result<Vec<MongoIndexInfo>, String> {
        let cursor = self
            .client
            .database(database)
            .collection::<Document>(collection)
            .list_indexes()
            .await
            .map_err(|error| safe_error("Failed to list MongoDB indexes", error, &self.uri))?;
        let indexes: Vec<IndexModel> = cursor
            .try_collect()
            .await
            .map_err(|error| safe_error("Failed to list MongoDB indexes", error, &self.uri))?;
        Ok(indexes
            .into_iter()
            .map(|index| {
                let options = index.options.unwrap_or_default();
                MongoIndexInfo {
                    name: options.name.unwrap_or_default(),
                    keys: bson_json(Bson::Document(index.keys)),
                    unique: options.unique.unwrap_or(false),
                    sparse: options.sparse.unwrap_or(false),
                    expire_after_seconds: options.expire_after.map(|duration| duration.as_secs()),
                }
            })
            .collect())
    }

    pub async fn create_index(&self, request: CreateMongoIndexRequest) -> Result<String, String> {
        if request.keys.is_empty() {
            return Err("An index requires at least one field".to_string());
        }
        if request.expire_after_seconds.is_some() && request.keys.len() != 1 {
            return Err("TTL indexes require exactly one field".to_string());
        }
        let mut keys = Document::new();
        for key in request.keys {
            if key.field.trim().is_empty() || !matches!(key.direction, -1 | 1) {
                return Err("Index fields require a name and direction of 1 or -1".to_string());
            }
            keys.insert(key.field, key.direction);
        }
        let options = IndexOptions::builder()
            .name(request.name)
            .unique(Some(request.unique))
            .sparse(Some(request.sparse))
            .expire_after(
                request
                    .expire_after_seconds
                    .map(std::time::Duration::from_secs),
            )
            .build();
        let result = self
            .client
            .database(&request.database)
            .collection::<Document>(&request.collection)
            .create_index(
                IndexModel::builder()
                    .keys(keys)
                    .options(Some(options))
                    .build(),
            )
            .await
            .map_err(|error| safe_error("Failed to create MongoDB index", error, &self.uri))?;
        Ok(result.index_name)
    }

    pub async fn drop_index(
        &self,
        database: &str,
        collection: &str,
        name: &str,
    ) -> Result<(), String> {
        if name == "_id_" {
            return Err("The _id_ index cannot be dropped".to_string());
        }
        self.client
            .database(database)
            .collection::<Document>(collection)
            .drop_index(name)
            .await
            .map_err(|error| safe_error("Failed to drop MongoDB index", error, &self.uri))?;
        Ok(())
    }

    pub async fn get_validator(
        &self,
        database: &str,
        collection: &str,
    ) -> Result<MongoValidatorSettings, String> {
        let mut cursor = self
            .client
            .database(database)
            .list_collections()
            .filter(doc! { "name": collection })
            .await
            .map_err(|error| safe_error("Failed to read MongoDB validator", error, &self.uri))?;
        let specification = cursor
            .try_next()
            .await
            .map_err(|error| safe_error("Failed to read MongoDB validator", error, &self.uri))?
            .ok_or_else(|| "MongoDB collection was not found".to_string())?;
        Ok(MongoValidatorSettings {
            validator: specification
                .options
                .validator
                .map(|value| bson_json(Bson::Document(value)))
                .unwrap_or_else(empty_document_json),
            validation_level: specification
                .options
                .validation_level
                .and_then(|value| serde_json::to_value(value).ok())
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "strict".to_string()),
            validation_action: specification
                .options
                .validation_action
                .and_then(|value| serde_json::to_value(value).ok())
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "error".to_string()),
        })
    }

    pub async fn set_validator(&self, request: SetMongoValidatorRequest) -> Result<(), String> {
        if !matches!(
            request.validation_level.as_str(),
            "off" | "strict" | "moderate"
        ) {
            return Err("validation_level must be off, strict, or moderate".to_string());
        }
        if !matches!(request.validation_action.as_str(), "error" | "warn") {
            return Err("validation_action must be error or warn".to_string());
        }
        let validator = json_document(request.validator, "validator")?;
        self.client
            .database(&request.database)
            .run_command(doc! {
                "collMod": request.collection,
                "validator": validator,
                "validationLevel": request.validation_level,
                "validationAction": request.validation_action,
            })
            .await
            .map_err(|error| safe_error("Failed to update MongoDB validator", error, &self.uri))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_standard_and_srv_uris_without_echoing_credentials() {
        assert!(validate_connection_uri("mongodb://localhost:27017/app").is_ok());
        assert!(validate_connection_uri("mongodb+srv://cluster.example.com/app").is_ok());
        let error = validate_connection_uri("https://user:secret@example.com").unwrap_err();
        assert!(!error.contains("secret"));
    }

    #[test]
    fn rejects_write_stages_in_read_only_aggregations() {
        assert!(ensure_read_only_pipeline(&[json!({ "$match": { "active": true } })]).is_ok());
        assert!(ensure_read_only_pipeline(&[json!({ "$out": "archive" })]).is_err());
        assert!(ensure_read_only_pipeline(&[json!({ "$merge": "archive" })]).is_err());
    }

    #[test]
    fn canonical_extended_json_round_trips_bson_identity() {
        let id = mongodb::bson::oid::ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
        let value = bson_json(Bson::Document(doc! { "_id": id, "count": 42_i64 }));
        let document = json_document(value, "document").unwrap();
        assert_eq!(document.get_object_id("_id").unwrap(), id);
        assert_eq!(document.get_i64("count").unwrap(), 42);
    }

    #[test]
    fn driver_errors_do_not_echo_uri_credentials() {
        let uri = "mongodb://user:super-secret@localhost:27017/app";
        let error = safe_error("Connection failed", "user:super-secret@localhost", uri);
        assert!(!error.contains("super-secret"));
    }

    #[tokio::test]
    async fn mongodb_7_and_8_workbench_contract() {
        let Ok(uris) = std::env::var("DBCOOPER_MONGODB_TEST_URIS") else {
            return;
        };
        for uri in uris.split(',').filter(|uri| !uri.trim().is_empty()) {
            let driver = MongoDriver::connect(uri.trim().to_string()).await.unwrap();
            driver.ping().await.unwrap();
            let database = format!("dbcooper_test_{}", uuid::Uuid::new_v4().simple());
            let collection = "documents";
            driver
                .create_collection(&database, collection)
                .await
                .unwrap();
            let inserted = driver
                .insert_one(MongoDocumentMutation {
                    database: database.clone(),
                    collection: collection.to_string(),
                    document: json!({ "name": "Ada", "active": true }),
                })
                .await
                .unwrap();
            let id = inserted.id.unwrap();
            let page = driver
                .find(MongoFindRequest {
                    database: database.clone(),
                    collection: collection.to_string(),
                    filter: json!({ "_id": id.clone() }),
                    projection: None,
                    sort: None,
                    skip: None,
                    limit: Some(10),
                })
                .await
                .unwrap();
            assert_eq!(page.returned_count, 1);
            driver
                .replace_one(MongoReplaceRequest {
                    database: database.clone(),
                    collection: collection.to_string(),
                    id: id.clone(),
                    document: json!({ "_id": id.clone(), "name": "Ada Lovelace", "active": true }),
                })
                .await
                .unwrap();
            driver
                .create_index(CreateMongoIndexRequest {
                    database: database.clone(),
                    collection: collection.to_string(),
                    keys: vec![MongoIndexKey {
                        field: "name".to_string(),
                        direction: 1,
                    }],
                    name: Some("name_1".to_string()),
                    unique: false,
                    sparse: false,
                    expire_after_seconds: None,
                })
                .await
                .unwrap();
            assert!(driver
                .list_indexes(&database, collection)
                .await
                .unwrap()
                .iter()
                .any(|index| index.name == "name_1"));
            driver
                .set_validator(SetMongoValidatorRequest {
                    database: database.clone(),
                    collection: collection.to_string(),
                    validator: json!({ "$jsonSchema": { "bsonType": "object" } }),
                    validation_level: "strict".to_string(),
                    validation_action: "error".to_string(),
                })
                .await
                .unwrap();
            assert_eq!(
                driver
                    .get_validator(&database, collection)
                    .await
                    .unwrap()
                    .validation_level,
                "strict"
            );
            driver
                .delete_one(MongoDeleteRequest {
                    database: database.clone(),
                    collection: collection.to_string(),
                    id,
                })
                .await
                .unwrap();
            driver.drop_collection(&database, collection).await.unwrap();
            driver.shutdown().await;
        }
    }
}
