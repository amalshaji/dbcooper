# ForgeGraph Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate DBcooper with ForgeGraph so users can discover, connect to, and manage PostgreSQL and Redis instances running on ForgeGraph nodes via Tailscale mesh networking.

**Architecture:** Two-repo change. ForgeGraph gets a generalized `nodeServiceBindings` table (replacing Postgres-only `nodeDatabaseBindings`) and a new `services` tRPC router. DBcooper gets a Rust HTTP client for ForgeGraph's API, a local cache table, Tauri commands for sync/connect/disconnect, and frontend UI (settings, sidebar tree, read-only connection view).

**Tech Stack:** ForgeGraph: Drizzle ORM, tRPC, PostgreSQL. DBcooper: Rust/Tauri 2, reqwest, SQLx/SQLite, React 19, Tailwind CSS 4.

**Design doc:** `docs/plans/2026-04-24-forgegraph-integration-design.md`

---

## Task 1: ForgeGraph — Generalize nodeServiceBindings Schema

**Repo:** `/Volumes/dev/ForgeGraph`

**Files:**
- Modify: `packages/db/src/schema/node-service.ts`

**Step 1: Update the Drizzle schema**

In `packages/db/src/schema/node-service.ts`, rename the export and add `kind` + `config` columns. Make `dbName`/`dbUser` nullable.

Replace the `nodeDatabaseBindings` table definition (lines 62-99) with:

```typescript
/**
 * Per-app+stage service bindings on a node's shared infrastructure.
 * Each binding represents a provisioned resource (database, cache, etc.)
 * with its own credentials.
 *
 * stageId is required to prevent staging and production from sharing a resource
 * on the same node (Codex CEO review finding).
 *
 * For Postgres: dbName + dbUser are set, config is null.
 * For Redis: dbName/dbUser are null, config holds { dbIndex }.
 */
export const nodeServiceBindings = pgTable(
  "node_service_bindings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nodeServiceId: text("node_service_id")
      .notNull()
      .references(() => nodeServices.id),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    stageId: text("stage_id")
      .notNull()
      .references(() => stages.id),
    kind: text("kind").notNull().default("postgres"),
    dbName: text("db_name"),
    dbUser: text("db_user"),
    config: json("config").$type<Record<string, unknown>>(),
    credentialSecretId: text("credential_secret_id").references(
      () => secrets.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("node_svc_binding_unique_idx").on(
      table.nodeServiceId,
      table.stageId,
      table.kind,
      table.dbName,
    ),
    index("node_svc_binding_app_idx").on(table.appId),
    index("node_svc_binding_stage_idx").on(table.stageId),
    index("node_svc_binding_service_idx").on(table.nodeServiceId),
  ],
);
```

Also add a backward-compat re-export at the bottom of the file:

```typescript
/** @deprecated Use nodeServiceBindings */
export const nodeDatabaseBindings = nodeServiceBindings;
```

**Step 2: Generate the Drizzle migration**

Run: `cd /Volumes/dev/ForgeGraph/packages/db && pnpm drizzle-kit generate --name node_service_bindings`

This produces `drizzle/0051_node_service_bindings.sql`. Review the generated SQL — it should:
- Rename `node_database_bindings` → `node_service_bindings`
- Add `kind` column (text NOT NULL DEFAULT 'postgres')
- Add `config` column (json, nullable)
- Make `db_name` nullable (ALTER COLUMN DROP NOT NULL)
- Make `db_user` nullable (ALTER COLUMN DROP NOT NULL)
- Recreate indexes with new names

If the generated migration doesn't handle the rename correctly (Drizzle sometimes generates drop+create instead of rename), manually write the migration using `ALTER TABLE ... RENAME TO ...` to preserve data.

**Step 3: Update the database router to use new import**

In `packages/api/src/routers/database.ts`, change line 9:

```typescript
// Before:
import { ... nodeDatabaseBindings ... } from "@forgegraph/db/schema";
// After (no change needed — the re-export alias keeps this working)
```

Verify the import still works via the `nodeDatabaseBindings` alias.

**Step 4: Commit**

```bash
git add packages/db/src/schema/node-service.ts packages/db/drizzle/
git commit -m "feat: generalize nodeDatabaseBindings to nodeServiceBindings

Add kind and config columns to support Redis bindings alongside
Postgres. Make dbName/dbUser nullable for non-Postgres services."
```

---

## Task 2: ForgeGraph — Services tRPC Router

**Repo:** `/Volumes/dev/ForgeGraph`

**Files:**
- Create: `packages/api/src/routers/services.ts`
- Modify: `packages/api/src/routers/index.ts`

**Step 1: Create the services router**

Create `packages/api/src/routers/services.ts`:

