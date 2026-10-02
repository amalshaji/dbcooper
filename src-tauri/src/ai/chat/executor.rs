use super::prompt::{describe_mongo_catalog, describe_sql_schema};
use super::{ChatExecutor, DescribeTarget, Engine, QueryOutput, MAX_RESULT_ROWS};
use crate::database::mongodb::{MongoAggregateRequest, MongoDocumentMutation, MongoFindRequest};
use crate::database::pool_manager::PoolManager;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_INSERT_DOCUMENTS: usize = 1000;
const DESCRIBE_SAMPLE_DOCUMENTS: u32 = 20;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MongoQuery {
    Find(MongoFindRequest),
    Aggregate(MongoAggregateRequest),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MongoWrite {
    InsertMany {
        database: String,
        collection: String,
        documents: Vec<Value>,
    },
    CreateCollection {
        database: String,
        collection: String,
    },
}

fn parse_mongo_write(query: &Value) -> Result<MongoWrite, String> {
    let parsed: MongoWrite = match query {
        Value::String(text) => serde_json::from_str(text),
        other => serde_json::from_value(other.clone()),
    }
    .map_err(|error| format!("Invalid MongoDB write: {error}"))?;
    if let MongoWrite::InsertMany { documents, .. } = &parsed {
        if documents.is_empty() || documents.len() > MAX_INSERT_DOCUMENTS {
            return Err(format!(
                "insert_many needs between 1 and {MAX_INSERT_DOCUMENTS} documents"
            ));
        }
        if !documents.iter().all(Value::is_object) {
            return Err("insert_many documents must be JSON objects".to_string());
        }
    }
    Ok(parsed)
}

fn statement(query: &Value) -> Result<&str, String> {
    query
        .as_str()
        .map(str::trim)
        .filter(|sql| !sql.is_empty())
        .ok_or_else(|| "query must be a non-empty string".to_string())
}

fn row_limit(limit: Option<u32>) -> Option<u32> {
    Some(
        limit
            .unwrap_or(MAX_RESULT_ROWS as u32)
            .min(MAX_RESULT_ROWS as u32),
    )
}

fn parse_mongo_query(query: &Value) -> Result<MongoQuery, String> {
    let parsed = match query {
        Value::String(text) => serde_json::from_str(text),
        other => serde_json::from_value(other.clone()),
    };
    parsed.map_err(|error| format!("Invalid MongoDB query: {error}"))
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(object) if object.len() == 1 => {
            match object.keys().next().map(String::as_str) {
                Some("$oid") => "objectId",
                Some("$date") => "date",
                Some("$numberDecimal" | "$numberLong") => "number",
                _ => "object",
            }
        }
        Value::Object(_) => "object",
    }
}

/// Field names and types observed in sampled documents, one nesting level deep.
fn infer_fields(documents: &[Value]) -> Value {
    let mut fields: BTreeMap<String, BTreeMap<&'static str, usize>> = BTreeMap::new();
    for document in documents {
        let Some(object) = document.as_object() else {
            continue;
        };
        for (key, value) in object {
            *fields
                .entry(key.clone())
                .or_default()
                .entry(json_kind(value))
                .or_default() += 1;
            if json_kind(value) == "object" {
                for (nested_key, nested_value) in value.as_object().into_iter().flatten() {
                    *fields
                        .entry(format!("{key}.{nested_key}"))
                        .or_default()
                        .entry(json_kind(nested_value))
                        .or_default() += 1;
                }
            }
        }
    }
    Value::Array(
        fields
            .into_iter()
            .map(|(name, kinds)| {
                let present: usize = kinds.values().sum();
                json!({ "name": name, "types": kinds.keys().collect::<Vec<_>>(), "present_in": present })
            })
            .collect(),
    )
}

pub struct PoolExecutor {
    pool_manager: Arc<PoolManager>,
    uuid: String,
    engine: Engine,
}

impl PoolExecutor {
    pub fn new(pool_manager: Arc<PoolManager>, uuid: String, engine: Engine) -> Self {
        Self {
            pool_manager,
            uuid,
            engine,
        }
    }

    pub async fn schema(&self) -> String {
        let schema = match self.engine {
            Engine::Sql { .. } => self
                .pool_manager
                .get_schema_overview(&self.uuid)
                .await
                .map(|overview| describe_sql_schema(&overview)),
            Engine::Redis => {
                Ok("Redis has no schema. Discover keys with SCAN and TYPE.".to_string())
            }
            Engine::Mongo => match self.pool_manager.get_mongo_driver(&self.uuid).await {
                Ok(driver) => driver
                    .catalog()
                    .await
                    .map(|catalog| describe_mongo_catalog(&catalog)),
                Err(error) => Err(error),
            },
        };
        schema
            .unwrap_or_else(|error| format!("Schema unavailable ({error}). Use describe actions."))
    }

