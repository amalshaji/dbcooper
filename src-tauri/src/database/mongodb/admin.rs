use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::IndexOptions;
use mongodb::IndexModel;
use serde_json::Value;

use super::codec::{bson_json, ensure_mutable_namespace, json_document, safe_error};
use super::{
    CreateMongoIndexRequest, MongoDriver, MongoIndexInfo, MongoValidatorSettings,
    SetMongoValidatorRequest,
};

impl MongoDriver {
    pub async fn create_collection(&self, database: &str, collection: &str) -> Result<(), String> {
        ensure_mutable_namespace(database, collection)?;
        self.client
            .database(database)
            .create_collection(collection)
            .await
            .map_err(|error| safe_error("Failed to create MongoDB collection", error, &self.uri))?;
        Ok(())
    }

    pub async fn drop_collection(&self, database: &str, collection: &str) -> Result<(), String> {
        ensure_mutable_namespace(database, collection)?;
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
        ensure_mutable_namespace(&request.database, &request.collection)?;
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
        ensure_mutable_namespace(database, collection)?;
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
                .unwrap_or_else(|| Value::Object(Default::default())),
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
        ensure_mutable_namespace(&request.database, &request.collection)?;
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
