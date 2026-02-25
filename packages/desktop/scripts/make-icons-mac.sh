#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# make-icons-mac.sh
# Converts assets/icon-1024.png → assets/icon.icns (macOS) and assets/icon.png
# Must be run on macOS — uses built-in sips and iconutil tools.
# Usage: bash scripts/make-icons-mac.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS="$SCRIPT_DIR/../assets"
SRC="$ASSETS/icon-1024.png"
ICONSET="$ASSETS/icon.iconset"

if [ ! -f "$SRC" ]; then
  echo "❌  Source icon not found: $SRC"
  echo "    Run first: node scripts/make-icon.js"
  exit 1
fi

echo "📐  Building icon set from $SRC …"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# macOS requires all these sizes in the iconset
sips -z 16   16   "$SRC" --out "$ICONSET/icon_16x16.png"      > /dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_32x32.png"      > /dev/null
sips -z 64   64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null
sips -z 128  128  "$SRC" --out "$ICONSET/icon_128x128.png"    > /dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_256x256.png"    > /dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png" > /dev/null

echo "🔨  Converting iconset to .icns …"
iconutil -c icns "$ICONSET" -o "$ASSETS/icon.icns"
rm -rf "$ICONSET"

# Also copy as generic icon.png for Linux
cp "$SRC" "$ASSETS/icon.png"

echo "✅  Done:"
echo "    $ASSETS/icon.icns"
echo "    $ASSETS/icon.png"