```typescript
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  apps,
  nodes,
  nodeServices,
  nodeServiceBindings,
  secrets,
  stages,
} from "@forgegraph/db/schema";

import { createTRPCRouter, authedProcedure } from "../trpc";
import { decryptSecret } from "../crypto/age";
import { resolveUserWorkspaces } from "../lib/workspace-scope";

export const servicesRouter = createTRPCRouter({
  list: authedProcedure.query(async ({ ctx }) => {
    const workspaceIds = await resolveUserWorkspaces(ctx.db, ctx.user.id);
    if (workspaceIds.length === 0) return [];

    const rows = await ctx.db
      .select({
        appSlug: apps.slug,
        appName: apps.name,
        stage: stages.name,
        kind: nodeServiceBindings.kind,
        dbName: nodeServiceBindings.dbName,
        dbUser: nodeServiceBindings.dbUser,
        config: nodeServiceBindings.config,
        credentialSecretId: nodeServiceBindings.credentialSecretId,
        nodeName: nodes.name,
        nodeStatus: nodes.status,
        meshIps: nodes.meshIps,
        port: nodeServices.port,
      })
      .from(nodeServiceBindings)
      .innerJoin(apps, eq(nodeServiceBindings.appId, apps.id))
      .innerJoin(stages, eq(nodeServiceBindings.stageId, stages.id))
      .innerJoin(
        nodeServices,
        eq(nodeServiceBindings.nodeServiceId, nodeServices.id),
      )
      .innerJoin(nodes, eq(nodeServices.nodeId, nodes.id))
      .where(inArray(apps.workspaceId, workspaceIds))
      .orderBy(asc(apps.slug), asc(stages.name), asc(nodeServiceBindings.kind));

    return rows.map((r) => {
      const transports: { kind: "mesh"; host: string; port: number }[] = [];
      if (r.port) {
        for (const meshIp of r.meshIps ?? []) {
          transports.push({ kind: "mesh", host: meshIp, port: r.port });
        }
      }

      const config: Record<string, unknown> = {};
      config.credentialSecretConfigured = Boolean(r.credentialSecretId);
      if (r.kind === "postgres") {
        if (r.dbName) config.dbName = r.dbName;
        if (r.dbUser) config.dbUser = r.dbUser;
      } else if (r.kind === "redis") {
        const dbIndex = (r.config as Record<string, unknown> | null)?.dbIndex;
        if (dbIndex !== undefined) config.dbIndex = dbIndex;
      }

      return {
        appSlug: r.appSlug,
        appName: r.appName,
        stage: r.stage,
        kind: r.kind,
        nodeName: r.nodeName,
        nodeStatus: r.nodeStatus,
        config,
        transports,
      };
    });
  }),

  connection: authedProcedure
    .input(
      z.object({
        appSlug: z.string().min(1),
        stage: z
          .enum(["development", "staging", "beta", "production"])
          .default("production"),
        kind: z.enum(["postgres", "redis"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspaceIds = await resolveUserWorkspaces(ctx.db, ctx.user.id);
      if (workspaceIds.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `App "${input.appSlug}" not found`,
        });
      }

      const [app] = await ctx.db
        .select({ id: apps.id, name: apps.name, slug: apps.slug })
        .from(apps)
        .where(
          and(
            eq(apps.slug, input.appSlug),
            inArray(apps.workspaceId, workspaceIds),
          ),
        )
        .limit(1);

      if (!app) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `App "${input.appSlug}" not found`,
        });
      }

      const [stage] = await ctx.db
        .select({ id: stages.id, name: stages.name })
        .from(stages)
        .where(
          and(eq(stages.appId, app.id), eq(stages.name, input.stage)),
        )
        .limit(1);

      if (!stage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Stage "${input.stage}" not found for app "${input.appSlug}"`,
        });
      }

      const [row] = await ctx.db
        .select({
          kind: nodeServiceBindings.kind,
          dbName: nodeServiceBindings.dbName,
          dbUser: nodeServiceBindings.dbUser,
          config: nodeServiceBindings.config,
          credentialSecretId: nodeServiceBindings.credentialSecretId,
          servicePort: nodeServices.port,
          meshIps: nodes.meshIps,
          nodeName: nodes.name,
          nodeStatus: nodes.status,
        })
        .from(nodeServiceBindings)
        .innerJoin(
          nodeServices,
          eq(nodeServiceBindings.nodeServiceId, nodeServices.id),
        )
        .innerJoin(nodes, eq(nodeServices.nodeId, nodes.id))
        .where(
          and(
            eq(nodeServiceBindings.appId, app.id),
            eq(nodeServiceBindings.stageId, stage.id),
            eq(nodeServiceBindings.kind, input.kind),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No ${input.kind} binding for ${input.appSlug}/${input.stage}`,
        });
      }

      if (!row.servicePort) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Service on node "${row.nodeName}" has no port configured`,
        });
      }

      // Decrypt credentials if present
      let password: string | undefined;
      if (row.credentialSecretId) {
        const [secretRow] = await ctx.db
          .select({ encryptedValue: secrets.encryptedValue })
          .from(secrets)
          .where(eq(secrets.id, row.credentialSecretId))
          .limit(1);

        if (secretRow) {
          try {
            password = decryptSecret(
              secretRow.encryptedValue,
              process.env.FG_SESSION_KEY,
            );
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to decrypt credentials",
            });
          }
        }
      }

      const transports: { kind: "mesh"; host: string; port: number }[] = [];
      for (const meshIp of row.meshIps ?? []) {
        transports.push({ kind: "mesh", host: meshIp, port: row.servicePort });
      }
      if (transports.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Node has no reachable mesh transports",
        });
      }

      const config: Record<string, unknown> = {};
      const credentials: Record<string, unknown> = {};

      if (input.kind === "postgres") {
        if (row.dbName) {
          config.dbName = row.dbName;
          credentials.dbName = row.dbName;
        }
        if (row.dbUser) {
          config.dbUser = row.dbUser;
          credentials.username = row.dbUser;
        }
        if (password) credentials.password = password;
      } else if (input.kind === "redis") {
        const dbIndex = (row.config as Record<string, unknown> | null)?.dbIndex;
        if (dbIndex !== undefined) {
          config.dbIndex = dbIndex;
          credentials.dbIndex = dbIndex;
        }
        if (password) credentials.password = password;
      }

      return {
        appSlug: app.slug,
        appName: app.name,
        stage: stage.name,
        kind: row.kind,
        nodeName: row.nodeName,
        nodeStatus: row.nodeStatus,
        config,
        transports,
        credentials,
      };
    }),
});
```

**Step 2: Register the router**

In `packages/api/src/routers/index.ts`, add the import (after line 35):

```typescript
import { servicesRouter } from "./services";
```

Add to the `appRouter` object (after the `secret` entry around line 88):

```typescript
  services: servicesRouter,
