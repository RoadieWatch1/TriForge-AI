#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TriForge AI — Mac Mini Setup Script
# Installs all prerequisites, clones the repo, builds, and packages the DMG.
#
# Usage (on the Mac Mini, in Terminal):
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/RoadieWatch1/TriForge-AI/master/packages/desktop/scripts/setup-mac.sh)"
#
# OR if you already have the repo:
#   bash packages/desktop/scripts/setup-mac.sh
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
  # Add brew to PATH for Apple Silicon
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
else
  echo "✅  Homebrew present"
fi

# ── 3. Node.js (v20 LTS) ─────────────────────────────────────────────────────
# electron-builder 25.x requires Node 18-22. Node 23+ breaks app-builder-bin's
# postinstall download script, so we pin to node@20 regardless of what else is installed.
brew install node@20 2>/dev/null || true
brew link node@20 --force --overwrite 2>/dev/null || true
# Prepend node@20 to PATH for this script session (Apple Silicon path)
if [ -f "/opt/homebrew/opt/node@20/bin/node" ]; then
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi
echo "✅  Node.js $(node -v) (pinned to v20 LTS)"

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
echo "📦  Installing npm dependencies…"
# Force a clean install so platform-specific binaries (app-builder-bin) are
# downloaded for THIS machine's architecture.
rm -rf node_modules
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

# ── 9. Package DMG ───────────────────────────────────────────────────────────
echo ""
echo "📦  Packaging TriForge AI.dmg…"
cd packages/desktop

# electron-builder.json already declares targets for arm64 + x64.
# electronVersion is pinned in the config so npm-workspaces hoisting is not a problem.
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

# Open the dist folder in Finder
open "$DIST_DIR" 2>/dev/null || true
