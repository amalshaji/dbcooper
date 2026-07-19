use serde::Serialize;
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/amalshaji/dbcooper/releases/latest/download/latest.json";
const CANARY_UPDATE_ENDPOINT: &str =
    "https://github.com/amalshaji/dbcooper/releases/download/canary/latest.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateChannel {
    Stable,
    Canary,
}

impl TryFrom<&str> for UpdateChannel {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "stable" => Ok(Self::Stable),
            "canary" => Ok(Self::Canary),
            value => Err(format!("Unknown update channel: {value}")),
        }
    }
}

fn endpoint_for(channel: UpdateChannel) -> &'static str {
    match channel {
        UpdateChannel::Stable => STABLE_UPDATE_ENDPOINT,
        UpdateChannel::Canary => CANARY_UPDATE_ENDPOINT,
    }
}

enum PendingUpdate {
    Empty,
    Available(Update),
    Downloaded { update: Update, bytes: Vec<u8> },
}

pub struct UpdateState(Mutex<PendingUpdate>);

impl Default for UpdateState {
    fn default() -> Self {
        Self(Mutex::new(PendingUpdate::Empty))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    version: String,
    current_version: String,
    body: Option<String>,
    date: Option<String>,
}

impl From<&Update> for UpdateMetadata {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
            date: update.date.map(|date| date.to_string()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
    Finished,
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let channel = UpdateChannel::try_from(channel.as_str())?;
    let endpoint = endpoint_for(channel)
        .parse()
        .map_err(|error| format!("Invalid update endpoint: {error}"))?;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    let metadata = update.as_ref().map(UpdateMetadata::from);
    *state.0.lock().map_err(|error| error.to_string())? = match update {
        Some(update) => PendingUpdate::Available(update),
        None => PendingUpdate::Empty,
    };

    Ok(metadata)
}

#[tauri::command]
pub async fn download_update(
    state: State<'_, UpdateState>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = {
        let mut pending = state.0.lock().map_err(|error| error.to_string())?;
        match std::mem::replace(&mut *pending, PendingUpdate::Empty) {
            PendingUpdate::Available(update) => update,
            other => {
                *pending = other;
                return Err("There is no update ready to download".to_string());
            }
        }
    };

    let progress_channel = on_event.clone();
    let finish_channel = on_event;
    let mut started = false;
    let result = update
        .download(
            move |chunk_length, content_length| {
                if !started {
                    let _ = progress_channel.send(DownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = progress_channel.send(DownloadEvent::Progress { chunk_length });
            },
            move || {
                let _ = finish_channel.send(DownloadEvent::Finished);
            },
        )
        .await;

    let mut pending = state.0.lock().map_err(|error| error.to_string())?;
    match result {
        Ok(bytes) => {
            *pending = PendingUpdate::Downloaded { update, bytes };
            Ok(())
        }
        Err(error) => {
            *pending = PendingUpdate::Available(update);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn install_update(state: State<'_, UpdateState>) -> Result<(), String> {
    let (update, bytes) = {
        let mut pending = state.0.lock().map_err(|error| error.to_string())?;
        match std::mem::replace(&mut *pending, PendingUpdate::Empty) {
            PendingUpdate::Downloaded { update, bytes } => (update, bytes),
            other => {
                *pending = other;
                return Err("There is no downloaded update ready to install".to_string());
            }
        }
    };

    if let Err(error) = update.install(&bytes) {
        *state.0.lock().map_err(|error| error.to_string())? =
            PendingUpdate::Downloaded { update, bytes };
        return Err(error.to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_update_channels() {
        assert_eq!(
            UpdateChannel::try_from("stable").unwrap(),
            UpdateChannel::Stable
        );
        assert_eq!(
            UpdateChannel::try_from("canary").unwrap(),
            UpdateChannel::Canary
        );
    }

    #[test]
    fn rejects_unknown_update_channels() {
        assert_eq!(
            UpdateChannel::try_from("nightly").unwrap_err(),
            "Unknown update channel: nightly"
        );
    }

    #[test]
    fn selects_the_manifest_for_each_channel() {
        assert_eq!(
            endpoint_for(UpdateChannel::Stable),
            "https://github.com/amalshaji/dbcooper/releases/latest/download/latest.json"
        );
        assert_eq!(
            endpoint_for(UpdateChannel::Canary),
            "https://github.com/amalshaji/dbcooper/releases/download/canary/latest.json"
        );
    }

    #[test]
    fn serializes_download_progress_for_the_frontend_contract() {
        assert_eq!(
            serde_json::to_value(DownloadEvent::Started {
                content_length: Some(512)
            })
            .unwrap(),
            serde_json::json!({
                "event": "Started",
                "data": { "contentLength": 512 }
            })
        );
        assert_eq!(
            serde_json::to_value(DownloadEvent::Progress { chunk_length: 128 }).unwrap(),
            serde_json::json!({
                "event": "Progress",
                "data": { "chunkLength": 128 }
            })
        );
        assert_eq!(
            serde_json::to_value(DownloadEvent::Finished).unwrap(),
            serde_json::json!({ "event": "Finished" })
        );
    }
}
