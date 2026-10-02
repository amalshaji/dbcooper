use super::{MessageContent, WriteStatus};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

const MAX_TITLE_CHARS: usize = 60;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Conversation {
    pub id: i64,
    pub connection_uuid: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredMessage {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    #[serde(flatten)]
    pub content: MessageContent,
    pub created_at: String,
}

#[derive(FromRow)]
struct MessageRow {
    id: i64,
    conversation_id: i64,
    role: String,
    content_json: String,
    created_at: String,
}

impl MessageRow {
    fn into_message(self) -> StoredMessage {
        let content = serde_json::from_str(&self.content_json).unwrap_or_else(|_| MessageContent {
            error: Some("This message could not be read".to_string()),
            ..MessageContent::default()
        });
        StoredMessage {
            id: self.id,
            conversation_id: self.conversation_id,
            role: self.role,
            content,
            created_at: self.created_at,
        }
    }
}

pub fn conversation_title(message: &str) -> String {
    let first_line = message.lines().next().unwrap_or_default().trim();
    if first_line.chars().count() <= MAX_TITLE_CHARS {
        return first_line.to_string();
    }
    let truncated: String = first_line.chars().take(MAX_TITLE_CHARS).collect();
    format!("{}…", truncated.trim_end())
}

pub async fn list_conversations(
    pool: &SqlitePool,
    connection_uuid: &str,
) -> Result<Vec<Conversation>, String> {
    sqlx::query_as(
        "SELECT * FROM ai_conversations WHERE connection_uuid = ? ORDER BY updated_at DESC, id DESC",
    )
    .bind(connection_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn get_conversation(pool: &SqlitePool, id: i64) -> Result<Conversation, String> {
    sqlx::query_as("SELECT * FROM ai_conversations WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Conversation not found".to_string())
}

pub async fn create_conversation(
    pool: &SqlitePool,
    connection_uuid: &str,
    title: &str,
) -> Result<Conversation, String> {
    sqlx::query_as(
        "INSERT INTO ai_conversations (connection_uuid, title) VALUES (?, ?) RETURNING *",
    )
    .bind(connection_uuid)
    .bind(title)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn delete_conversation(pool: &SqlitePool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM ai_conversations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub async fn list_messages(
    pool: &SqlitePool,
    conversation_id: i64,
) -> Result<Vec<StoredMessage>, String> {
    let rows: Vec<MessageRow> =
        sqlx::query_as("SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id")
            .bind(conversation_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(MessageRow::into_message).collect())
}

pub async fn get_message(pool: &SqlitePool, id: i64) -> Result<StoredMessage, String> {
    let row: MessageRow = sqlx::query_as("SELECT * FROM ai_messages WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Message not found".to_string())?;
    Ok(row.into_message())
}

pub async fn update_message(
    pool: &SqlitePool,
    id: i64,
    content: &MessageContent,
) -> Result<StoredMessage, String> {
    let content_json = serde_json::to_string(content).map_err(|e| e.to_string())?;
    let row: MessageRow =
        sqlx::query_as("UPDATE ai_messages SET content_json = ? WHERE id = ? RETURNING *")
            .bind(content_json)
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(row.into_message())
}

/// Atomically move a write out of `pending`. Returns `None` when another
/// request already claimed it, so a write can never run twice.
pub async fn claim_pending_write(
    pool: &SqlitePool,
    id: i64,
    content: &MessageContent,
) -> Result<Option<StoredMessage>, String> {
    let content_json = serde_json::to_string(content).map_err(|e| e.to_string())?;
    let row: Option<MessageRow> = sqlx::query_as(
        "UPDATE ai_messages SET content_json = ?
         WHERE id = ? AND json_extract(content_json, '$.write.status') = 'pending'
         RETURNING *",
    )
    .bind(content_json)
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.map(MessageRow::into_message))
}

/// A new question supersedes any change still waiting for approval.
pub async fn reject_pending_writes(pool: &SqlitePool, conversation_id: i64) -> Result<(), String> {
    for mut message in list_messages(pool, conversation_id).await? {
        if let Some(write) = message.content.write.as_mut() {
            if write.status == WriteStatus::Pending {
                write.status = WriteStatus::Rejected;
                claim_pending_write(pool, message.id, &message.content).await?;
            }
        }
    }
    Ok(())
}

pub async fn insert_message(
    pool: &SqlitePool,
    conversation_id: i64,
    role: &str,
    content: &MessageContent,
) -> Result<StoredMessage, String> {
    let content_json = serde_json::to_string(content).map_err(|e| e.to_string())?;
    let row: MessageRow = sqlx::query_as(
        "INSERT INTO ai_messages (conversation_id, role, content_json) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(conversation_id)
    .bind(role)
    .bind(content_json)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?")
        .bind(conversation_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into_message())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn pool() -> SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO connections (uuid, name, host, port, database, username, password) VALUES ('c1', 'Local', 'localhost', 5432, 'app', 'u', 'p')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[test]
    fn titles_use_the_first_line_and_truncate() {
        assert_eq!(
            conversation_title("Revenue by month\nmore"),
            "Revenue by month"
        );
        let title = conversation_title(&"a".repeat(80));
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS + 1);
        assert!(title.ends_with('…'));
    }

    #[tokio::test]
    async fn stores_messages_and_cascades_deletes() {
        let pool = pool().await;
        let conversation = create_conversation(&pool, "c1", "Revenue").await.unwrap();
        insert_message(
            &pool,
            conversation.id,
            "user",
            &MessageContent::user("hi".into()),
        )
        .await
        .unwrap();
        let assistant = MessageContent {
            text: "Hello".to_string(),
            chart: Some(serde_json::json!({"type": "bar"})),
            ..MessageContent::default()
        };
        insert_message(&pool, conversation.id, "assistant", &assistant)
            .await
            .unwrap();

        let messages = list_messages(&pool, conversation.id).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].content.chart.as_ref().unwrap()["type"], "bar");
        assert_eq!(list_conversations(&pool, "c1").await.unwrap().len(), 1);

        delete_conversation(&pool, conversation.id).await.unwrap();
        assert!(list_messages(&pool, conversation.id)
            .await
            .unwrap()
            .is_empty());

        create_conversation(&pool, "c1", "Other").await.unwrap();
        sqlx::query("DELETE FROM connections WHERE uuid = 'c1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(list_conversations(&pool, "c1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_invalid_roles() {
        let pool = pool().await;
        let conversation = create_conversation(&pool, "c1", "x").await.unwrap();
        assert!(
            insert_message(&pool, conversation.id, "system", &MessageContent::default())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn claims_pending_writes_exactly_once() {
        use crate::ai::chat::WriteProposal;
        let pool = pool().await;
        let conversation = create_conversation(&pool, "c1", "x").await.unwrap();
        let proposal = MessageContent {
            write: Some(WriteProposal {
                language: "sql".to_string(),
                query: serde_json::json!("DELETE FROM t"),
                display: "DELETE FROM t".to_string(),
                summary: "Delete rows".to_string(),
                status: WriteStatus::Pending,
                rows_affected: None,
                error: None,
            }),
            ..MessageContent::default()
        };
        let stored = insert_message(&pool, conversation.id, "assistant", &proposal)
            .await
            .unwrap();

        let mut executing = proposal.clone();
        executing.write.as_mut().unwrap().status = WriteStatus::Executing;
        let claimed = claim_pending_write(&pool, stored.id, &executing)
            .await
            .unwrap();
        assert!(claimed.is_some());
        assert!(claim_pending_write(&pool, stored.id, &executing)
            .await
            .unwrap()
            .is_none());

        reject_pending_writes(&pool, conversation.id).await.unwrap();
        let reloaded = get_message(&pool, stored.id).await.unwrap();
        assert_eq!(
            reloaded.content.write.unwrap().status,
            WriteStatus::Executing,
            "a claimed write must not be rejected afterwards"
        );
        assert!(get_message(&pool, 9999).await.is_err());
    }
}
