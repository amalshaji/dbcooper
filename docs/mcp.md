# MCP server

DBcooper can expose saved database connections to external MCP clients over Streamable HTTP.
The server listens on `127.0.0.1` only, requires a bearer token on every request, and runs query execution through DBcooper's read-only path.

## Enable for an external agent

There is no separate sidecar binary. Launch DBcooper once so it creates its local settings database, enable the embedded server there, then restart DBcooper.

On macOS:

```bash
DB="$HOME/Library/Application Support/dbcooper/db.sqlite3"
TOKEN="$(openssl rand -hex 32)"

sqlite3 "$DB" "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_server_enabled', 'true');"
sqlite3 "$DB" "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_auth_token', '$TOKEN');"

echo "MCP URL: http://127.0.0.1:9420/mcp"
echo "Bearer token: $TOKEN"
```

If port `9420` is busy, DBcooper tries the next ports through `9429`. Check the app log for the exact port:

```text
MCP server listening on http://127.0.0.1:<port>/mcp
```

## Test with curl

MCP Streamable HTTP requires both `application/json` and `text/event-stream` in `Accept`, and DBcooper requires `Authorization: Bearer <token>`.

```bash
curl -i http://127.0.0.1:9420/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {"name": "curl", "version": "0.0.0"}
    }
  }'
```

The response is an SSE event containing the JSON-RPC initialize response and an `Mcp-Session-Id` header. MCP clients should send that session id on later requests.

## Client configuration

Use an HTTP/Streamable HTTP MCP configuration with:

- URL: `http://127.0.0.1:<port>/mcp`
- Header: `Authorization: Bearer <token>`

The server exposes tools for listing saved connections, connecting/disconnecting a saved connection, introspecting schemas, and executing read-only queries.
