mod admin;
mod codec;
mod query;
#[cfg(test)]
mod tests;
mod types;
use codec::safe_error;
pub use codec::{
    ensure_mutable_namespace, ensure_read_only_pipeline, is_system_namespace,
    validate_connection_uri,
};
use mongodb::bson::doc;
use mongodb::options::{ClientOptions, ServerApi, ServerApiVersion};
use mongodb::Client;
pub use types::*;

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
                    is_system: is_system_namespace(&name, &collection),
                    name: collection,
                })
                .collect();
            result.push(MongoDatabaseInfo { name, collections });
        }
        Ok(result)
    }

    pub(crate) async fn recent_log_events(&self) -> Result<Vec<serde_json::Value>, String> {
        let result = self
            .client
            .database("admin")
            .run_command(doc! { "getLog": "global" })
            .await
            .map_err(|error| safe_error("MongoDB logs are unavailable", error, &self.uri))?;
        let events = result.get_array("log").map_err(|_| {
            "MongoDB logs are unavailable with the current server configuration".to_string()
        })?;
        Ok(events
            .iter()
            .rev()
            .take(200)
            .rev()
            .cloned()
            .map(codec::bson_json)
            .collect())
    }

    pub(crate) async fn current_activity(&self) -> Result<Vec<serde_json::Value>, String> {
        let result = self
            .client
            .database("admin")
            .run_command(doc! { "currentOp": 1, "$all": false, "active": true })
            .await
            .map_err(|error| safe_error("MongoDB activity is unavailable", error, &self.uri))?;
        let operations = result.get_array("inprog").map_err(|_| {
            "MongoDB activity is unavailable with the current privileges".to_string()
        })?;
        Ok(operations
            .iter()
            .take(200)
            .cloned()
            .map(codec::bson_json)
            .collect())
    }
}
