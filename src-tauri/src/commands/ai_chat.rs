use crate::ai::chat::executor::PoolExecutor;
use crate::ai::chat::model::ProviderModel;
use crate::ai::chat::store::{self, Conversation, StoredMessage};
use crate::ai::chat::{
    history_turns, prompt, run_chat, AiChatSessions, ChatExecutor, ChatStep, Engine, InspectLevel,
    MessageContent, Role, Turn, WriteStatus, MAX_HISTORY_MESSAGES,
};
use crate::ai::settings::{self, AiSettings};
use crate::database::pool_manager::PoolManager;
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct AiChatExchange {
    pub conversation: Conversation,
    pub user_message: StoredMessage,
    pub assistant_message: StoredMessage,
}

#[derive(Clone, Serialize)]
struct AiChatWriteFinishedPayload<'a> {
    session_id: &'a str,
}

#[derive(Clone, Serialize)]
struct AiChatStepPayload<'a> {
    session_id: &'a str,
    step: &'a ChatStep,
}

#[derive(Serialize)]
pub struct AiChatWriteResolution {
    pub conversation: Conversation,
    pub updated_message: StoredMessage,
    pub assistant_message: Option<StoredMessage>,
}

struct TurnContext {
    executor: PoolExecutor,
    settings: AiSettings,
    data_access: InspectLevel,
}

async fn prepare_turn(
    pool: &SqlitePool,
    pool_manager: &Arc<PoolManager>,
    connection_uuid: &str,
) -> Result<TurnContext, String> {
    pool_manager.ensure_connected(pool, connection_uuid).await?;
    let db_type = pool_manager
        .get_config(connection_uuid)
        .await
        .map(|config| config.db_type)
        .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
    let engine = Engine::from_db_type(&db_type)?;
    let settings = settings::load(pool).await?;
    let data_access = InspectLevel::from_setting(settings.chat_data_access.as_deref());
    Ok(TurnContext {
        executor: PoolExecutor::new(pool_manager.clone(), connection_uuid.to_string(), engine),
        settings,
        data_access,
    })
}

async fn run_assistant_turn(
    app: &AppHandle,
    sessions: &AiChatSessions,
    session_id: &str,
    context: TurnContext,
    transcript: Vec<Turn>,
) -> MessageContent {
    let TurnContext {
        executor,
        settings,
        data_access,
    } = context;
    let model = ProviderModel { settings };
    let emit_step = |step: &ChatStep| {
        let _ = app.emit("ai-chat-step", AiChatStepPayload { session_id, step });
    };

    let token = sessions.start(session_id);
    let turn = async {
        let schema = executor.schema().await;
        let system = prompt::system_prompt(executor.engine(), &schema, data_access);
        run_chat(
            &model,
            &executor,
            &system,
            transcript,
            data_access,
            &emit_step,
        )
        .await
    };
    let content = tokio::select! {
        content = turn => content,
        _ = token.cancelled() => MessageContent {
            error: Some("Stopped".to_string()),
            ..MessageContent::default()
        },
    };
    sessions.finish(session_id);
    content
}

#[tauri::command]
pub async fn ai_chat_send(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    pool_manager: State<'_, Arc<PoolManager>>,
    sessions: State<'_, AiChatSessions>,
    session_id: String,
    connection_uuid: String,
    conversation_id: Option<i64>,
    message: String,
) -> Result<AiChatExchange, String> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("Message is required".to_string());
    }

    let context = prepare_turn(pool.inner(), pool_manager.inner(), &connection_uuid).await?;
    let conversation = match conversation_id {
        Some(id) => {
            let conversation = store::get_conversation(pool.inner(), id).await?;
            if conversation.connection_uuid != connection_uuid {
                return Err("Conversation belongs to a different connection".to_string());
            }
            conversation
        }
        None => {
            store::create_conversation(
                pool.inner(),
                &connection_uuid,
                &store::conversation_title(&message),
            )
            .await?
        }
    };

    store::reject_pending_writes(pool.inner(), conversation.id).await?;
    let history =
        store::list_recent_messages(pool.inner(), conversation.id, MAX_HISTORY_MESSAGES).await?;
    let user_message = store::insert_message(
        pool.inner(),
        conversation.id,
        "user",
        &MessageContent::user(message.clone()),
    )
    .await?;

    let mut transcript = history_turns(&history);
    transcript.push(Turn {
        role: Role::User,
        content: message,
    });
    let content = run_assistant_turn(&app, &sessions, &session_id, context, transcript).await;

    let assistant_message =
        store::insert_message(pool.inner(), conversation.id, "assistant", &content).await?;
    let conversation = store::get_conversation(pool.inner(), conversation.id).await?;

    Ok(AiChatExchange {
        conversation,
        user_message,
        assistant_message,
    })
}

