# DBcooper v0.0.70

DBcooper 0.0.70 adds Ask AI, a chat panel that answers questions about your connected database and charts the results, and makes large PostgreSQL schemas load quickly.

## What's changed since v0.0.69

### Ask AI

- Open Ask AI from the header or with ⌘I in SQL, MongoDB, and Redis workspaces to ask questions about the connected database.
- Answers can include bar, line, area, pie, scatter, or single-metric charts drawn locally from up to 1,000 result rows, with PNG export, copy, and open-in-tab for the underlying query.
- Watch each step stream live and stop a run at any point; conversations are saved and can be reopened.
- AI-generated queries run read-only and pass an additional guard that rejects file, network, and session functions.
- Proposed table or data changes never run until you choose **Approve & run**, and each approval runs at most once.
- Choose how much query data the model may see with the new Ask AI data access setting.
- Pick the model and thinking level for Claude Code, Codex, and opencode in Settings.

### PostgreSQL

- Load the schema overview from `pg_catalog`, so databases with thousands of tables and same-named foreign keys load in under a second instead of timing out.
- Show correct foreign key pairs for composite and cross-schema keys, correct index columns, and the primary flag on primary key indexes.

### Fixes

- Loading spinners rotate in place instead of wobbling.
- DBcooper-linked Docker containers reconnect on their current published host port after a container restart.
- Connection title bars can be dragged from their empty areas again.
- The MongoDB toolbar and document browser no longer overflow when the Ask AI panel is open.