    /// Run an approved write. Only the approval command calls this; the agent
    /// loop itself can only validate and propose.
    pub async fn execute_write(&self, query: &Value) -> Result<Option<u64>, String> {
        match self.engine {
            Engine::Sql { .. } | Engine::Redis => {
                let mut result = tokio::time::timeout(
                    WRITE_TIMEOUT,
                    self.pool_manager
                        .execute_query(&self.uuid, statement(query)?),
                )
                .await
                .map_err(|_| "Write timed out after 60 seconds".to_string())??;
                match result.error.take() {
                    Some(error) => Err(error),
                    None => Ok(result.rows_affected),
                }
            }
            Engine::Mongo => {
                let driver = self.pool_manager.get_mongo_driver(&self.uuid).await?;
                match parse_mongo_write(query)? {
                    MongoWrite::InsertMany {
                        database,
                        collection,
                        documents,
                    } => {
                        let mut inserted = 0u64;
                        for document in documents {
                            let insert = driver.insert_one(MongoDocumentMutation {
                                database: database.clone(),
                                collection: collection.clone(),
                                document,
                            });
                            tokio::time::timeout(WRITE_TIMEOUT, insert)
                                .await
                                .map_err(|_| "MongoDB insert timed out".to_string())?
                                .map_err(|error| {
                                    format!(
                                        "{error} (inserted {inserted} documents before failing)"
                                    )
                                })?;
                            inserted += 1;
                        }
                        Ok(Some(inserted))
                    }
                    MongoWrite::CreateCollection {
                        database,
                        collection,
                    } => {
                        driver.create_collection(&database, &collection).await?;
                        Ok(None)
                    }
                }
            }
        }
    }

    async fn sql_query(&self, query: &Value) -> Result<QueryOutput, String> {
        let sql = statement(query)?;
        if matches!(self.engine, Engine::Sql { .. }) {
            super::sql_guard::check_agent_sql(sql)?;
        }
        let mut result = tokio::time::timeout(
            QUERY_TIMEOUT,
            self.pool_manager.execute_query_read_only(&self.uuid, sql),
        )
        .await
        .map_err(|_| "Query timed out after 30 seconds".to_string())??;
        if let Some(error) = result.error.take() {
            return Err(error);
        }
        let truncated = result.truncated || result.data.len() > MAX_RESULT_ROWS;
        result.data.truncate(MAX_RESULT_ROWS);
        Ok(QueryOutput {
            rows: result.data,
            truncated,
        })
    }

    async fn mongo_query(&self, query: &Value) -> Result<QueryOutput, String> {
        let driver = self.pool_manager.get_mongo_driver(&self.uuid).await?;
        let page = match parse_mongo_query(query)? {
            MongoQuery::Find(mut request) => {
                request.limit = row_limit(request.limit);
                tokio::time::timeout(QUERY_TIMEOUT, driver.find(request)).await
            }
            MongoQuery::Aggregate(mut request) => {
                request.limit = row_limit(request.limit);
                tokio::time::timeout(QUERY_TIMEOUT, driver.aggregate(request)).await
            }
        }
        .map_err(|_| "MongoDB query timed out after 30 seconds".to_string())??;
        Ok(QueryOutput {
            rows: page.documents,
            truncated: page.has_more,
        })
    }

    async fn describe_table(&self, table: &str) -> Result<Value, String> {
        let tables = self.pool_manager.list_tables(&self.uuid).await?;
        let wanted = table.trim();
        let qualified = |info: &crate::db::models::TableInfo| {
            if info.schema.is_empty() {
                info.name.clone()
            } else {
                format!("{}.{}", info.schema, info.name)
            }
        };
        let found = tables
            .iter()
            .find(|info| qualified(info) == wanted)
            .or_else(|| tables.iter().find(|info| info.name == wanted))
            .or_else(|| {
                tables.iter().find(|info| {
                    qualified(info).eq_ignore_ascii_case(wanted)
                        || info.name.eq_ignore_ascii_case(wanted)
                })
            })
            .ok_or_else(|| format!("Table '{wanted}' was not found"))?;
        let structure = self
            .pool_manager
            .get_table_structure(&self.uuid, &found.schema, &found.name)
            .await?;
        serde_json::to_value(structure).map_err(|e| e.to_string())
    }

