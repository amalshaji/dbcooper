# Spec: On-demand DuckDB helper

## Objective

Keep DuckDB support without embedding DuckDB in the DBcooper application binary. On the first DuckDB connection, download the pinned official DuckDB CLI for the current platform, show installation progress, verify its SHA-256 digest, and install it in DBcooper's application data directory. Later connections reuse the verified helper.

## Tech Stack

- Rust/Tauri command for helper lifecycle and DuckDB CLI execution
- React/TypeScript for progress UI
- Official DuckDB 1.5.5 release archives from GitHub Releases
- SHA-256 integrity verification and ZIP extraction

## Commands

- Frontend test: `bun test src`
- Frontend typecheck: `bun run typecheck`
- Frontend lint: `bun run lint`
- Frontend build: `bun run build`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`

## Project Structure

- `src-tauri/src/duckdb_helper.rs`: pinned manifest, download, verification, atomic installation
- `src-tauri/src/database/duckdb.rs`: DuckDB CLI-backed database driver
- `src-tauri/tests/`: helper and DuckDB integration coverage
- `src/lib/duckdbHelper.ts`: frontend helper installation session
- `src/components/`: reusable helper progress UI
- `src/pages/ConnectionDetails.tsx`: saved-connection progress

## Code Style

```rust
let archive = manifest_for_current_platform()?;
verify_sha256(&bytes, archive.sha256)?;
install_atomically(&bytes, destination).await?;
```

Use existing Rust error strings, TypeScript aliases, shadcn components, and app spacing/radius tokens. Do not add database migrations because helper installation does not alter persisted connection data.

## Testing Strategy

- Unit-test platform manifest selection, checksum rejection, and helper status.
- Keep the existing DuckDB integration suite, running it against the downloaded official CLI in tests.
- Unit-test frontend progress state and render behavior.
- Run the complete Rust and frontend checks before push.

## Threat Model

- A compromised or truncated download must never execute: pin HTTPS URLs and SHA-256 hashes, verify before extraction/rename, and delete temporary artifacts on failure.
- SQL text must go through process stdin, never through a shell command string.
- The helper path is app-owned and fixed; callers cannot choose an executable.
- Concurrent first-use calls must share one installation and must not expose a partial executable.
- Read-only AI/query paths retain external-access and extension restrictions.

## Boundaries

- Always: preserve DuckDB files, verify downloads, emit accessible progress, reuse the installed helper.
- Ask first: changing the pinned DuckDB version or download host.
- Never: execute an unverified archive, interpolate SQL into a shell, silently fall back to an arbitrary PATH executable.

## Success Criteria

- The release binary no longer links the `duckdb` crate or bundled DuckDB library.
- First DuckDB use displays download byte progress followed by verification and installation states.
- A verified helper is reused without downloading on subsequent use.
- Existing DuckDB connection, schema, query, pagination, complex-value, and read-only tests pass through the CLI helper.
- Supported targets are macOS/Linux/Windows on x64 and ARM64; unsupported targets return an actionable error.
- Frontend and Rust checks pass and the PR branch is pushed.

## Open Questions

None. The user approved the on-demand helper and requested visible progress.

## Implementation Plan

1. Add the pinned helper manifest and lifecycle command; verify with unit tests.
2. Convert the DuckDB driver to execute the verified helper; verify with integration tests.
3. Add a shared frontend install session and progress presentation to new and saved connection flows.
4. Remove the embedded dependency, run full verification, compare binary size, and push the PR update.
