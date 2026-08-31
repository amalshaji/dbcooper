# DBcooper v0.0.68

This is the first signed and notarized stable DBcooper release for Apple Silicon, and it adds a native MongoDB workbench.

## What's changed since v0.0.66

### MongoDB

- Connect with standard MongoDB URIs and browse databases, collections, and documents.
- Run find and aggregation queries, edit documents, and manage collections, indexes, and validators.
- Save and replay queries, inspect query history, and load previous work without unintentionally running it again.
- Generate streamed MongoDB query drafts with AI; drafts are validated and remain read-only until you review and run them.
- Create DBcooper-managed MongoDB 7 containers and use MongoDB with import, export, and read-only MCP tools.

### macOS distribution

- Stable and canary macOS builds are signed with a Developer ID certificate and notarized by Apple.
- The stable DMG can be installed and launched normally without bypassing Gatekeeper.
- Stable updater artifacts remain signed for verification by existing DBcooper installations.
