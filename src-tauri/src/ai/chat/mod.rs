use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

pub mod executor;
pub mod model;
pub mod observation;
pub mod prompt;
pub mod protocol;
pub mod sql_guard;
pub mod store;

use protocol::{is_plain_text, parse_action, Action};

pub const MAX_STEPS: usize = 8;
pub const MAX_RESULT_ROWS: usize = 1000;
pub const MAX_HISTORY_MESSAGES: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InspectLevel {
    None,
    Summary,
    Rows,
}

impl InspectLevel {
    /// The user's ceiling. Defaults to `rows`: the model decides what it needs.
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("none") => Self::None,
            Some("summary") => Self::Summary,
            _ => Self::Rows,
        }
    }

    fn from_request(value: Option<&str>) -> Self {
        match value {
            Some("none") => Self::None,
            Some("rows") => Self::Rows,
            _ => Self::Summary,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Engine {
    Sql { db_type: String },
    Redis,
    Mongo,
}

impl Engine {
    pub fn from_db_type(db_type: &str) -> Result<Self, String> {
        match db_type {
            "d1" => Err(
                "Ask AI is not available for Cloudflare D1 because D1 has no read-only query mode."
                    .to_string(),
            ),
            "redis" => Ok(Self::Redis),
            "mongodb" => Ok(Self::Mongo),
            other => Ok(Self::Sql {
                db_type: other.to_string(),
            }),
        }
    }

    pub fn language(&self) -> &'static str {
        match self {
            Self::Sql { .. } => "sql",
            Self::Redis => "redis",
            Self::Mongo => "mongodb",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Clone, Debug)]
pub struct Turn {
    pub role: Role,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    Query,
    Describe,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatStep {
    pub id: usize,
    pub kind: StepKind,
    pub language: Option<String>,
    pub query: String,
    pub purpose: Option<String>,
    pub inspect: Option<InspectLevel>,
    pub row_count: Option<usize>,
    #[serde(default)]
    pub truncated: bool,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    #[serde(default)]
    pub running: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatResult {
    pub step: usize,
    pub rows: Vec<Value>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MessageContent {
    pub text: String,
    #[serde(default)]
    pub steps: Vec<ChatStep>,
    #[serde(default)]
    pub result: Option<ChatResult>,
    #[serde(default)]
    pub chart: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub write: Option<WriteProposal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteStatus {
    Pending,
    /// Claimed for execution; never re-offered, even if the app stops mid-write.
    Executing,
    Executed,
    Failed,
    Rejected,
}

/// A change the model wants to make. It never runs until the user approves
/// it; the stored `query` is exactly what executes.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WriteProposal {
    pub language: String,
    pub query: Value,
    pub display: String,
    pub summary: String,
    pub status: WriteStatus,
    #[serde(default)]
    pub rows_affected: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

impl WriteProposal {
    /// What the model is told about the outcome on its next turn.
    pub fn observation(&self) -> Option<String> {
        let outcome = match self.status {
            WriteStatus::Pending => return None,
            WriteStatus::Executing => {
                "The write was started but its outcome is unknown; do not repeat it without checking."
                    .to_string()
            }
            WriteStatus::Executed => match self.rows_affected {
                Some(rows) => {
                    format!("The user approved the write and it succeeded ({rows} rows affected).")
                }
                None => "The user approved the write and it succeeded.".to_string(),
            },
            WriteStatus::Failed => format!(
                "The user approved the write but it failed: {}",
                self.error.as_deref().unwrap_or("unknown error")
            ),
            WriteStatus::Rejected => {
                "The user rejected the write; it was not executed.".to_string()
            }
        };
        Some(format!("Observation:\n{outcome}"))
    }
}

impl MessageContent {
    pub fn user(text: String) -> Self {
        Self {
            text,
            ..Self::default()
        }
    }

    fn failed(error: String, steps: Vec<ChatStep>) -> Self {
        Self {
            steps,
            error: Some(error),
            ..Self::default()
        }
    }
}

pub struct QueryOutput {
    pub rows: Vec<Value>,
    pub truncated: bool,
}

#[async_trait]
pub trait ChatModel: Send + Sync {
    async fn complete(&self, system: &str, transcript: &[Turn]) -> Result<String, String>;
}

pub struct DescribeTarget {
    pub table: Option<String>,
    pub database: Option<String>,
    pub collection: Option<String>,
}

impl DescribeTarget {
    fn label(&self) -> String {
        match (&self.table, &self.database, &self.collection) {
            (Some(table), _, _) => table.clone(),
            (None, Some(database), Some(collection)) => format!("{database}.{collection}"),
            (None, _, Some(collection)) => collection.clone(),
            _ => "unknown".to_string(),
        }
    }
}

#[async_trait]
pub trait ChatExecutor: Send + Sync {
    fn engine(&self) -> &Engine;
    async fn query(&self, query: &Value) -> Result<QueryOutput, String>;
    async fn describe(&self, target: &DescribeTarget) -> Result<Value, String>;
    /// Check a proposed write is well-formed without running it.
    fn validate_write(&self, query: &Value) -> Result<(), String>;
}

fn display_query(query: &Value) -> String {
    match query {
        Value::String(text) => text.trim().to_string(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    }
}

fn elapsed_ms(started: Instant) -> Option<u64> {
    u64::try_from(started.elapsed().as_millis()).ok()
}

fn finish(
    text: String,
    step: Option<usize>,
    chart: Option<Value>,
    steps: Vec<ChatStep>,
    mut results: Vec<(usize, QueryOutput)>,
) -> MessageContent {
    let index = step
        .and_then(|id| results.iter().position(|(step_id, _)| *step_id == id))
        .or_else(|| results.len().checked_sub(1));
    let result = index.map(|index| {
        let (step, output) = results.swap_remove(index);
        ChatResult {
            step,
            rows: output.rows,
            truncated: output.truncated,
        }
    });
    MessageContent {
        text: text.trim().to_string(),
        chart: chart.filter(|chart| result.is_some() && chart.is_object()),
        result,
        steps,
        error: None,
        write: None,
    }
}

/// Run one user question to completion: the model picks actions, DBcooper
/// executes them read-only and replies with observations capped at
/// `data_access`, until the model answers or the step budget runs out.
pub async fn run_chat(
    model: &dyn ChatModel,
    executor: &dyn ChatExecutor,
    system: &str,
    mut transcript: Vec<Turn>,
    data_access: InspectLevel,
    on_step: &(dyn Fn(&ChatStep) + Send + Sync),
) -> MessageContent {
    let mut steps: Vec<ChatStep> = Vec::new();
    let mut results: Vec<(usize, QueryOutput)> = Vec::new();
    let mut repaired = false;

    for iteration in 0..MAX_STEPS {
        let response = match model.complete(system, &transcript).await {
            Ok(response) => response,
            Err(error) => return MessageContent::failed(error, steps),
        };

        let action = match parse_action(&response) {
            Ok(action) => action,
            Err(_) if is_plain_text(&response) => {
                return finish(response, None, None, steps, results);
            }
            Err(error) if !repaired => {
                repaired = true;
                transcript.push(Turn {
                    role: Role::Assistant,
                    content: response,
                });
                transcript.push(Turn {
                    role: Role::User,
                    content: format!(
                        "Your last reply was not a valid action ({error}). Reply with exactly one JSON object."
                    ),
                });
                continue;
            }
            Err(error) => {
                return MessageContent::failed(
                    format!("The AI returned an invalid response: {error}"),
                    steps,
                );
            }
        };

        transcript.push(Turn {
            role: Role::Assistant,
            content: response,
        });

        let id = steps.len() + 1;
        let observation = match action {
            Action::Answer { text, step, chart } => {
                return finish(text, step, chart, steps, results);
            }
            Action::Write { query, summary } => match executor.validate_write(&query) {
                Ok(()) => {
                    let summary = summary
                        .filter(|summary| !summary.trim().is_empty())
                        .unwrap_or_else(|| "Proposed change".to_string());
                    let mut content = finish(summary.clone(), None, None, steps, results);
                    content.write = Some(WriteProposal {
                        language: executor.engine().language().to_string(),
                        display: display_query(&query),
                        query,
                        summary,
                        status: WriteStatus::Pending,
                        rows_affected: None,
                        error: None,
                    });
                    return content;
                }
                Err(error) => {
                    json!({ "status": "error", "error": format!("Invalid write: {error}") })
                }
            },
            Action::Query {
                query,
                purpose,
                inspect,
            } => {
                let requested = InspectLevel::from_request(inspect.as_deref());
                let level = requested.min(data_access);
                let mut step = ChatStep {
                    id,
                    kind: StepKind::Query,
                    language: Some(executor.engine().language().to_string()),
                    query: display_query(&query),
                    purpose,
                    inspect: Some(level),
                    row_count: None,
                    truncated: false,
                    duration_ms: None,
                    error: None,
                    running: true,
                };
                on_step(&step);
                let started = Instant::now();
                let observation = match executor.query(&query).await {
                    Ok(output) => {
                        step.row_count = Some(output.rows.len());
                        step.truncated = output.truncated;
                        let mut observation =
                            observation::observation(id, &output.rows, output.truncated, level);
                        if requested > level {
                            observation["note"] =
                                json!("Inspect level was lowered to the user's data access limit.");
                        }
                        results.push((id, output));
                        observation
                    }
                    Err(error) => {
                        let visible = if level == InspectLevel::Rows {
                            error.clone()
                        } else {
                            observation::redact_error(&error)
                        };
                        step.error = Some(error);
                        json!({ "step": id, "status": "error", "error": visible })
                    }
                };
                step.duration_ms = elapsed_ms(started);
                step.running = false;
                on_step(&step);
                steps.push(step);
                observation
            }
            Action::Describe {
                table,
                database,
                collection,
            } => {
                let target = DescribeTarget {
                    table,
                    database,
                    collection,
                };
                let mut step = ChatStep {
                    id,
                    kind: StepKind::Describe,
                    language: None,
                    query: target.label(),
                    purpose: None,
                    inspect: None,
                    row_count: None,
                    truncated: false,
                    duration_ms: None,
                    error: None,
                    running: true,
                };
                on_step(&step);
                let started = Instant::now();
                let observation = match executor.describe(&target).await {
                    Ok(structure) => json!({ "step": id, "status": "ok", "structure": structure }),
                    Err(error) => {
                        step.error = Some(error.clone());
                        json!({ "step": id, "status": "error", "error": error })
                    }
                };
                step.duration_ms = elapsed_ms(started);
                step.running = false;
                on_step(&step);
                steps.push(step);
                observation
            }
        };

        let mut content = format!("Observation:\n{observation}");
        if iteration + 2 == MAX_STEPS {
            content.push_str("\nThis is your last action: reply with an answer action now.");
        }
        transcript.push(Turn {
            role: Role::User,
            content,
        });
    }

    finish(
        "I ran out of steps before finishing. The last result I retrieved is shown below."
            .to_string(),
        None,
        None,
        steps,
        results,
    )
}

/// Earlier exchanges are replayed as answer actions so follow-up questions
/// ("now split it by country") can build on previous queries.
pub fn history_turns(messages: &[store::StoredMessage]) -> Vec<Turn> {
    let start = messages.len().saturating_sub(MAX_HISTORY_MESSAGES);
    messages[start..]
        .iter()
        .flat_map(|message| {
            let observation = message
                .content
                .write
                .as_ref()
                .and_then(WriteProposal::observation)
                .map(|content| Turn {
                    role: Role::User,
                    content,
                });
            history_turn(message).into_iter().chain(observation)
        })
        .collect()
}

fn history_turn(message: &store::StoredMessage) -> Option<Turn> {
    {
        match message.role.as_str() {
            "user" => Some(Turn {
                role: Role::User,
                content: message.content.text.clone(),
            }),
            "assistant" if message.content.write.is_some() => {
                let write = message.content.write.as_ref()?;
                Some(Turn {
                    role: Role::Assistant,
                    content: json!({
                        "action": "write",
                        "query": write.query,
                        "summary": write.summary,
                    })
                    .to_string(),
                })
            }
            "assistant" if message.content.error.is_none() => {
                let queries: Vec<&str> = message
                    .content
                    .steps
                    .iter()
                    .filter(|step| step.kind == StepKind::Query && step.error.is_none())
                    .map(|step| step.query.as_str())
                    .collect();
                Some(Turn {
                    role: Role::Assistant,
                    content: json!({
                        "action": "answer",
                        "text": message.content.text,
                        "queries_run": queries,
                        "chart": message.content.chart,
                    })
                    .to_string(),
                })
            }
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct AiChatSessions {
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl AiChatSessions {
    /// Reuses a token cancelled before the session started, so a Stop clicked
    /// while the backend is still preparing the turn is not lost.
    pub fn start(&self, session_id: &str) -> CancellationToken {
        match self.tokens.lock() {
            Ok(mut tokens) => tokens
                .entry(session_id.to_string())
                .or_insert_with(CancellationToken::new)
                .clone(),
            Err(_) => CancellationToken::new(),
        }
    }

    pub fn finish(&self, session_id: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(session_id);
        }
    }

    pub fn cancel(&self, session_id: &str) -> bool {
        let Ok(mut tokens) = self.tokens.lock() else {
            return false;
        };
        let started = tokens.contains_key(session_id);
        tokens
            .entry(session_id.to_string())
            .or_insert_with(CancellationToken::new)
            .cancel();
        started
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    struct ScriptedModel {
        replies: StdMutex<Vec<String>>,
        seen: StdMutex<Vec<String>>,
    }

    impl ScriptedModel {
        fn new(replies: &[&str]) -> Self {
            Self {
                replies: StdMutex::new(replies.iter().rev().map(|r| r.to_string()).collect()),
                seen: StdMutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl ChatModel for ScriptedModel {
        async fn complete(&self, _system: &str, transcript: &[Turn]) -> Result<String, String> {
            if let Some(last) = transcript.last() {
                self.seen.lock().unwrap().push(last.content.clone());
            }
            self.replies
                .lock()
                .unwrap()
                .pop()
                .ok_or_else(|| "no more replies".to_string())
        }
    }

    struct FakeExecutor {
        engine: Engine,
        queries: StdMutex<Vec<Value>>,
    }

    impl FakeExecutor {
        fn new() -> Self {
            Self {
                engine: Engine::Sql {
                    db_type: "postgres".to_string(),
                },
                queries: StdMutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl ChatExecutor for FakeExecutor {
        fn engine(&self) -> &Engine {
            &self.engine
        }

        async fn query(&self, query: &Value) -> Result<QueryOutput, String> {
            self.queries.lock().unwrap().push(query.clone());
            if query.as_str().is_some_and(|sql| sql.contains("DELETE")) {
                return Err("cannot execute DELETE in a read-only transaction".to_string());
            }
            Ok(QueryOutput {
                rows: vec![
                    json!({"month": "2026-01", "revenue": 10, "email": "a@example.com"}),
                    json!({"month": "2026-02", "revenue": 20, "email": "b@example.com"}),
                ],
                truncated: false,
            })
        }

        async fn describe(&self, target: &DescribeTarget) -> Result<Value, String> {
            Ok(json!({"columns": [target.label()]}))
        }

        fn validate_write(&self, query: &Value) -> Result<(), String> {
            query
                .as_str()
                .map(|_| ())
                .ok_or_else(|| "query must be a string".to_string())
        }
    }

    fn user(text: &str) -> Vec<Turn> {
        vec![Turn {
            role: Role::User,
            content: text.to_string(),
        }]
    }

    fn noop(_: &ChatStep) {}

    #[tokio::test]
    async fn runs_queries_and_returns_the_referenced_result_with_chart() {
        let model = ScriptedModel::new(&[
            r#"{"action":"query","query":"SELECT 1","inspect":"none"}"#,
            r#"{"action":"query","query":"SELECT month, revenue FROM sales","inspect":"none"}"#,
            r#"{"action":"answer","text":"Revenue doubled.","step":2,"chart":{"type":"line","x":"month","y":["revenue"]}}"#,
        ]);
        let executor = FakeExecutor::new();
        let content = run_chat(
            &model,
            &executor,
            "system",
            user("revenue trend"),
            InspectLevel::Rows,
            &noop,
        )
        .await;

        assert_eq!(content.text, "Revenue doubled.");
        assert_eq!(content.steps.len(), 2);
        assert_eq!(content.result.as_ref().unwrap().step, 2);
        assert_eq!(content.result.unwrap().rows.len(), 2);
        assert_eq!(content.chart.unwrap()["type"], "line");
        assert!(content.error.is_none());
    }

    #[tokio::test]
    async fn caps_inspection_at_the_user_limit() {
        let model = ScriptedModel::new(&[
            r#"{"action":"query","query":"SELECT * FROM users","inspect":"rows"}"#,
            r#"{"action":"answer","text":"Two users."}"#,
        ]);
        let executor = FakeExecutor::new();
        let content = run_chat(
            &model,
            &executor,
            "system",
            user("users"),
            InspectLevel::Summary,
            &noop,
        )
        .await;

        assert_eq!(content.steps[0].inspect, Some(InspectLevel::Summary));
        let seen = model.seen.lock().unwrap();
        let observation = seen.last().unwrap();
        assert!(!observation.contains("a@example.com"));
        assert!(observation.contains("lowered"));
    }

    #[tokio::test]
    async fn feeds_query_errors_back_to_the_model() {
        let model = ScriptedModel::new(&[
            r#"{"action":"query","query":"DELETE FROM users"}"#,
            r#"{"action":"answer","text":"I can only read data."}"#,
        ]);
        let executor = FakeExecutor::new();
        let content = run_chat(&model, &executor, "s", user("x"), InspectLevel::Rows, &noop).await;

        assert!(content.steps[0]
            .error
            .as_ref()
            .unwrap()
            .contains("read-only"));
        assert!(model
            .seen
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .contains("\"status\":\"error\""));
        assert!(content.result.is_none());
    }

    #[tokio::test]
    async fn repairs_one_malformed_reply_and_accepts_plain_text() {
        let model = ScriptedModel::new(&[r#"{"action":"query""#, r#"There are two users."#]);
        let executor = FakeExecutor::new();
        let content = run_chat(&model, &executor, "s", user("x"), InspectLevel::Rows, &noop).await;

        assert_eq!(content.text, "There are two users.");
        assert!(model.seen.lock().unwrap()[1].contains("not a valid action"));
    }

    #[tokio::test]
    async fn stops_at_the_step_limit() {
        let replies: Vec<&str> =
            vec![r#"{"action":"query","query":"SELECT 1","inspect":"none"}"#; MAX_STEPS];
        let model = ScriptedModel::new(&replies);
        let executor = FakeExecutor::new();
        let content = run_chat(&model, &executor, "s", user("x"), InspectLevel::Rows, &noop).await;

        assert_eq!(executor.queries.lock().unwrap().len(), MAX_STEPS);
        assert!(content.text.contains("ran out of steps"));
        assert!(content.result.is_some());
        assert!(model
            .seen
            .lock()
            .unwrap()
            .iter()
            .any(|seen| seen.contains("last action")));
    }

    #[tokio::test]
    async fn drops_charts_without_a_result_and_reports_provider_errors() {
        let model = ScriptedModel::new(&[
            r#"{"action":"answer","text":"Nothing to chart.","chart":{"type":"bar","x":"a","y":["b"]}}"#,
        ]);
        let executor = FakeExecutor::new();
        let content = run_chat(&model, &executor, "s", user("x"), InspectLevel::Rows, &noop).await;
        assert!(content.chart.is_none());

        let failing = ScriptedModel::new(&[]);
        let content = run_chat(
            &failing,
            &executor,
            "s",
            user("x"),
            InspectLevel::Rows,
            &noop,
        )
        .await;
        assert_eq!(content.error.as_deref(), Some("no more replies"));
    }

    #[test]
    fn rejects_d1_and_maps_engines() {
        assert!(Engine::from_db_type("d1").is_err());
        assert_eq!(Engine::from_db_type("redis").unwrap(), Engine::Redis);
        assert_eq!(
            Engine::from_db_type("mongodb").unwrap().language(),
            "mongodb"
        );
        assert_eq!(Engine::from_db_type("duckdb").unwrap().language(), "sql");
    }

    #[test]
    fn defaults_to_letting_the_model_decide() {
        assert_eq!(InspectLevel::from_setting(None), InspectLevel::Rows);
        assert_eq!(
            InspectLevel::from_setting(Some("summary")),
            InspectLevel::Summary
        );
        assert_eq!(InspectLevel::from_request(None), InspectLevel::Summary);
    }

    #[test]
    fn cancels_registered_sessions() {
        let sessions = AiChatSessions::default();
        let token = sessions.start("s1");
        assert!(sessions.cancel("s1"));
        assert!(token.is_cancelled());
        sessions.finish("s1");
        assert!(!sessions.start("s1").is_cancelled());
    }

    #[test]
    fn keeps_a_stop_that_arrives_before_the_session_starts() {
        let sessions = AiChatSessions::default();
        assert!(!sessions.cancel("early"));
        assert!(sessions.start("early").is_cancelled());
    }

    #[tokio::test]
    async fn proposes_writes_without_executing_them() {
        let model = ScriptedModel::new(&[
            r#"{"action":"write","query":{"not":"sql"}}"#,
            r#"{"action":"write","query":"CREATE TABLE notes (id INTEGER)","summary":"Create a notes table"}"#,
        ]);
        let executor = FakeExecutor::new();
        let content = run_chat(&model, &executor, "s", user("x"), InspectLevel::Rows, &noop).await;

        assert!(model.seen.lock().unwrap()[1].contains("Invalid write"));
        assert!(executor.queries.lock().unwrap().is_empty());
        let write = content.write.unwrap();
        assert_eq!(write.status, WriteStatus::Pending);
        assert_eq!(write.display, "CREATE TABLE notes (id INTEGER)");
        assert_eq!(content.text, "Create a notes table");
    }

    #[test]
    fn replays_write_outcomes_as_observations() {
        let message = |id: i64, role: &str, content: MessageContent| store::StoredMessage {
            id,
            conversation_id: 1,
            role: role.to_string(),
            content,
            created_at: String::new(),
        };
        let write = |status| WriteProposal {
            language: "sql".to_string(),
            query: json!("INSERT INTO t VALUES (1)"),
            display: "INSERT INTO t VALUES (1)".to_string(),
            summary: "Insert one row".to_string(),
            status,
            rows_affected: Some(1),
            error: None,
        };
        let turns = history_turns(&[
            message(1, "user", MessageContent::user("add a row".to_string())),
            message(
                2,
                "assistant",
                MessageContent {
                    write: Some(write(WriteStatus::Executed)),
                    ..MessageContent::default()
                },
            ),
            message(
                3,
                "assistant",
                MessageContent {
                    write: Some(write(WriteStatus::Pending)),
                    ..MessageContent::default()
                },
            ),
        ]);

        assert_eq!(turns.len(), 4);
        assert!(turns[1].content.contains("\"action\":\"write\""));
        assert_eq!(turns[2].role, Role::User);
        assert!(turns[2].content.contains("succeeded (1 rows affected)"));
        assert_eq!(turns[3].role, Role::Assistant);
    }
}
