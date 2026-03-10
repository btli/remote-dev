#!/usr/bin/env bash
set -euo pipefail

# Remote Dev Installer
#
# Installs Remote Dev as a background service on Linux (systemd) or macOS (launchd).
#
# Usage:
#   ./install.sh                              # Install with defaults
#   ./install.sh --data-dir /opt/remote-dev   # Custom data directory
#   ./install.sh --port 8080                  # Custom port
#   ./install.sh --uninstall                  # Remove the service
#
# Environment:
#   RDV_DATA_DIR   Override default data directory (~/.remote-dev)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
DATA_DIR="${RDV_DATA_DIR:-$HOME/.remote-dev}"
PORT="${PORT:-6001}"
TERMINAL_PORT="${TERMINAL_PORT:-6002}"
UNINSTALL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --terminal-port) TERMINAL_PORT="$2"; shift 2 ;;
    --uninstall) UNINSTALL=true; shift ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --data-dir DIR       Data directory (default: ~/.remote-dev)"
      echo "  --port PORT          Next.js port (default: 6001)"
      echo "  --terminal-port PORT Terminal port (default: 6002)"
      echo "  --uninstall          Remove the service"
      echo "  --help               Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

OS="$(uname -s)"
INSTALL_DIR="$DATA_DIR/releases/current"
VERSION=$(node -e "console.log(require('$TARBALL_ROOT/package.json').version)" 2>/dev/null || echo "unknown")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[rdv]${NC} $1"; }
ok()   { echo -e "${GREEN}[rdv]${NC} $1"; }
warn() { echo -e "${YELLOW}[rdv]${NC} $1"; }
err()  { echo -e "${RED}[rdv]${NC} $1" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Uninstall
# ─────────────────────────────────────────────────────────────────────────────

uninstall() {
  log "Uninstalling Remote Dev..."

  if [[ "$OS" == "Linux" ]]; then
    systemctl --user stop remote-dev remote-dev-terminal 2>/dev/null || true
    systemctl --user disable remote-dev remote-dev-terminal 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/remote-dev.service"
    rm -f "$HOME/.config/systemd/user/remote-dev-terminal.service"
    systemctl --user daemon-reload
  elif [[ "$OS" == "Darwin" ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/dev.remote.app.plist" 2>/dev/null || true
    launchctl unload "$HOME/Library/LaunchAgents/dev.remote.app.terminal.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/dev.remote.app.plist"
    rm -f "$HOME/Library/LaunchAgents/dev.remote.app.terminal.plist"
  fi

  ok "Service uninstalled. Data directory ($DATA_DIR) was preserved."
  echo "  To remove all data: rm -rf $DATA_DIR"
}

if $UNINSTALL; then
  uninstall
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Prerequisites
# ─────────────────────────────────────────────────────────────────────────────

log "Installing Remote Dev v${VERSION}"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  err "Node.js is required but not found."
  err "Install from: https://nodejs.org/ (v20+)"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js v20+ required, found v$NODE_VERSION"
  exit 1
fi
ok "Node.js v$NODE_VERSION"

# Check for tmux
if ! command -v tmux &>/dev/null; then
  err "tmux is required but not found."
  if [[ "$OS" == "Linux" ]]; then
    err "Install with: sudo apt install tmux"
  elif [[ "$OS" == "Darwin" ]]; then
    err "Install with: brew install tmux"
  fi
  exit 1
fi
ok "tmux $(tmux -V | awk '{print $2}')"

# ─────────────────────────────────────────────────────────────────────────────
# Install files
# ─────────────────────────────────────────────────────────────────────────────

RELEASES_DIR="$DATA_DIR/releases"
VERSION_DIR="$RELEASES_DIR/$VERSION"
CURRENT_LINK="$RELEASES_DIR/current"

# Create directories
mkdir -p "$DATA_DIR"/{logs,server,run,rdv}
mkdir -p "$RELEASES_DIR"

# Copy release files
log "Installing to $VERSION_DIR..."
if [[ -d "$VERSION_DIR" ]]; then
  rm -rf "$VERSION_DIR"
fi
cp -r "$TARBALL_ROOT/app" "$VERSION_DIR"

# Update current symlink
ln -sfn "$VERSION" "$CURRENT_LINK"
ok "Installed v${VERSION} -> $VERSION_DIR"

# Install rdv binary if present
if [[ -f "$TARBALL_ROOT/bin/rdv" ]]; then
  LOCAL_BIN="$HOME/.local/bin"
  mkdir -p "$LOCAL_BIN"
  cp "$TARBALL_ROOT/bin/rdv" "$LOCAL_BIN/rdv"
  chmod +x "$LOCAL_BIN/rdv"
  ok "rdv CLI installed to $LOCAL_BIN/rdv"

  # Check if ~/.local/bin is in PATH
  if ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
    warn "Add $LOCAL_BIN to your PATH:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Environment file
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="$DATA_DIR/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating $ENV_FILE..."
  AUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)

  cat > "$ENV_FILE" <<ENVEOF
# Remote Dev Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

AUTH_SECRET=$AUTH_SECRET
PORT=$PORT
TERMINAL_PORT=$TERMINAL_PORT
NEXT_PUBLIC_TERMINAL_PORT=$TERMINAL_PORT
NEXTAUTH_URL=http://localhost:$PORT
AUTH_URL=http://localhost:$PORT
DATABASE_URL=file:$DATA_DIR/sqlite.db

# Socket paths for production (uncomment to use Unix sockets instead of ports)
# SOCKET_PATH=$DATA_DIR/run/nextjs.sock
# TERMINAL_SOCKET=$DATA_DIR/run/terminal.sock

# GitHub OAuth (optional)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Update check interval in hours (default: 4)
# UPDATE_CHECK_INTERVAL_HOURS=4
ENVEOF

  chmod 600 "$ENV_FILE"
  ok "Environment file created"
else
  ok "Environment file exists ($ENV_FILE)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Service installation
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$OS" == "Linux" ]]; then
  log "Installing systemd user services..."

  SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SYSTEMD_DIR"

  # Next.js service
  sed \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    "$TARBALL_ROOT/service-config/remote-dev.service" \
    > "$SYSTEMD_DIR/remote-dev.service"

  # Terminal service
  sed \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    "$TARBALL_ROOT/service-config/remote-dev-terminal.service" \
    > "$SYSTEMD_DIR/remote-dev-terminal.service"

  systemctl --user daemon-reload
  systemctl --user enable remote-dev remote-dev-terminal
  systemctl --user start remote-dev-terminal
  sleep 2
  systemctl --user start remote-dev

  ok "Services installed and started"
  echo ""
  echo "  Status:   systemctl --user status remote-dev"
  echo "  Logs:     journalctl --user -u remote-dev -f"
  echo "  Stop:     systemctl --user stop remote-dev remote-dev-terminal"
  echo "  Restart:  systemctl --user restart remote-dev remote-dev-terminal"

elif [[ "$OS" == "Darwin" ]]; then
  log "Installing launchd services..."

  LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$LAUNCH_AGENTS_DIR"

  # Find Node.js path
  NODE_PATH=$(which node)

  # Next.js plist
  sed \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    -e "s|/usr/local/bin/node|$NODE_PATH|g" \
    "$TARBALL_ROOT/service-config/dev.remote.app.plist" \
    > "$LAUNCH_AGENTS_DIR/dev.remote.app.plist"

  # Terminal plist
  sed \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    -e "s|/usr/local/bin/node|$NODE_PATH|g" \
    "$TARBALL_ROOT/service-config/dev.remote.app.terminal.plist" \
    > "$LAUNCH_AGENTS_DIR/dev.remote.app.terminal.plist"

  # Source env vars and add to plists
  if [[ -f "$ENV_FILE" ]]; then
    # Read key env vars from .env.local and inject into plist EnvironmentVariables
    while IFS='=' read -r key value; do
      [[ -z "$key" || "$key" =~ ^# ]] && continue
      # Strip quotes
      value="${value%\"}"
      value="${value#\"}"

      for plist in dev.remote.app.plist dev.remote.app.terminal.plist; do
        /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:${key} string ${value}" \
          "$LAUNCH_AGENTS_DIR/$plist" 2>/dev/null || \
        /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:${key} ${value}" \
          "$LAUNCH_AGENTS_DIR/$plist" 2>/dev/null || true
      done
    done < "$ENV_FILE"
  fi

  launchctl load -w "$LAUNCH_AGENTS_DIR/dev.remote.app.terminal.plist"
  sleep 2
  launchctl load -w "$LAUNCH_AGENTS_DIR/dev.remote.app.plist"

  ok "Services installed and started"
  echo ""
  echo "  Status:   launchctl list | grep dev.remote"
  echo "  Logs:     tail -f $DATA_DIR/logs/nextjs.log"
  echo "  Stop:     launchctl unload ~/Library/LaunchAgents/dev.remote.app.plist"
  echo "  Restart:  launchctl kickstart -k gui/\$(id -u)/dev.remote.app"

else
  warn "Unsupported OS: $OS"
  warn "You can start the servers manually:"
  echo "  cd $INSTALL_DIR"
  echo "  node dist-terminal/index.js &"
  echo "  node scripts/standalone-server.js"
fi

echo ""
ok "Remote Dev v${VERSION} installed successfully!"
echo ""
echo "  Web UI:    http://localhost:$PORT"
echo "  Data dir:  $DATA_DIR"
echo "  Config:    $ENV_FILE"
echo ""
