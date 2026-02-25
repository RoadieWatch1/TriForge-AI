#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TriForge AI — Mac Mini Setup Script
# Installs all prerequisites, clones the repo, builds, and packages the DMG.
#
# Usage (on the Mac Mini, in Terminal):
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/RoadieWatch1/TriForge-AI/master/packages/desktop/scripts/setup-mac.sh)"
#
# OR if you already have the repo:
#   bash ~/triforge-ai/packages/desktop/scripts/setup-mac.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_URL="https://github.com/RoadieWatch1/TriForge-AI.git"
REPO_DIR="$HOME/triforge-ai"

echo ""
echo "⚡  TriForge AI — Mac Setup"
echo "────────────────────────────────────────"
echo ""

# ── 1. Xcode Command Line Tools ───────────────────────────────────────────────
if ! xcode-select -p &>/dev/null; then
  echo "📦  Installing Xcode Command Line Tools…"
  xcode-select --install
  echo "   ⚠️  After the installer finishes, re-run this script."
  exit 0
else
  echo "✅  Xcode CLI tools present"
fi

# ── 2. Homebrew ───────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "🍺  Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
else
  echo "✅  Homebrew present"
fi

# ── 3. Node.js (v20 LTS — required by electron-builder / app-builder-bin) ────
# Node 23+ breaks app-builder-bin's postinstall binary download. Pin to v20.
echo "🔧  Pinning Node.js to v20 LTS…"
brew install node@20 || true

# Unlink any other node version so node@20 wins
brew unlink node     2>/dev/null || true
brew unlink node@21  2>/dev/null || true
brew unlink node@22  2>/dev/null || true
brew unlink node@23  2>/dev/null || true
brew unlink node@24  2>/dev/null || true
brew unlink node@25  2>/dev/null || true

brew link node@20 --force --overwrite || true

# Prepend node@20 bin to PATH for this script session (Apple Silicon path)
NODE20_BIN="/opt/homebrew/opt/node@20/bin"
if [ -d "$NODE20_BIN" ]; then
  export PATH="$NODE20_BIN:$PATH"
fi

# Clear bash's command-location cache so the new PATH takes effect immediately
hash -r 2>/dev/null || true

# Verify we're actually on v20
CURRENT_NODE="$(node -v 2>/dev/null || echo 'none')"
if [[ "$CURRENT_NODE" != v20* ]]; then
  echo ""
  echo "❌  Could not activate Node.js v20 (got $CURRENT_NODE)."
  echo "    Please run:  export PATH=\"/opt/homebrew/opt/node@20/bin:\$PATH\""
  echo "    Then re-run this script."
  exit 1
fi
echo "✅  Node.js $CURRENT_NODE (v20 LTS active)"

# ── 4. Git ───────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "📦  Installing git…"
  brew install git
else
  echo "✅  git $(git --version | awk '{print $3}') present"
fi

echo ""

# ── 5. Clone / update repo ────────────────────────────────────────────────────
if [ -d "$REPO_DIR/.git" ]; then
  echo "🔄  Updating existing repo at $REPO_DIR…"
  git -C "$REPO_DIR" pull --ff-only
else
  echo "📥  Cloning repo into $REPO_DIR…"
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# ── 6. Install npm dependencies ───────────────────────────────────────────────
echo ""
echo "📦  Installing npm dependencies (Node $(node -v))…"
# Force a clean install so platform-specific binaries (app-builder-bin arm64)
# are freshly downloaded for THIS machine using the correct Node version.
rm -rf node_modules packages/*/node_modules
npm install

# ── 7. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "🔨  Building TriForge AI…"
npm run build:desktop

# ── 8. Generate icons ─────────────────────────────────────────────────────────
echo ""
echo "🎨  Generating icons…"
node packages/desktop/scripts/make-icon.js
bash packages/desktop/scripts/make-icons-mac.sh

# ── 9. Package DMG ────────────────────────────────────────────────────────────
echo ""
echo "📦  Packaging TriForge AI.dmg…"
cd packages/desktop
npx electron-builder --mac

# ── 10. Open dist folder ──────────────────────────────────────────────────────
DIST_DIR="$REPO_DIR/packages/desktop/dist"
echo ""
echo "✅  Build complete!"
echo ""
echo "📁  DMG located at:"
ls "$DIST_DIR"/*.dmg 2>/dev/null | while read f; do echo "    $f"; done
echo ""
echo "   Double-click the .dmg to install TriForge AI."
echo ""

open "$DIST_DIR" 2>/dev/null || true
