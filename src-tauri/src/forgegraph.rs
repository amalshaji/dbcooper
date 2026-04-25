//! ForgeGraph HTTP client
//!
//! Communicates with the ForgeGraph tRPC API to list services and retrieve
//! connection credentials for managed database instances.

use serde::{Deserialize, Serialize};

/// Network transport descriptor for a ForgeGraph service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transport {
    pub kind: String,
    pub host: String,
    pub port: u16,
}

/// Summary of a ForgeGraph-managed service (no credentials).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGraphService {
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub transports: Vec<Transport>,
}

/// Full connection details including credentials, returned by `services.connection`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGraphConnection {
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub transports: Vec<Transport>,
    #[serde(default)]
    pub credentials: serde_json::Value,
}

impl std::fmt::Debug for ForgeGraphConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ForgeGraphConnection")
            .field("app_slug", &self.app_slug)
            .field("stage", &self.stage)
            .field("kind", &self.kind)
            .field("node_name", &self.node_name)
            .field("credentials", &"[REDACTED]")
            .finish()
    }
}

/// Outer tRPC envelope — `{ result: { data: T } }`.
#[derive(Debug, Clone, Deserialize)]
pub struct TrpcResponse<T> {
    pub result: TrpcResult<T>,
}

/// Inner tRPC result — `{ data: T }`.
#[derive(Debug, Clone, Deserialize)]
pub struct TrpcResult<T> {
    pub data: TrpcData<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum TrpcData<T> {
    Json { json: T },
    Plain(T),
}

impl<T> TrpcData<T> {
    fn into_inner(self) -> T {
        match self {
            Self::Json { json } => json,
            Self::Plain(value) => value,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDatabaseService {
    app_slug: String,
    stage: String,
    node_name: String,
    db_name: String,
    #[serde(default)]
    transports: Vec<LegacyTransport>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum LegacyTransport {
    Mesh { host: String, port: u16 },
    SshTunnel {},
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDatabaseConnection {
    user: String,
    password: String,
    db_name: String,
    #[serde(default)]
    transports: Vec<LegacyTransport>,
}

fn map_legacy_transports(transports: Vec<LegacyTransport>) -> Vec<Transport> {
    transports
        .into_iter()
        .filter_map(|transport| match transport {
            LegacyTransport::Mesh { host, port } => Some(Transport {
                kind: "mesh".to_string(),
                host,
                port,
            }),
            LegacyTransport::SshTunnel {} => None,
        })
        .collect()
}

fn map_legacy_database_services(rows: Vec<LegacyDatabaseService>) -> Vec<ForgeGraphService> {
    rows.into_iter()
        .map(|row| ForgeGraphService {
            app_slug: row.app_slug.clone(),
            app_name: row.app_slug,
            stage: row.stage,
            kind: "postgres".to_string(),
            node_name: row.node_name,
            node_status: "unknown".to_string(),
            config: serde_json::json!({ "dbName": row.db_name }),
            transports: map_legacy_transports(row.transports),
        })
        .collect()
}

fn format_api_error(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|json| {
            json.pointer("/error/json/message")
                .and_then(|message| message.as_str())
                .map(str::to_string)
        })
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| body.to_string());

    format!("ForgeGraph API error ({}): {}", status, detail)
}

fn mark_legacy_connection_available(mut service: ForgeGraphService) -> ForgeGraphService {
    let mut config = service.config.as_object().cloned().unwrap_or_default();
    config.insert("connectionAvailable".to_string(), serde_json::json!(true));
    service.config = serde_json::Value::Object(config);
    service
}

fn mark_legacy_connection_unavailable(
    mut service: ForgeGraphService,
    error: String,
) -> ForgeGraphService {
    let mut config = service.config.as_object().cloned().unwrap_or_default();
    config.insert("connectionAvailable".to_string(), serde_json::json!(false));
    config.insert("connectionError".to_string(), serde_json::json!(error));
    service.config = serde_json::Value::Object(config);
    service
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_legacy_database_list_rows_to_postgres_services() {
        let rows = vec![LegacyDatabaseService {
            app_slug: "bizpulse".to_string(),
            stage: "production".to_string(),
            node_name: "hetzner-master".to_string(),
            db_name: "bizpulse".to_string(),
            transports: vec![
                LegacyTransport::Mesh {
                    host: "100.101.32.120".to_string(),
                    port: 5432,
                },
                LegacyTransport::SshTunnel {},
            ],
        }];

        let services = map_legacy_database_services(rows);

        assert_eq!(services.len(), 1);
        assert_eq!(services[0].app_slug, "bizpulse");
        assert_eq!(services[0].app_name, "bizpulse");
        assert_eq!(services[0].kind, "postgres");
        assert_eq!(services[0].transports.len(), 1);
        assert_eq!(services[0].transports[0].host, "100.101.32.120");
        assert_eq!(services[0].config["dbName"], "bizpulse");
    }

    #[test]
    fn formats_trpc_error_message_without_raw_json() {
        let body = r#"{"error":{"json":{"message":"Binding for playtrek/production has no credential secret","code":-32012,"data":{"code":"PRECONDITION_FAILED","httpStatus":412,"path":"database.connection"}}}}"#;

        let message = format_api_error(reqwest::StatusCode::PRECONDITION_FAILED, body);

        assert_eq!(
            message,
            "ForgeGraph API error (412 Precondition Failed): Binding for playtrek/production has no credential secret"
        );
    }

    #[test]
    fn marks_legacy_service_unavailable_when_connection_probe_fails() {
        let service = ForgeGraphService {
            app_slug: "playtrek".to_string(),
            app_name: "playtrek".to_string(),
            stage: "production".to_string(),
            kind: "postgres".to_string(),
            node_name: "playpath".to_string(),
            node_status: "unknown".to_string(),
            config: serde_json::json!({ "dbName": "playpath" }),
            transports: vec![],
        };

        let service = mark_legacy_connection_unavailable(service, "missing secret".to_string());

        assert_eq!(service.config["connectionAvailable"], false);
        assert_eq!(service.config["connectionError"], "missing secret");
    }
}

/// Fetch the list of all services from the ForgeGraph API.
pub async fn list_services(server: &str, token: &str) -> Result<Vec<ForgeGraphService>, String> {
    let base = server.trim_end_matches('/');
    if !base.starts_with("https://") {
        return Err("ForgeGraph server URL must use HTTPS".to_string());
    }
    let url = format!("{}/api/trpc/services.list", base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("ForgeGraph request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph authentication failed. Check your API token.".to_string());
    }

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return list_legacy_database_services(base, token, &client).await;
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format_api_error(status, &body));
    }

    let trpc: TrpcResponse<Vec<ForgeGraphService>> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;

    Ok(trpc.result.data.into_inner())
}

async fn list_legacy_database_services(
    base: &str,
    token: &str,
    client: &reqwest::Client,
) -> Result<Vec<ForgeGraphService>, String> {
    let url = format!("{}/api/trpc/database.list", base);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("ForgeGraph request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph authentication failed. Check your API token.".to_string());
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format_api_error(status, &body));
    }