    async fn describe_collection(&self, database: &str, collection: &str) -> Result<Value, String> {
        let driver = self.pool_manager.get_mongo_driver(&self.uuid).await?;
        let page = tokio::time::timeout(
            QUERY_TIMEOUT,
            driver.find(MongoFindRequest {
                database: database.to_string(),
                collection: collection.to_string(),
                filter: json!({}),
                projection: None,
                sort: None,
                skip: None,
                limit: Some(DESCRIBE_SAMPLE_DOCUMENTS),
            }),
        )
        .await
        .map_err(|_| "MongoDB query timed out after 30 seconds".to_string())??;
        Ok(json!({
            "database": database,
            "collection": collection,
            "sampled_documents": page.documents.len(),
            "fields": infer_fields(&page.documents),
        }))
    }
}

#[async_trait]
impl ChatExecutor for PoolExecutor {
    fn engine(&self) -> &Engine {
        &self.engine
    }

    async fn query(&self, query: &Value) -> Result<QueryOutput, String> {
        match self.engine {
            Engine::Sql { .. } | Engine::Redis => self.sql_query(query).await,
            Engine::Mongo => self.mongo_query(query).await,
        }
    }

    fn validate_write(&self, query: &Value) -> Result<(), String> {
        match self.engine {
            Engine::Sql { .. } | Engine::Redis => statement(query).map(|_| ()),
            Engine::Mongo => parse_mongo_write(query).map(|_| ()),
        }
    }

    async fn describe(&self, target: &DescribeTarget) -> Result<Value, String> {
        match (&self.engine, target) {
            (
                Engine::Sql { .. },
                DescribeTarget {
                    table: Some(table), ..
                },
            ) => self.describe_table(table).await,
            (
                Engine::Mongo,
                DescribeTarget {
                    database: Some(database),
                    collection: Some(collection),
                    ..
                },
            ) => self.describe_collection(database, collection).await,
            (Engine::Sql { .. }, _) => Err("describe needs a \"table\"".to_string()),
            (Engine::Mongo, _) => Err("describe needs \"database\" and \"collection\"".to_string()),
            (Engine::Redis, _) => {
                Err("Redis has no describe action; use TYPE or SCAN queries".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        infer_fields, parse_mongo_query, parse_mongo_write, row_limit, MongoQuery, MongoWrite,
    };
    use serde_json::json;

    #[test]
    fn parses_find_and_aggregate_specs_from_objects_or_strings() {
        let find = parse_mongo_query(&json!({
            "version": 1, "type": "find", "database": "app", "collection": "users",
            "filter": {"active": true}, "limit": 5000
        }))
        .unwrap();
        let MongoQuery::Find(request) = find else {
            panic!("expected find");
        };
        assert_eq!(request.collection, "users");
        assert_eq!(row_limit(request.limit), Some(1000));

        let aggregate = parse_mongo_query(&json!(
            r#"{"type":"aggregate","database":"app","collection":"orders","pipeline":[{"$group":{"_id":"$status"}}]}"#
        ))
        .unwrap();
        assert!(matches!(aggregate, MongoQuery::Aggregate(request) if request.pipeline.len() == 1));

        assert!(
            parse_mongo_query(&json!({"type": "delete", "database": "a", "collection": "b"}))
                .is_err()
        );
    }

    #[test]
    fn infers_field_types_without_values() {
        let fields = infer_fields(&[
            json!({"_id": {"$oid": "1"}, "name": "Ada", "address": {"city": "Paris"}}),
            json!({"_id": {"$oid": "2"}, "name": null}),
        ]);
        let text = fields.to_string();
        assert!(text.contains("\"objectId\""));
        assert!(text.contains("address.city"));
        assert!(!text.contains("Ada"));
        assert!(!text.contains("Paris"));
    }

    #[test]
    fn validates_mongo_writes() {
        let insert = parse_mongo_write(&json!({
            "type": "insert_many", "database": "app", "collection": "users",
            "documents": [{"name": "Ada"}, {"name": "Grace"}]
        }))
        .unwrap();
        assert!(matches!(insert, MongoWrite::InsertMany { documents, .. } if documents.len() == 2));
        assert!(matches!(
            parse_mongo_write(&json!(
                r#"{"type":"create_collection","database":"app","collection":"logs"}"#
            )),
            Ok(MongoWrite::CreateCollection { .. })
        ));

        for invalid in [
            json!({"type": "insert_many", "database": "a", "collection": "b", "documents": []}),
            json!({"type": "insert_many", "database": "a", "collection": "b", "documents": [1]}),
            json!({"type": "drop_database", "database": "a"}),
        ] {
            assert!(parse_mongo_write(&invalid).is_err(), "{invalid}");
        }
    }
}
