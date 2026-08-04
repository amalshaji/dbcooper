use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use serde_json::Value;
use std::time::Instant;

use super::codec::{bson_json, ensure_mutable_namespace, json_document, page_limit, safe_error};
use super::{
    ensure_read_only_pipeline, MongoAggregateRequest, MongoDeleteRequest, MongoDocumentMutation,
    MongoDocumentPage, MongoDriver, MongoFindRequest, MongoMutationResult, MongoReplaceRequest,
};

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
        let mut documents: Vec<Document> = cursor
            .try_collect()
            .await
            .map_err(|error| safe_error("MongoDB find failed", error, &self.uri))?;
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
