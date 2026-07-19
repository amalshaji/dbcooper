use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    version: String,
    current_version: String,
    body: Option<String>,
    date: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_for_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let channel = UpdateChannel::try_from(channel.as_str())?;
    let endpoint = endpoint_for(channel)
        .parse()
        .map_err(|error| format!("Invalid update endpoint: {error}"))?;

    let update = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    Ok(update.map(|update| UpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        body: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
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
    fn serializes_metadata_for_the_canonical_frontend_update_resource() {
        let metadata = UpdateMetadata {
            rid: 42,
            version: "0.0.64-canary.10".to_string(),
            current_version: "0.0.63".to_string(),
            body: None,
            date: None,
            raw_json: serde_json::json!({ "version": "0.0.64-canary.10" }),
        };

        assert_eq!(
            serde_json::to_value(metadata).unwrap(),
            serde_json::json!({
                "rid": 42,
                "version": "0.0.64-canary.10",
                "currentVersion": "0.0.63",
                "body": null,
                "date": null,
                "rawJson": { "version": "0.0.64-canary.10" }
            })
        );
    }
}
