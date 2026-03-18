#!/bin/bash
# Build the dbcooper-mcp sidecar binary and copy it to the Tauri binaries directory
# with the required target-triple suffix.
#
# We use --lib=false to avoid triggering tauri_build which validates the sidecar exists.

set -e

TARGET_TRIPLE=$(rustc -vV | grep host | cut -d' ' -f2)
DEST="src-tauri/binaries/dbcooper-mcp-${TARGET_TRIPLE}"
PROFILE="${1:-debug}"

# Create a placeholder so tauri_build doesn't fail if the lib also gets compiled
mkdir -p src-tauri/binaries
if [ ! -f "$DEST" ]; then
    touch "$DEST"
    chmod +x "$DEST"
fi

if [ "$PROFILE" = "release" ]; then
    cargo build --bin dbcooper-mcp --release --manifest-path src-tauri/Cargo.toml
    cp "src-tauri/target/release/dbcooper-mcp" "$DEST"
else
    cargo build --bin dbcooper-mcp --manifest-path src-tauri/Cargo.toml
    cp "src-tauri/target/debug/dbcooper-mcp" "$DEST"
fi

echo "Built dbcooper-mcp sidecar for ${TARGET_TRIPLE} (${PROFILE})"