/// Approve or reject a write the assistant proposed. Approval runs exactly the
/// stored statement through the normal (non-read-only) path, then lets the
/// assistant continue from the outcome.
#[tauri::command]
pub async fn ai_chat_resolve_write(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    pool_manager: State<'_, Arc<PoolManager>>,
    sessions: State<'_, AiChatSessions>,
    session_id: String,
    message_id: i64,
    approve: bool,
) -> Result<AiChatWriteResolution, String> {
    let resolution = resolve_write(
        &app,
        pool.inner(),
        pool_manager.inner(),
        &sessions,
        &session_id,
        message_id,
        approve,
    )
    .await;
    sessions.finish(&session_id);
    resolution
}

async fn resolve_write(
    app: &AppHandle,
    pool: &SqlitePool,
    pool_manager: &Arc<PoolManager>,
    sessions: &AiChatSessions,
    session_id: &str,
    message_id: i64,
    approve: bool,
) -> Result<AiChatWriteResolution, String> {
    let not_pending = || "This change is no longer waiting for approval".to_string();
    let message = store::get_message(pool, message_id).await?;
    let conversation = store::get_conversation(pool, message.conversation_id).await?;
    let mut content = message.content;
    let write = content
        .write
        .as_mut()
        .filter(|write| write.status == WriteStatus::Pending)
        .ok_or_else(not_pending)?;
    write.status = if approve {
        WriteStatus::Executing
    } else {
        WriteStatus::Rejected
    };
    let query = write.query.clone();
    let claimed = store::claim_pending_write(pool, message_id, &content)
        .await?
        .ok_or_else(not_pending)?;
    if !approve {
        return Ok(AiChatWriteResolution {
            conversation,
            updated_message: claimed,
            assistant_message: None,
        });
    }

    // Registered before running so a Stop sent in the meantime is honoured;
    // once the write starts it cannot be interrupted, and the UI hides Stop
    // until `ai-chat-write-finished` arrives.
    let token = sessions.start(session_id);
    let prepared = prepare_turn(pool, pool_manager, &conversation.connection_uuid).await;
    let outcome = if token.is_cancelled() {
        None
    } else {
        Some(match &prepared {
            Ok(context) => context.executor.execute_write(&query).await,
            Err(error) => Err(error.clone()),
        })
    };
    if let Some(write) = content.write.as_mut() {
        match outcome {
            None => write.status = WriteStatus::Rejected,
            Some(Ok(rows_affected)) => {
                write.status = WriteStatus::Executed;
                write.rows_affected = rows_affected;
            }
            Some(Err(error)) => {
                write.status = WriteStatus::Failed;
                write.error = Some(error);
            }
        }
    }
    let stopped = token.is_cancelled();
    let updated_message = store::update_message(pool, message_id, &content).await?;
    let _ = app.emit(
        "ai-chat-write-finished",
        AiChatWriteFinishedPayload { session_id },
    );
    if stopped {
        return Ok(AiChatWriteResolution {
            conversation,
            updated_message,
            assistant_message: None,
        });
    }
    // The failure is recorded on the proposal; return it so the card updates.
    let Ok(context) = prepared else {
        return Ok(AiChatWriteResolution {
            conversation,
            updated_message,
            assistant_message: None,
        });
    };

    let history = store::list_recent_messages(pool, conversation.id, MAX_HISTORY_MESSAGES).await?;
    let continuation =
        run_assistant_turn(app, sessions, session_id, context, history_turns(&history)).await;
    let assistant_message =
        store::insert_message(pool, conversation.id, "assistant", &continuation).await?;
    let conversation = store::get_conversation(pool, conversation.id).await?;

    Ok(AiChatWriteResolution {
        conversation,
        updated_message,
        assistant_message: Some(assistant_message),
    })
}

#[tauri::command]
pub fn ai_chat_cancel(sessions: State<'_, AiChatSessions>, session_id: String) -> bool {
    sessions.cancel(&session_id)
}

#[tauri::command]
pub async fn ai_chat_list_conversations(
    pool: State<'_, SqlitePool>,
    connection_uuid: String,
) -> Result<Vec<Conversation>, String> {
    store::list_conversations(pool.inner(), &connection_uuid).await
}

#[tauri::command]
pub async fn ai_chat_get_messages(
    pool: State<'_, SqlitePool>,
    conversation_id: i64,
) -> Result<Vec<StoredMessage>, String> {
    store::list_messages(pool.inner(), conversation_id).await
}

#[tauri::command]
pub async fn ai_chat_delete_conversation(
    pool: State<'_, SqlitePool>,
    conversation_id: i64,
) -> Result<(), String> {
    store::delete_conversation(pool.inner(), conversation_id).await
}