    let trpc: TrpcResponse<Vec<LegacyDatabaseService>> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;

    let services = map_legacy_database_services(trpc.result.data.into_inner());
    let mut checked_services = Vec::with_capacity(services.len());
    for service in services {
        match get_legacy_database_connection(base, token, &service.app_slug, &service.stage, client)
            .await
        {
            Ok(_) => checked_services.push(mark_legacy_connection_available(service)),
            Err(error) => checked_services.push(mark_legacy_connection_unavailable(service, error)),
        }
    }

    Ok(checked_services)
}

/// Fetch connection credentials for a specific service.
pub async fn get_connection(
    server: &str,
    token: &str,
    app_slug: &str,
    stage: &str,
    kind: &str,
) -> Result<ForgeGraphConnection, String> {
    let base = server.trim_end_matches('/');
    if !base.starts_with("https://") {
        return Err("ForgeGraph server URL must use HTTPS".to_string());
    }

    let input = serde_json::json!({
        "json": {
            "appSlug": app_slug,
            "stage": stage,
            "kind": kind,
        }
    });
    let input_str =
        serde_json::to_string(&input).map_err(|e| format!("Failed to serialize input: {}", e))?;
    let encoded = urlencoding::encode(&input_str);

    let url = format!("{}/api/trpc/services.connection?input={}", base, encoded);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("ForgeGraph request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph authentication failed. Check your API token.".to_string());
    }

    if resp.status() == reqwest::StatusCode::NOT_FOUND && kind == "postgres" {
        return get_legacy_database_connection(base, token, app_slug, stage, &client).await;
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format_api_error(status, &body));
    }

    let trpc: TrpcResponse<ForgeGraphConnection> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;

    Ok(trpc.result.data.into_inner())
}

async fn get_legacy_database_connection(
    base: &str,
    token: &str,
    app_slug: &str,
    stage: &str,
    client: &reqwest::Client,
) -> Result<ForgeGraphConnection, String> {
    let input = serde_json::json!({
        "json": {
            "appSlug": app_slug,
            "stage": stage,
        }
    });
    let input_str =
        serde_json::to_string(&input).map_err(|e| format!("Failed to serialize input: {}", e))?;
    let encoded = urlencoding::encode(&input_str);
    let url = format!("{}/api/trpc/database.connection?input={}", base, encoded);

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("ForgeGraph request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph authentication failed. Check your API token.".to_string());
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format_api_error(status, &body));
    }

    let trpc: TrpcResponse<LegacyDatabaseConnection> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;
    let conn = trpc.result.data.into_inner();

    Ok(ForgeGraphConnection {
        app_slug: app_slug.to_string(),
        app_name: app_slug.to_string(),
        stage: stage.to_string(),
        kind: "postgres".to_string(),
        node_name: String::new(),
        node_status: "unknown".to_string(),
        config: serde_json::json!({ "dbName": conn.db_name, "dbUser": conn.user }),
        transports: map_legacy_transports(conn.transports),
        credentials: serde_json::json!({
            "dbName": conn.db_name,
            "database": conn.db_name,
            "username": conn.user,
            "password": conn.password,
        }),
    })
}
