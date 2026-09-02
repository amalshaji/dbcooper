# DBcooper v0.0.69

DBcooper 0.0.69 adds a live observability workspace for database logs and current server activity, and strengthens macOS release verification.

## What's changed since v0.0.68

### Live logs and activity

- Open Logs from a connected database workspace to view current database output without persisting it in DBcooper.
- Stream logs from DBcooper-linked Docker containers and use engine-native log sources when the server exposes them.
- Inspect current database activity separately from logs, with capability-aware sources for supported engines.
- Search visible entries, filter by severity, pause automatic following, copy individual or visible lines, and clear the in-memory buffer.
- Parse common PostgreSQL, ClickHouse, and Redis log formats while preserving the original text.
- Keep activity rows stable between refreshes and retain final diagnostic entries when a stream stops.

### macOS distribution

- Submit, staple, validate, and Gatekeeper-check the final DMG before publishing it.
- Continue signing updater artifacts and the bundled app for verified stable updates.
