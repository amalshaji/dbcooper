# ForgeGraph Integration Design

DBcooper integrates with ForgeGraph to discover and connect to managed PostgreSQL and Redis instances running on ForgeGraph nodes, accessed via Tailscale.

## Decisions

- **Scope:** Postgres and Redis via ForgeGraph. SQLite remains local-only in DBcooper.
- **Ownership:** ForgeGraph connections are managed and read-only. ForgeGraph is the source of truth for host, port, and credentials.
- **Sync:** On-launch (if configured) plus manual sync button. No background polling.
- **Transport:** Tailscale mesh IPs only. No SSH tunnel fallback from DBcooper.
- **Grouping:** Dedicated ForgeGraph section in the sidebar, separate from local connections. Tree structure: App > Stage > Service.
- **Credentials:** Fetched fresh from ForgeGraph on every connect. Never cached locally.

---

## ForgeGraph Changes

### Schema: `nodeServiceBindings` (rename from `nodeDatabaseBindings`)

Generalize the existing Postgres-only table to support multiple service types.

```
nodeServiceBindings:
  id           text PK
  nodeServiceId text FK -> nodeServices.id
  appId        text FK -> apps.id
  stageId      text FK -> stages.id
  kind         text NOT NULL  -- "postgres" | "redis"
  dbName       text nullable  -- Postgres only
  dbUser       text nullable  -- Postgres only
  config       json nullable  -- { dbIndex: 0 } for Redis, etc.
  credentialSecretId text FK nullable -> secrets.id
  createdAt    timestamp
  updatedAt    timestamp
  UNIQUE(nodeServiceId, stageId, kind, dbName)
```

Migration: rename table, add `kind` (default `"postgres"`), add `config`, make `dbName`/`dbUser` nullable. Existing rows get `kind = "postgres"`.

### New tRPC Router: `services`

**`services.list`** — All service bindings across the user's workspaces.

```typescript
// Input: none (scoped to authed user's workspaces)
// Output:
{
  appSlug: string,
  appName: string,
  stage: string,        // "production" | "staging" | etc.
  kind: "postgres" | "redis",
  nodeName: string,
  nodeStatus: "online" | "degraded" | "offline",
  config: {
    dbName?: string,    // Postgres
    dbUser?: string,    // Postgres
    dbIndex?: number,   // Redis
    credentialSecretConfigured: boolean, // true when a binding has a DB credential secret or stage DATABASE_URL
  },
  transports: {
    kind: "mesh",
    host: string,       // Tailscale IP
    port: number,
  }[],
}[]
```

**`services.connection`** — Full credentials for a specific service.

```typescript
// Input: { appSlug: string, stage: string, kind: string }
// Output: same as list entry, plus:
{
  ...listEntry,
  credentials: {
    username?: string,  // Postgres
    password?: string,  // Postgres and Redis
    dbName?: string,    // Postgres
    dbIndex?: number,   // Redis
  },
}
```

Existing `database.list` and `database.connection` endpoints remain unchanged for backward compatibility with `fg db` CLI commands.

---

## DBcooper Changes

### Rust Backend

**New module: `src-tauri/src/forgegraph.rs`**

HTTP client using `reqwest` to call ForgeGraph tRPC endpoints. Core functions:

- `list_services(server: &str, token: &str) -> Vec<ForgeGraphService>`
- `get_connection(server: &str, token: &str, app_slug: &str, stage: &str, kind: &str) -> ForgeGraphConnection`

**New SQLite migration: `005_forgegraph.sql`**

```sql
CREATE TABLE forgegraph_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_slug TEXT NOT NULL,
    app_name TEXT NOT NULL,
    stage TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_name TEXT NOT NULL,
    node_status TEXT NOT NULL DEFAULT 'online',
    config TEXT,           -- JSON
    transports TEXT,       -- JSON array
    synced_at TEXT NOT NULL,
    UNIQUE(app_slug, stage, kind)
);
```

**New Tauri commands:**

- `forgegraph_sync` — Reads server/token from settings, calls `services.list`, upserts into `forgegraph_services` cache table, returns service list.
- `forgegraph_connect(app_slug, stage, kind)` — Calls `services.connection` for fresh credentials, creates a connection pool using the existing pool manager with the Tailscale mesh IP.
- `forgegraph_disconnect(app_slug, stage, kind)` — Tears down the pool.

**Settings keys:**

- `forgegraph_server` — ForgeGraph server URL (e.g., `https://forgegraf.com`)
- `forgegraph_token` — API token (`fg_...`)

### Frontend

**Connections page:**

Two sections in the sidebar:

```
ForgeGraph              [Sync button]
  ▼ my-app
    ▼ production
      ● my-app (pg)
      ● my-app (redis)
    ▸ staging
  ▸ other-app

Local
  my-local-db
  dev-sqlite
```

- ForgeGraph section only appears when server + token are configured.
- Clicking a service opens ConnectionDetails with a "ForgeGraph" badge and read-only connection config.
- Status dots: green = node online, gray = offline.
- Service rows show whether ForgeGraph has a credential secret configured. Missing secrets are displayed as `no secret` and the row is disabled instead of attempting `services.connection`.

**Settings page:**

New "ForgeGraph" section:
- Server URL input
- API Token input (masked with reveal toggle)
- "Test Connection" button (calls `services.list`, shows service count)
- Save triggers initial sync.

### Data Flow

**Connect:**
1. User clicks ForgeGraph service in sidebar
2. Frontend calls `forgegraph_connect(app_slug, stage, kind)`
3. Backend calls ForgeGraph `services.connection` for fresh credentials
4. Backend picks first Tailscale mesh IP as host
5. Backend creates pool via existing pool manager
6. Frontend opens ConnectionDetails — tables, queries, everything works normally

**Credential rotation:** Handled automatically — credentials are fetched fresh on every connect, never cached.

**Reconnect after rotation:** Disconnect existing pool, click Connect again, new credentials are fetched.

**Credential source:** ForgeGraph prefers a binding-level credential secret when `nodeServiceBindings.credentialSecretId` is set. If that pointer is missing, Postgres connections fall back to the app stage's shared `DATABASE_URL` secret and parse the username, password, and database name from that URL while still using the node mesh transport.

### Error Handling

- **Tailscale unreachable:** "Cannot reach node — is Tailscale connected?"
- **Token invalid (401):** "ForgeGraph token is invalid or expired." Clears cached services, directs to settings.
- **Node offline:** Gray indicator in sidebar. Connect attempt shows "Node is offline."
- **Credential secret missing:** Service remains visible in the ForgeGraph tree with a `no secret` label. DBcooper does not call `services.connection`; ForgeGraph still returns 412 if a direct API caller requests credentials for that binding.
- **No ForgeGraph configured:** ForgeGraph section hidden. Zero impact on existing users.