```

**Step 3: Verify it compiles**

Run: `cd /Volumes/dev/ForgeGraph && pnpm -F @forgegraph/api build`

**Step 4: Commit**

```bash
git add packages/api/src/routers/services.ts packages/api/src/routers/index.ts
git commit -m "feat: add services tRPC router for DBcooper integration

Exposes services.list and services.connection endpoints that return
managed service bindings (Postgres, Redis) with Tailscale mesh
transports, credential-secret status, and decrypted credentials.
When a binding lacks `credentialSecretId`, Postgres connections fall back
to the stage's shared `DATABASE_URL` secret."
```

---

## Task 3: DBcooper — SQLite Migration for ForgeGraph Cache

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Create: `src-tauri/migrations/005_forgegraph.sql`

**Step 1: Create the migration file**

Create `src-tauri/migrations/005_forgegraph.sql`:

```sql
CREATE TABLE forgegraph_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_slug TEXT NOT NULL,
    app_name TEXT NOT NULL,
    stage TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_name TEXT NOT NULL,
    node_status TEXT NOT NULL DEFAULT 'online',
    config TEXT,
    transports TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(app_slug, stage, kind)
);
```

**Step 2: Verify migration ordering**

Run: `ls -la /Volumes/dev/dbcooper/src-tauri/migrations/`

Confirm `005_forgegraph.sql` sorts after `004_db_type.sql`.

**Step 3: Commit**

```bash
git add src-tauri/migrations/005_forgegraph.sql
git commit -m "feat: add forgegraph_services cache table migration"
```

---

## Task 4: DBcooper — Rust ForgeGraph HTTP Client & Tauri Commands

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Create: `src-tauri/src/forgegraph.rs`
- Create: `src-tauri/src/commands/forgegraph.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create the ForgeGraph HTTP client module**

Create `src-tauri/src/forgegraph.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transport {
    pub kind: String,
    pub host: String,
    pub port: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGraphService {
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    pub config: serde_json::Value,
    pub transports: Vec<Transport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGraphConnection {
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    pub config: serde_json::Value,
    pub transports: Vec<Transport>,
    pub credentials: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct TrpcResponse<T> {
    result: TrpcResult<T>,
}

#[derive(Debug, Deserialize)]
struct TrpcResult<T> {
    data: T,
}

pub async fn list_services(
    server: &str,
    token: &str,
) -> Result<Vec<ForgeGraphService>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/trpc/services.list", server.trim_end_matches('/'));

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Failed to reach ForgeGraph: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph token is invalid or expired".to_string());
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("ForgeGraph API error ({}): {}", status, body));
    }

    let body: TrpcResponse<Vec<ForgeGraphService>> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;

    Ok(body.result.data)
}

pub async fn get_connection(
    server: &str,
    token: &str,
    app_slug: &str,
    stage: &str,
    kind: &str,
) -> Result<ForgeGraphConnection, String> {
    let client = reqwest::Client::new();
    let input = serde_json::json!({
        "appSlug": app_slug,
        "stage": stage,
        "kind": kind,
    });
    let url = format!(
        "{}/api/trpc/services.connection?input={}",
        server.trim_end_matches('/'),
        urlencoding::encode(&input.to_string())
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Failed to reach ForgeGraph: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("ForgeGraph token is invalid or expired".to_string());
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("ForgeGraph API error ({}): {}", status, body));
    }

    let body: TrpcResponse<ForgeGraphConnection> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ForgeGraph response: {}", e))?;

    Ok(body.result.data)
}
```

