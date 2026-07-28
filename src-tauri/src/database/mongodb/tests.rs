use mongodb::bson::{doc, Bson};
use serde_json::json;

use super::codec::{bson_json, json_document, safe_error};
use super::*;

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
