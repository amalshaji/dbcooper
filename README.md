# DBcooper

A modern PostgreSQL database client built with Tauri, React, and TypeScript.

![dbcooper](./dbcooper.png)

## Features

- 🔌 **Connection Management** - Create, edit, and manage multiple PostgreSQL connections
- 📊 **Data Browsing** - View and filter table data with pagination
- 🔍 **Table Structure** - Inspect columns, indexes, and foreign keys
- 💾 **Query Editor** - Execute SQL queries with syntax highlighting
- 🔖 **Saved Queries** - Save and organize frequently used queries
- 🎨 **Modern UI** - Clean interface with light/dark mode support
- 🔄 **Auto Updates** - Built-in updater for seamless updates

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Database**: SQLite (local storage) + PostgreSQL (connections)
- **UI**: shadcn/ui components
- **Package Manager**: Bun

## Development

### Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [Rust](https://www.rust-lang.org/) - For Tauri backend
- macOS (for building macOS apps)

### Setup

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Build for production
bun run tauri build
```

## Building

The app is configured to build for macOS ARM (Apple Silicon). The build process:

1. Creates optimized production bundles
2. Signs the app with your signing key
3. Generates updater artifacts

## Releases

Releases are automated via GitHub Actions. To publish a new version:

1. Update `version` in `src-tauri/tauri.conf.json`
2. Commit and create a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions will build and create a draft release
4. Review and publish the release

### Required Secrets

Set these in your GitHub repository settings:

- `TAURI_SIGNING_PRIVATE_KEY` - Contents of your signing key file
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Password (if set)

## License

MIT
