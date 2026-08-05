use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::Cursor;
use serde_json::Value;
use std::time::Instant;

use super::codec::{bson_json, ensure_mutable_namespace, json_document, page_limit, safe_error};
use super::{
    ensure_read_only_pipeline, MongoAggregateRequest, MongoDeleteRequest, MongoDocumentMutation,
    MongoDocumentPage, MongoDriver, MongoFindRequest, MongoMutationResult, MongoReplaceRequest,
};

// Bound Extended JSON passed over Tauri IPC; a single document above this budget is rejected.
const MAX_MONGO_PAGE_JSON_BYTES: usize = 32 * 1024 * 1024;

struct MongoPageAccumulator {
    documents: Vec<Value>,
    json_bytes: usize,
    row_limit: usize,
    byte_limit: usize,
}

impl MongoPageAccumulator {
    fn new(row_limit: usize, byte_limit: usize) -> Self {
        Self {
            documents: Vec::new(),
            json_bytes: 2,
            row_limit,
            byte_limit,
        }
    }

    fn try_push(&mut self, document: Value) -> Result<bool, String> {
        if self.documents.len() >= self.row_limit {
            return Ok(false);
        }
        let document_bytes = serde_json::to_vec(&document)
            .map_err(|error| format!("Could not serialize MongoDB document: {error}"))?
            .len();
        let separator_bytes = usize::from(!self.documents.is_empty());
        if self.json_bytes + separator_bytes + document_bytes > self.byte_limit {
            if self.documents.is_empty() {
                return Err(format!(
                    "MongoDB document exceeds the {} MiB result page limit",
                    self.byte_limit / (1024 * 1024)
                ));
            }
            return Ok(false);
        }
        self.json_bytes += separator_bytes + document_bytes;
        self.documents.push(document);
        Ok(true)
    }

    fn into_documents(self) -> Vec<Value> {
        self.documents
    }
}

async fn collect_page(
    mut cursor: Cursor<Document>,
    limit: u32,
    context: &str,
    uri: &str,
) -> Result<(Vec<Value>, bool), String> {
    let mut page = MongoPageAccumulator::new(limit as usize, MAX_MONGO_PAGE_JSON_BYTES);
    let mut has_more = false;
    while let Some(document) = cursor
        .try_next()
        .await
        .map_err(|error| safe_error(context, error, uri))?
    {
        if !page.try_push(bson_json(Bson::Document(document)))? {
            has_more = true;
            break;
        }
    }
    Ok((page.into_documents(), has_more))
}

impl MongoDriver {
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
        let (documents, has_more) =
            collect_page(cursor, limit, "MongoDB find failed", &self.uri).await?;
        Ok(MongoDocumentPage {
            returned_count: documents.len(),
            documents,
            has_more,
            execution_time_ms: started.elapsed().as_millis(),
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
        let (documents, has_more) =
            collect_page(cursor, limit, "MongoDB aggregate failed", &self.uri).await?;
        Ok(MongoDocumentPage {
            returned_count: documents.len(),
            documents,
            has_more,
            execution_time_ms: started.elapsed().as_millis(),
        })
    }

    pub async fn insert_one(
        &self,
        request: MongoDocumentMutation,
    ) -> Result<MongoMutationResult, String> {
        ensure_mutable_namespace(&request.database, &request.collection)?;
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
        ensure_mutable_namespace(&request.database, &request.collection)?;
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
        ensure_mutable_namespace(&request.database, &request.collection)?;
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
}

#[cfg(test)]
mod tests {
    use super::MongoPageAccumulator;
    use serde_json::json;

    #[test]
    fn page_accumulator_stops_before_exceeding_the_json_byte_budget() {
        let first = json!({ "name": "Amal" });
        let first_size = serde_json::to_vec(&first).unwrap().len();
        let mut page = MongoPageAccumulator::new(100, first_size + 3);

        assert!(page.try_push(first).unwrap());
        assert!(!page.try_push(json!({ "name": "Bruno" })).unwrap());
        assert_eq!(page.into_documents().len(), 1);
    }

    #[test]
    fn page_accumulator_stops_at_the_row_limit() {
        let mut page = MongoPageAccumulator::new(1, 1024);

        assert!(page.try_push(json!({ "name": "Amal" })).unwrap());
        assert!(!page.try_push(json!({ "name": "Bruno" })).unwrap());
        assert_eq!(page.into_documents().len(), 1);
    }
}
