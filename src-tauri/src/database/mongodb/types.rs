use serde::{Deserialize, Serialize};
use serde_json::Value;

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
