#!/usr/bin/env bash
# Deploy Setup Script
#
# Sets up the CI/CD deployment system on the production machine:
# 1. Generates DEPLOY_WEBHOOK_SECRET if not set
# 2. Initializes deploy state
# 3. Installs the watchdog launchd service (macOS)
#
# Usage:
#   bash scripts/deploy-setup.sh
#   bash scripts/deploy-setup.sh --uninstall-watchdog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${RDV_DATA_DIR:-$HOME/.remote-dev}"
ENV_FILE="${DATA_DIR}/.env.local"
OS="$(uname -s)"

# Also check project-local .env.local
PROJECT_ENV_FILE="${PROJECT_ROOT}/.env.local"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy-setup]${NC} $1"; }
ok()   { echo -e "${GREEN}[deploy-setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy-setup]${NC} $1"; }
err()  { echo -e "${RED}[deploy-setup]${NC} $1" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Uninstall
# ─────────────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall-watchdog" ]]; then
  if [[ "$OS" == "Darwin" ]]; then
    PLIST="$HOME/Library/LaunchAgents/dev.remote.app.watchdog.plist"
    if [[ -f "$PLIST" ]]; then
      launchctl unload "$PLIST" 2>/dev/null || true
      rm -f "$PLIST"
      ok "Watchdog service uninstalled"
    else
      log "Watchdog service not installed"
    fi
  else
    warn "Watchdog uninstall only supported on macOS currently"
  fi
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Ensure DEPLOY_WEBHOOK_SECRET
# ─────────────────────────────────────────────────────────────────────────────

# Check both env files for existing secret
HAS_SECRET=false
for envfile in "$PROJECT_ENV_FILE" "$ENV_FILE"; do
  if [[ -f "$envfile" ]] && grep -q "^DEPLOY_WEBHOOK_SECRET=" "$envfile" 2>/dev/null; then
    HAS_SECRET=true
    SECRET=$(grep "^DEPLOY_WEBHOOK_SECRET=" "$envfile" | cut -d= -f2-)
    ok "DEPLOY_WEBHOOK_SECRET found in $envfile"
    break
  fi
done

if ! $HAS_SECRET; then
  SECRET=$(openssl rand -base64 32)
  TARGET_ENV="$PROJECT_ENV_FILE"
  if [[ ! -f "$TARGET_ENV" ]]; then
    TARGET_ENV="$ENV_FILE"
  fi

  echo "" >> "$TARGET_ENV"
  echo "# Deploy webhook secret (CI/CD)" >> "$TARGET_ENV"
  echo "DEPLOY_WEBHOOK_SECRET=$SECRET" >> "$TARGET_ENV"
  ok "Generated DEPLOY_WEBHOOK_SECRET in $TARGET_ENV"
fi

echo ""
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │ Add these to your GitHub repository:                        │"
echo "  │                                                             │"
echo "  │ Secrets:                                                    │"
echo -e "  │   DEPLOY_WEBHOOK_SECRET = ${YELLOW}$SECRET${NC}"
echo "  │                                                             │"
echo "  │ Variables:                                                  │"
echo -e "  │   DEPLOY_URL = ${YELLOW}https://dev.bryanli.net${NC}"
echo "  │                                                             │"
echo "  │ Commands:                                                   │"
echo "  │   gh secret set DEPLOY_WEBHOOK_SECRET                       │"
echo "  │   gh variable set DEPLOY_URL --body https://dev.bryanli.net │"
echo "  └─────────────────────────────────────────────────────────────┘"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Ensure directories
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$DATA_DIR"/{deploy,builds/blue,builds/green,logs}
ok "Deploy directories created"

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Initialize deploy state
# ─────────────────────────────────────────────────────────────────────────────

log "Initializing deploy state..."
cd "$PROJECT_ROOT" && bun run scripts/deploy.ts --init

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Install watchdog service (macOS)
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$OS" == "Darwin" ]]; then
  log "Installing watchdog launchd service..."

  LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$LAUNCH_AGENTS_DIR"

  PLIST_SRC="$SCRIPT_DIR/service-config/dev.remote.watchdog.plist"
  PLIST_DEST="$LAUNCH_AGENTS_DIR/dev.remote.app.watchdog.plist"

  # Unload if already loaded
  launchctl unload "$PLIST_DEST" 2>/dev/null || true

  sed \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    "$PLIST_SRC" > "$PLIST_DEST"

  launchctl load -w "$PLIST_DEST"
  ok "Watchdog service installed (checks every 5 minutes)"
else
  warn "Watchdog service: only macOS (launchd) is currently supported"
  warn "On Linux, add a cron job: */5 * * * * bash $SCRIPT_DIR/watchdog.sh"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Add deploy scripts to package.json
# ─────────────────────────────────────────────────────────────────────────────

echo ""
ok "Deploy system setup complete!"
echo ""
echo "  Available commands:"
echo "    bun run deploy              # Deploy latest main"
echo "    bun run deploy:rollback     # Rollback to previous version"
echo "    bun run deploy:status       # Show deploy state"
echo "    bun run deploy:setup        # Re-run this setup"
echo ""
echo "  Watchdog logs: $DATA_DIR/logs/watchdog.log"
echo "  Deploy logs:   $DATA_DIR/deploy/deploy.log"
echo ""
