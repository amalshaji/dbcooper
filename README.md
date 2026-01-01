# DBcooper

A database client for PostgreSQL, SQLite, Redis, and ClickHouse, built with Tauri, React, and TypeScript.

![dbcooper](./docs/public/images/dbcooper.png)
![aggregation](./docs/public/images/aggregate.png)

## Installation

Download the latest `.dmg` from [Releases](https://github.com/amalshaji/dbcooper/releases).

**macOS users:** After installing, you'll need to bypass Gatekeeper since the app isn't notarized:
```bash
xattr -cr /Applications/DBcooper.app
```
Then you can open the app normally.

## Features

Check out the full list of features on our [documentation site](https://dbcooper.amal.sh/#features).

## FAQ

Find answers to common questions on our [documentation site](https://dbcooper.amal.sh/#faq).

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

### AI SQL Generation

To use AI-powered SQL generation:

1. Go to **Settings** (gear icon) and configure your OpenAI API settings:
   - **API Key**: Your OpenAI API key (required)
   - **Endpoint**: Custom endpoint URL (optional, defaults to `https://api.openai.com/v1`)

2. In the **Query Editor**, you'll see an instruction input above the SQL editor:
   - Type a natural language description (e.g., "show all users with posts from last week")
   - Click **Generate** or press Enter
   - Watch as SQL streams into the editor in real-time

The AI uses GPT-4.1 and has access to your database schema (tables and columns) for accurate query generation.

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
