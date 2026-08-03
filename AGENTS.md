# DBcooper

## Architecture

- The backend is Rust with Tauri v2. The frontend is React, TypeScript, and Vite, with Bun as the package manager and script runner.
- Run JavaScript commands from the repository root unless a command explicitly targets another directory.
- SQLite is DBcooper's internal application-state store. The app connects to PostgreSQL, SQLite, Redis, and ClickHouse databases.
- SQLx provides the internal SQLite store plus PostgreSQL and SQLite connections. Redis and ClickHouse use their dedicated drivers; do not describe SQLx as a query builder or universal database driver.
- The default application database is `<data_local_dir>/dbcooper/db.sqlite3`. `DBCOOPER_LOCAL_STORE` overrides the store directory; DBcooper creates `db.sqlite3` inside it.

## UI conventions

- Do not add comments unless they explain non-obvious intent or constraints.
- Use the shared shadcn `Spinner` for loading states. Preserve the existing button label and prefix it with `<Spinner />`; for example, `Test Connection` must remain `Test Connection` while loading.
- Do not add manual spacing between a button icon or spinner and its label. The shared `Button` component already supplies the gap.
- Run shadcn CLI commands from `src/`, where `components.json` lives.
- Keep components focused. Do not add unrelated responsibilities to oversized files such as `ConnectionDetails.tsx`; extract cohesive components or hooks while keeping changes surgical.

## Verification

- Use `bun install --frozen-lockfile` when dependencies need to be synchronized.
- For frontend changes, run `bun run check` from the repository root. It covers tests, type checking, linting, and the production build.
- For Rust changes, run focused tests first. The CI-equivalent backend command is `cd src-tauri && cargo test -- --test-threads=1`; integration tests require the PostgreSQL, Redis, and ClickHouse services defined by CI or `docker-compose.yml`.
- For manual Tauri verification, use `bun run tauri dev` and confirm the running executable belongs to the intended checkout, not an older `/Applications/DBcooper.app` installation.

## Local data and migrations

- SQLx migrations are embedded into the binary. A database whose migration ledger is newer than the running binary will fail during startup.
- When testing a custom branch or worktree, always launch it with a unique branch-specific store outside the checkout, for example `DBCOOPER_LOCAL_STORE=/private/tmp/dbcooper-feature-name bun run tauri dev` after replacing `feature-name` with the branch name. Never share a custom store between concurrently tested branches or point them at the real application database.
- Never remove tables or `_sqlx_migrations` rows from the real database without explicit user approval. Inventory affected rows, create and verify a recoverable full backup, make the rollback transactionally, and finish with `PRAGMA integrity_check` plus a ledger check.

## Releases

- Every successful merge to `main` produces a canary build. Stable remains the default updater channel; canary updates require explicit opt-in in Settings.
- Start stable releases by running **Prepare stable release** on `main` with a `patch`, `minor`, `major`, or explicit version. The workflow opens the version PR; after it is reviewed and merged, the workflow verifies the merged source and builds the signed app before creating the stable tag and draft release. Smoke-test the DMG before publishing the draft.
