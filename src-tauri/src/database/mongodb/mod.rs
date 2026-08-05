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
}
