#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Map Tracker — Sync Check
#  Run on BOTH computers and compare output.
#  Usage:  bash sync-check.sh
# ─────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
info() { echo -e "${CYAN}  $1${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Map Tracker — Sync Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. App version ──────────────────────────
echo "[ APP VERSION ]"
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
if [ -n "$VERSION" ]; then
  ok "Version: $VERSION"
else
  fail "Could not read package.json version"
fi
echo ""

# ── 2. Git status ───────────────────────────
echo "[ GIT STATUS ]"
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
COMMIT_FULL=$(git rev-parse HEAD 2>/dev/null)

if [ -n "$BRANCH" ]; then
  ok "Branch: $BRANCH"
  ok "Commit: $COMMIT"
else
  fail "Not a git repository"
fi

# Check if ahead/behind remote
git fetch origin "$BRANCH" --quiet 2>/dev/null
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
if [ "$LOCAL" = "$REMOTE" ]; then
  ok "In sync with remote"
else
  AHEAD=$(git rev-list "origin/$BRANCH..HEAD" --count 2>/dev/null)
  BEHIND=$(git rev-list "HEAD..origin/$BRANCH" --count 2>/dev/null)
  [ "$AHEAD" -gt 0 ] 2>/dev/null  && warn "$AHEAD commit(s) ahead of remote — push needed"
  [ "$BEHIND" -gt 0 ] 2>/dev/null && warn "$BEHIND commit(s) behind remote — pull needed"
fi

DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" = "0" ]; then
  ok "Working tree clean"
else
  warn "$DIRTY uncommitted file(s) — run: git status"
fi
echo ""

# ── 3. Node / npm ───────────────────────────
echo "[ RUNTIME ]"
NODE_VER=$(node --version 2>/dev/null)
NPM_VER=$(npm --version 2>/dev/null)
if [ -n "$NODE_VER" ]; then
  ok "Node: $NODE_VER"
else
  fail "Node.js not found — install from nodejs.org"
fi
if [ -n "$NPM_VER" ]; then
  ok "npm: $NPM_VER"
fi
if [ -d "node_modules" ]; then
  ok "node_modules present"
else
  fail "node_modules missing — run: npm install"
fi
echo ""

# ── 4. Key source file checksums ────────────
echo "[ FILE CHECKSUMS ]"
echo "   Compare these line-by-line between computers."
echo ""

FILES=(
  "src/components/CentralBilling.jsx"
  "src/components/DataImport.jsx"
  "src/context/AppContext.jsx"
  "src/services/githubService.js"
  "scripts/chrome-extension/scrape-dao.js"
  "scripts/chrome-extension/sidepanel.js"
  "package.json"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    if command -v md5sum &>/dev/null; then
      HASH=$(md5sum "$f" | cut -d' ' -f1)
    elif command -v md5 &>/dev/null; then
      HASH=$(md5 -q "$f")
    else
      HASH="(md5 not available)"
    fi
    printf "   %-52s %s\n" "$f" "$HASH"
  else
    fail "Missing: $f"
  fi
done
echo ""

# ── 5. Data files ───────────────────────────
echo "[ DATA FILES ]"
DATA_FILES=(
  "src/data/transactions.json"
  "src/data/centralBilling.json"
  "src/data/cbInquiry.json"
  "src/data/inventoryData.json"
  "src/data/warehouseOrders.json"
)

for f in "${DATA_FILES[@]}"; do
  if [ -f "$f" ]; then
    SIZE=$(wc -c < "$f" | tr -d ' ')
    LINES=$(wc -l < "$f" | tr -d ' ')
    printf "   %-45s %s bytes / %s lines\n" "$f" "$SIZE" "$LINES"
  else
    warn "Missing (will load from GitHub): $f"
  fi
done
echo ""

# ── 6. Chrome extension ─────────────────────
echo "[ CHROME EXTENSION ]"
EXT_FILES=(
  "scripts/chrome-extension/manifest.json"
  "scripts/chrome-extension/sidepanel.html"
  "scripts/chrome-extension/sidepanel.js"
  "scripts/chrome-extension/scrape-dao.js"
)
ALL_PRESENT=true
for f in "${EXT_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    fail "Missing: $f"
    ALL_PRESENT=false
  fi
done
if $ALL_PRESENT; then
  ok "All extension files present"
  info "Reminder: reload the extension in chrome://extensions after pulling"
fi
echo ""

# ── 7. VS Code extensions ───────────────────
echo "[ VS CODE EXTENSIONS ]"
if command -v code &>/dev/null; then
  INSTALLED=$(code --list-extensions 2>/dev/null)
  RECOMMENDED=$(node -e "
    const r = require('./.vscode/extensions.json');
    r.recommendations.forEach(e => console.log(e));
  " 2>/dev/null)
  while IFS= read -r ext; do
    if echo "$INSTALLED" | grep -qi "$ext"; then
      ok "$ext"
    else
      warn "NOT installed: $ext  →  install with: code --install-extension $ext"
    fi
  done <<< "$RECOMMENDED"
else
  warn "VS Code CLI not in PATH — can't check extensions"
  info "Enable it: VS Code → Command Palette → 'Shell Command: Install code in PATH'"
  info "Recommended extensions listed in .vscode/extensions.json"
fi
echo ""

# ── Summary ─────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   COMMIT HASH (share this between machines):"
echo "   $COMMIT_FULL"
echo "   VERSION: $VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   To sync this computer:"
echo "   git pull                  (get latest code)"
echo "   npm install               (sync dependencies)"
echo "   npm run dev               (start the app)"
echo ""