**Step 2: Add `urlencoding` to Cargo.toml**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
urlencoding = "2"
```

**Step 3: Create ForgeGraph Tauri commands**

Create `src-tauri/src/commands/forgegraph.rs`:

```rust
use crate::database::pool_manager::{ConnectionConfig, ConnectionStatus, PoolManager};
use crate::forgegraph::{self, ForgeGraphService};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedService {
    pub id: i64,
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    pub config: Option<String>,
    pub transports: Option<String>,
    pub synced_at: String,
}

fn fg_pool_key(app_slug: &str, stage: &str, kind: &str) -> String {
    format!("fg:{}:{}:{}", app_slug, stage, kind)
}

#[tauri::command]
pub async fn forgegraph_sync(
    sqlite_pool: State<'_, SqlitePool>,
) -> Result<Vec<ForgeGraphService>, String> {
    let server: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'forgegraph_server'")
            .fetch_optional(sqlite_pool.inner())
            .await
            .map_err(|e| e.to_string())?;

    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'forgegraph_token'")
            .fetch_optional(sqlite_pool.inner())
            .await
            .map_err(|e| e.to_string())?;

    let server = server
        .filter(|s| !s.is_empty())
        .ok_or("ForgeGraph server not configured")?;
    let token = token
        .filter(|s| !s.is_empty())
        .ok_or("ForgeGraph token not configured")?;

    let services = forgegraph::list_services(&server, &token).await?;

    // Clear old cache and insert fresh data
    sqlx::query("DELETE FROM forgegraph_services")
        .execute(sqlite_pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    for svc in &services {
        sqlx::query(
            "INSERT INTO forgegraph_services (app_slug, app_name, stage, kind, node_name, node_status, config, transports, synced_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
        )
        .bind(&svc.app_slug)
        .bind(&svc.app_name)
        .bind(&svc.stage)
        .bind(&svc.kind)
        .bind(&svc.node_name)
        .bind(&svc.node_status)
        .bind(serde_json::to_string(&svc.config).ok())
        .bind(serde_json::to_string(&svc.transports).ok())
        .execute(sqlite_pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(services)
}

#[tauri::command]
pub async fn forgegraph_list_cached(
    sqlite_pool: State<'_, SqlitePool>,
) -> Result<Vec<CachedService>, String> {
    sqlx::query_as::<_, CachedService>("SELECT * FROM forgegraph_services ORDER BY app_slug, stage, kind")
        .fetch_all(sqlite_pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn forgegraph_connect(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<super::pool::ConnectionStatusResponse, String> {
    let server: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'forgegraph_server'")
            .fetch_optional(sqlite_pool.inner())
            .await
            .map_err(|e| e.to_string())?;
    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'forgegraph_token'")
            .fetch_optional(sqlite_pool.inner())
            .await
            .map_err(|e| e.to_string())?;

    let server = server
        .filter(|s| !s.is_empty())
        .ok_or("ForgeGraph server not configured")?;
    let token = token
        .filter(|s| !s.is_empty())
        .ok_or("ForgeGraph token not configured")?;

    let conn = forgegraph::get_connection(&server, &token, &app_slug, &stage, &kind).await?;

    let transport = conn
        .transports
        .first()
        .ok_or("No mesh transports available — is Tailscale connected?")?;

    let pool_key = fg_pool_key(&app_slug, &stage, &kind);

    // Disconnect existing pool if any
    pool_manager.disconnect(&pool_key).await;

    let config = match kind.as_str() {
        "postgres" => ConnectionConfig {
            db_type: "postgres".to_string(),
            host: Some(transport.host.clone()),
            port: Some(transport.port),
            database: conn.credentials.get("dbName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            username: conn.credentials.get("username")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            password: conn.credentials.get("password")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            ssl: Some(true),
            file_path: None,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_path: None,
        },
        "redis" => {
            let db_index = conn.credentials.get("dbIndex")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            ConnectionConfig {
                db_type: "redis".to_string(),
                host: Some(transport.host.clone()),
                port: Some(transport.port),
                database: Some(db_index.to_string()),
                username: None,
                password: conn.credentials.get("password")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                ssl: Some(false),
                file_path: None,
                ssh_enabled: false,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_password: None,
                ssh_key_path: None,
            }
        }
        _ => return Err(format!("Unsupported service kind: {}", kind)),
    };

    match pool_manager.connect(&pool_key, config).await {
        Ok(_) => Ok(super::pool::ConnectionStatusResponse {
            status: ConnectionStatus::Connected,
            error: None,
        }),
        Err(e) => {
            if e.contains("Connection refused") || e.contains("timed out") {
                Ok(super::pool::ConnectionStatusResponse {
                    status: ConnectionStatus::Disconnected,
                    error: Some("Cannot reach node — is Tailscale connected?".to_string()),
                })
            } else {
                Ok(super::pool::ConnectionStatusResponse {
                    status: ConnectionStatus::Disconnected,
                    error: Some(e),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn forgegraph_disconnect(
    pool_manager: State<'_, PoolManager>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<(), String> {
    let pool_key = fg_pool_key(&app_slug, &stage, &kind);
    pool_manager.disconnect(&pool_key).await;
    Ok(())
}

#[tauri::command]
pub async fn forgegraph_get_status(
    pool_manager: State<'_, PoolManager>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<super::pool::ConnectionStatusResponse, String> {
    let pool_key = fg_pool_key(&app_slug, &stage, &kind);
    let status = pool_manager.get_status(&pool_key).await;
    let error = pool_manager.get_last_error(&pool_key).await;
    Ok(super::pool::ConnectionStatusResponse { status, error })
}

#[tauri::command]
pub async fn forgegraph_pool_key(
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<String, String> {
    Ok(fg_pool_key(&app_slug, &stage, &kind))
}
```

**Step 4: Register the module and commands**

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub mod forgegraph;
```

In `src-tauri/src/lib.rs`, add the import (after the settings import, ~line 30):

```rust
use commands::forgegraph::{
    forgegraph_connect, forgegraph_disconnect, forgegraph_get_status,
    forgegraph_list_cached, forgegraph_pool_key, forgegraph_sync,
};
```

Add the module declaration (after `mod ssh_tunnel;`, line 4):

```rust
pub mod forgegraph;
```

Add to the `invoke_handler` (after `select_tables_for_query`, ~line 206):

```rust
    forgegraph_sync,
    forgegraph_list_cached,
    forgegraph_connect,
    forgegraph_disconnect,
    forgegraph_get_status,
    forgegraph_pool_key,
```

**Step 5: Verify it compiles**

Run: `cd /Volumes/dev/dbcooper && cargo check --manifest-path src-tauri/Cargo.toml`

**Step 6: Commit**

```bash
git add src-tauri/src/forgegraph.rs src-tauri/src/commands/forgegraph.rs \
        src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add ForgeGraph HTTP client and Tauri commands

Adds forgegraph_sync, forgegraph_connect, forgegraph_disconnect,
forgegraph_get_status, and forgegraph_pool_key commands. Connections
use Tailscale mesh IPs and fetch fresh credentials from ForgeGraph
on every connect."
```

---

## Task 5: DBcooper — TypeScript Types & API Wrapper

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Modify: `src/lib/tauri.ts`

**Step 1: Add ForgeGraph types**

After the `ConnectionsExport` interface (~line 194), add:

```typescript
// ForgeGraph types
export interface ForgeGraphTransport {
  kind: "mesh";
  host: string;
  port: number;
}

export interface ForgeGraphService {
  appSlug: string;
  appName: string;
  stage: string;
  kind: "postgres" | "redis";
  nodeName: string;
  nodeStatus: "online" | "degraded" | "offline";
  config: Record<string, unknown>;
  transports: ForgeGraphTransport[];
}

export interface CachedForgeGraphService {
  id: number;
  app_slug: string;
  app_name: string;
  stage: string;
  kind: string;
  node_name: string;
  node_status: string;
  config: string | null;
  transports: string | null;
  synced_at: string;
}
```

**Step 2: Add ForgeGraph API section**

In the `api` object, after the `ai` section (~line 753), add:

```typescript
  forgegraph: {
    sync: () => invoke<ForgeGraphService[]>("forgegraph_sync"),

    listCached: () =>
      invoke<CachedForgeGraphService[]>("forgegraph_list_cached"),

    connect: (appSlug: string, stage: string, kind: string) =>
      invoke<{ status: string; error?: string }>("forgegraph_connect", {
        appSlug,
        stage,
        kind,
      }),

    disconnect: (appSlug: string, stage: string, kind: string) =>
      invoke<void>("forgegraph_disconnect", {
        appSlug,
        stage,
        kind,
      }),

    getStatus: (appSlug: string, stage: string, kind: string) =>
      invoke<{ status: string; error?: string }>("forgegraph_get_status", {
        appSlug,
        stage,
        kind,
      }),

    poolKey: (appSlug: string, stage: string, kind: string) =>
      invoke<string>("forgegraph_pool_key", {
        appSlug,
        stage,
        kind,
      }),
  },
```

**Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat: add ForgeGraph types and API wrapper to frontend"
```

---

## Task 6: DBcooper — Settings UI: ForgeGraph Section

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Modify: `src/components/SettingsForm.tsx`

**Step 1: Add ForgeGraph state and load/save logic**

Add state variables alongside the existing ones (~line 34):

```typescript
const [forgegraphServer, setForgegraphServer] = useState("");
const [forgegraphToken, setForgegraphToken] = useState("");
const [showForgegraphToken, setShowForgegraphToken] = useState(false);
const [testingForgegraph, setTestingForgegraph] = useState(false);
```

In `loadSettings`, add after the openai lines:

```typescript
setForgegraphServer(settings.forgegraph_server || "");
setForgegraphToken(settings.forgegraph_token || "");
```

In `handleSave`, add after the openai save calls:

```typescript
await api.settings.set("forgegraph_server", forgegraphServer);
await api.settings.set("forgegraph_token", forgegraphToken);
```

Add a test function after `handleSave`:

```typescript
const handleTestForgegraph = async () => {
    setTestingForgegraph(true);
    try {
        await api.settings.set("forgegraph_server", forgegraphServer);
        await api.settings.set("forgegraph_token", forgegraphToken);
        const services = await api.forgegraph.sync();
        toast.success(`Connected — found ${services.length} service${services.length !== 1 ? "s" : ""}`);
    } catch (error) {
        toast.error(String(error));
    } finally {
        setTestingForgegraph(false);
    }
};
```

**Step 2: Add ForgeGraph section to the form JSX**

After the AI/OpenAI settings section and before the Save button, add:

```tsx
{/* ForgeGraph */}
<div className="space-y-4">
    <h3 className="text-sm font-medium">ForgeGraph</h3>
    <div className="space-y-2">
        <Label htmlFor="forgegraph-server">Server URL</Label>
        <Input
            id="forgegraph-server"
            type="url"
            value={forgegraphServer}
            onChange={(e) => setForgegraphServer(e.target.value)}
            placeholder="https://forgegraf.com"
        />
    </div>
    <div className="space-y-2">
        <Label htmlFor="forgegraph-token">API Token</Label>
        <div className="relative">
            <Input
                id="forgegraph-token"
                type={showForgegraphToken ? "text" : "password"}
                value={forgegraphToken}
                onChange={(e) => setForgegraphToken(e.target.value)}
                placeholder="fg_..."
                className="pr-10"
            />
            <button
                type="button"
                onClick={() => setShowForgegraphToken(!showForgegraphToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
                {showForgegraphToken ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </div>
    {forgegraphServer && forgegraphToken && (
        <Button
            variant="outline"
            size="sm"
            onClick={handleTestForgegraph}
            disabled={testingForgegraph}
        >
            {testingForgegraph ? <Spinner className="mr-2" /> : null}
            Test Connection
        </Button>
    )}
</div>
```

**Step 3: Commit**

```bash
git add src/components/SettingsForm.tsx
git commit -m "feat: add ForgeGraph settings UI (server URL + API token)"
```

---

## Task 7: DBcooper — Connections Page: ForgeGraph Sidebar Section

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Create: `src/components/ForgeGraphTree.tsx`
- Modify: `src/pages/Connections.tsx`

**Step 1: Create the ForgeGraph tree component**

Create `src/components/ForgeGraphTree.tsx`. This component:
- Takes a list of cached services and renders them as an App → Stage → Service tree
- Shows status dots (green/gray) for node online/offline
- Clicking a service triggers connection + navigation
- Has a Sync button in the header

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowsClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { api, type ForgeGraphService } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

interface ForgeGraphTreeProps {
  services: ForgeGraphService[];
  onSync: () => Promise<void>;
}

interface AppGroup {
  appSlug: string;
  appName: string;
  stages: Map<string, ForgeGraphService[]>;
}

function groupByApp(services: ForgeGraphService[]): AppGroup[] {
  const map = new Map<string, AppGroup>();
  for (const svc of services) {
    let group = map.get(svc.appSlug);
    if (!group) {
      group = { appSlug: svc.appSlug, appName: svc.appName, stages: new Map() };
      map.set(svc.appSlug, group);
    }
    const stageServices = group.stages.get(svc.stage) || [];
    stageServices.push(svc);
    group.stages.set(svc.stage, stageServices);
  }
  return Array.from(map.values());
}

export function ForgeGraphTree({ services, onSync }: ForgeGraphTreeProps) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);

  const apps = groupByApp(services);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  const toggleApp = (slug: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleStage = (key: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConnect = async (svc: ForgeGraphService) => {
    const key = `${svc.appSlug}:${svc.stage}:${svc.kind}`;
    if (svc.nodeStatus === "offline") {
      toast.error("Node is offline");
      return;
    }
    setConnecting(key);
    try {
      const result = await api.forgegraph.connect(svc.appSlug, svc.stage, svc.kind);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const poolKey = await api.forgegraph.poolKey(svc.appSlug, svc.stage, svc.kind);
      navigate(`/connections/${encodeURIComponent(poolKey)}`, {
        state: {
          forgegraph: true,
          appSlug: svc.appSlug,
          appName: svc.appName,
          stage: svc.stage,
          kind: svc.kind,
          nodeName: svc.nodeName,
          dbType: svc.kind === "postgres" ? "postgres" : "redis",
        },
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setConnecting(null);
    }
  };

  const ServiceIcon = ({ kind }: { kind: string }) =>
    kind === "postgres" ? (
      <PostgresqlIcon className="size-4 shrink-0" />
    ) : (
      <RedisIcon className="size-4 shrink-0" />
    );

  const StatusDot = ({ status }: { status: string }) => (
    <span
      className={`inline-block size-2 rounded-full shrink-0 ${
        status === "online"
          ? "bg-green-500"
          : status === "degraded"
            ? "bg-yellow-500"
            : "bg-gray-400"
      }`}
    />
  );

  if (apps.length === 0) {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ForgeGraph</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSync} disabled={syncing}>
            {syncing ? <Spinner className="size-3" /> : <ArrowsClockwise className="size-3" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">No services found</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ForgeGraph</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSync} disabled={syncing}>
          {syncing ? <Spinner className="size-3" /> : <ArrowsClockwise className="size-3" />}
        </Button>
      </div>

      <div className="space-y-0.5">
        {apps.map((app) => {
          const appExpanded = expandedApps.has(app.appSlug);
          return (
            <div key={app.appSlug}>
              <button
                type="button"
                className="flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded hover:bg-accent text-left"
                onClick={() => toggleApp(app.appSlug)}
              >
                {appExpanded ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
                <span className="truncate font-medium">{app.appName}</span>
              </button>

              {appExpanded &&
                Array.from(app.stages.entries()).map(([stageName, stageServices]) => {
                  const stageKey = `${app.appSlug}:${stageName}`;
                  const stageExpanded = expandedStages.has(stageKey);
                  return (
                    <div key={stageKey} className="ml-3">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded hover:bg-accent text-left"
                        onClick={() => toggleStage(stageKey)}
                      >
                        {stageExpanded ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
                        <span className="truncate text-muted-foreground">{stageName}</span>
                      </button>

                      {stageExpanded &&
                        stageServices.map((svc) => {
                          const svcKey = `${svc.appSlug}:${svc.stage}:${svc.kind}`;
                          const isConnecting = connecting === svcKey;
                          return (
                            <button
                              key={svcKey}
                              type="button"
                              className="flex items-center gap-2 w-full ml-3 px-2 py-1 text-sm rounded hover:bg-accent text-left"
                              onClick={() => handleConnect(svc)}
                              disabled={isConnecting}
                            >
                              <StatusDot status={svc.nodeStatus} />
                              <ServiceIcon kind={svc.kind} />
                              <span className="truncate">
                                {svc.kind === "postgres" ? (svc.config.dbName as string) || svc.appSlug : svc.appSlug}
                              </span>
                              <Badge variant="outline" className="ml-auto text-[10px] px-1 py-0">
                                {svc.kind === "postgres" ? "pg" : "redis"}
                              </Badge>
                              {isConnecting && <Spinner className="size-3" />}
                            </button>
                          );
                        })}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Integrate into Connections page**

In `src/pages/Connections.tsx`:

Add imports:

```typescript
import { ForgeGraphTree } from "@/components/ForgeGraphTree";
import type { ForgeGraphService } from "@/lib/tauri";
```

Add state:

```typescript
const [fgServices, setFgServices] = useState<ForgeGraphService[]>([]);
const [fgConfigured, setFgConfigured] = useState(false);
```

Add a ForgeGraph sync function and call it on mount alongside `fetchConnections`:

```typescript
const syncForgeGraph = async () => {
    try {
        const settings = await api.settings.getAll();
        const hasConfig = !!(settings.forgegraph_server && settings.forgegraph_token);
        setFgConfigured(hasConfig);
        if (hasConfig) {
            const services = await api.forgegraph.sync();
            setFgServices(services);
        }
    } catch (error) {
        // Sync failure is non-fatal — show cached data
        console.error("ForgeGraph sync failed:", error);
        try {
            const cached = await api.forgegraph.listCached();
            if (cached.length > 0) {
                setFgServices(cached.map((c) => ({
                    appSlug: c.app_slug,
                    appName: c.app_name,
                    stage: c.stage,
                    kind: c.kind as "postgres" | "redis",
                    nodeName: c.node_name,
                    nodeStatus: c.node_status as "online" | "degraded" | "offline",
                    config: c.config ? JSON.parse(c.config) : {},
                    transports: c.transports ? JSON.parse(c.transports) : [],
                })));
                setFgConfigured(true);
            }
        } catch {
            // ignore cache errors
        }
    }
};
```

Call it from the existing `useEffect`:

```typescript
useEffect(() => {
    fetchConnections();
    syncForgeGraph();
}, []);
```

In the JSX, add the ForgeGraph tree above the local connections list. Find the area where connections are rendered and add before it:

```tsx
{fgConfigured && (
    <>
        <ForgeGraphTree
            services={fgServices}
            onSync={async () => {
                const services = await api.forgegraph.sync();
                setFgServices(services);
            }}
        />
        {connections.length > 0 && (
            <div className="px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Local</span>
            </div>
        )}
    </>
)}
```

**Step 3: Commit**

```bash
git add src/components/ForgeGraphTree.tsx src/pages/Connections.tsx
git commit -m "feat: add ForgeGraph sidebar tree to connections page

Shows ForgeGraph services grouped by app and stage. Clicking a
service fetches fresh credentials and connects via Tailscale."
```

---

## Task 8: DBcooper — ConnectionDetails ForgeGraph Support

**Repo:** `/Volumes/dev/dbcooper`

**Files:**
- Modify: `src/pages/ConnectionDetails.tsx`

**Step 1: Handle ForgeGraph connections in ConnectionDetails**

The ConnectionDetails page currently fetches a `Connection` from the `connections` table by UUID. For ForgeGraph connections, the UUID is a synthetic pool key (e.g., `fg:myapp:production:postgres`) and the connection info comes from router state.

At the top of the component, detect ForgeGraph mode from router state:

```typescript
const location = useLocation();
const fgState = location.state as {
    forgegraph?: boolean;
    appSlug?: string;
    appName?: string;
    stage?: string;
    kind?: string;
    nodeName?: string;
    dbType?: string;
} | null;
const isForgeGraph = fgState?.forgegraph === true;
```

If `isForgeGraph`, skip the `fetchConnection` call and instead construct a minimal connection-like reference:

```typescript
if (isForgeGraph) {
    // Use the pool key (uuid param) directly for pool commands
    // The pool is already connected via forgegraph_connect
    connection.current = {
        uuid: uuid!,
        db_type: fgState!.dbType || "postgres",
        name: `${fgState!.appName} (${fgState!.stage})`,
        // ... other fields not needed for pool operations
    } as Connection;
}
```

Add a ForgeGraph badge in the header when `isForgeGraph`:

```tsx
{isForgeGraph && (
    <Badge variant="secondary" className="text-xs">
        ForgeGraph · {fgState?.nodeName}
    </Badge>
)}
```

Hide the Edit/Delete buttons when `isForgeGraph`.

The existing pool commands (`pool_list_tables`, `pool_execute_query`, etc.) take a UUID string — they'll work with the ForgeGraph pool key since `forgegraph_connect` already registered the pool under that key.

**Note:** The exact JSX changes depend on the current ConnectionDetails layout. Read the full file during implementation to find the right insertion points. The key changes are:
1. Detect ForgeGraph via `location.state`
2. Skip `fetchConnection` for ForgeGraph
3. Use the UUID param as the pool key directly
4. Add badge, hide edit/delete
5. All pool_* commands work unchanged since the pool is already connected

**Step 2: Commit**

```bash
git add src/pages/ConnectionDetails.tsx
git commit -m "feat: support ForgeGraph connections in ConnectionDetails

Shows ForgeGraph badge, hides edit/delete buttons, and uses the
ForgeGraph pool key for all pool operations."
```

---

## Task 9: Integration Testing

**Step 1: Verify ForgeGraph API (manual)**

1. Start ForgeGraph dev server
2. Create a test API token
3. Create a test app with a Postgres binding
4. Call `services.list` via curl:
   ```bash
   curl -H "Authorization: Bearer fg_..." \
     "https://forgegraf.com/api/trpc/services.list"
   ```
5. Call `services.connection`:
   ```bash
   curl -H "Authorization: Bearer fg_..." \
     "https://forgegraf.com/api/trpc/services.connection?input=%7B%22appSlug%22%3A%22test%22%2C%22stage%22%3A%22production%22%2C%22kind%22%3A%22postgres%22%7D"
   ```

**Step 2: Verify DBcooper end-to-end (manual)**

1. Run `bun run tauri dev`
2. Open Settings, enter ForgeGraph server + token, click Test Connection
3. Verify service count toast appears
4. Go to Connections page, verify ForgeGraph tree shows
5. Click a Postgres service, verify it connects and opens ConnectionDetails
6. Run a query, verify results
7. Click a Redis service, verify Redis key browser works
8. Disconnect, reconnect — verify fresh credentials are fetched

**Step 3: Commit (if any fixes needed)**

```bash
git commit -m "fix: integration test fixes for ForgeGraph"
```
