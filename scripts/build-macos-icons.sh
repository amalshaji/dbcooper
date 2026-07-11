#!/bin/sh

set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
master_icon="$root_dir/src-tauri/macos/AppIcon.png"
icon_set="$root_dir/src-tauri/macos/AppIcon.xcassets/AppIcon.appiconset"
output_dir=$(mktemp -d)

trap 'rm -rf "$output_dir"' EXIT

sips -z 16 16 "$master_icon" --out "$icon_set/icon_16x16.png" >/dev/null
sips -z 32 32 "$master_icon" --out "$icon_set/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$master_icon" --out "$icon_set/icon_32x32.png" >/dev/null
sips -z 64 64 "$master_icon" --out "$icon_set/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$master_icon" --out "$icon_set/icon_128x128.png" >/dev/null
sips -z 256 256 "$master_icon" --out "$icon_set/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$master_icon" --out "$icon_set/icon_256x256.png" >/dev/null
sips -z 512 512 "$master_icon" --out "$icon_set/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$master_icon" --out "$icon_set/icon_512x512.png" >/dev/null
cp "$master_icon" "$icon_set/icon_512x512@2x.png"

xcrun actool \
  "$root_dir/src-tauri/macos/AppIcon.xcassets" \
  --compile "$output_dir" \
  --platform macosx \
  --minimum-deployment-target 10.15 \
  --app-icon AppIcon \
  --output-partial-info-plist "$output_dir/partial-info.plist" \
  --enable-on-demand-resources NO \
  >/dev/null

cp "$output_dir/Assets.car" "$root_dir/src-tauri/macos/Assets.car"
