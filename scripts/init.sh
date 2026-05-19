#!/bin/bash

# Remote Dev - Initialization Script
# This script sets up the development environment for Remote Dev

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_PORT=6001
DEFAULT_TERMINAL_PORT=6002
USE_DEFAULTS=false
EMAIL=""
PORT=""
TERMINAL_PORT=""
BASE_PATH=""
INSTANCE_SLUG=""
SKIP_START=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --defaults)
            USE_DEFAULTS=true
            shift
            ;;
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --terminal-port)
            TERMINAL_PORT="$2"
            shift 2
            ;;
        --base-path)
            BASE_PATH="$2"
            shift 2
            ;;
        --instance-slug)
            INSTANCE_SLUG="$2"
            shift 2
            ;;
        --skip-start)
            SKIP_START=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --defaults             Use default values, skip prompts"
            echo "  --email EMAIL          Set authorized user email"
            echo "  --port PORT            Set Next.js port (default: 6001)"
            echo "  --terminal-port PORT   Set terminal server port (default: 6002)"
            echo "  --base-path PATH       Set RDV_BASE_PATH for multi-instance hosting"
            echo "                         (e.g. /alpha). Must start with / and not end with /."
            echo "  --instance-slug SLUG   Set RDV_INSTANCE_SLUG (defaults to last basePath segment)."
            echo "  --skip-start           Skip starting dev server at the end"
            echo "  -h, --help             Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Validate --base-path early so we fail before touching anything.
if [ -n "$BASE_PATH" ]; then
    if ! [[ "$BASE_PATH" =~ ^(/[a-z0-9][a-z0-9-]*)+$ ]]; then
        echo -e "${RED}Invalid --base-path: '$BASE_PATH'${NC}"
        echo "Must match /[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)* (e.g. /alpha or /team/alpha)."
        exit 1
    fi
    # Derive slug from last segment if not explicitly set.
    if [ -z "$INSTANCE_SLUG" ]; then
        INSTANCE_SLUG="${BASE_PATH##*/}"
    fi
fi

if [ -n "$INSTANCE_SLUG" ] && ! [[ "$INSTANCE_SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo -e "${RED}Invalid --instance-slug: '$INSTANCE_SLUG'${NC}"
    echo "Must match [a-z0-9][a-z0-9-]* (e.g. alpha, team-1)."
    exit 1
fi

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║       Remote Dev - Setup Script          ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Function to prompt user
prompt() {
    local prompt_text="$1"
    local default_value="$2"
    local var_name="$3"

    if [ "$USE_DEFAULTS" = true ] && [ -n "$default_value" ]; then
        eval "$var_name='$default_value'"
        return
    fi

    if [ -n "$default_value" ]; then
        read -p "$prompt_text [$default_value]: " input
        eval "$var_name='${input:-$default_value}'"
    else
        read -p "$prompt_text: " input
        eval "$var_name='$input'"
    fi
}

# Function to check if command exists
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

# Step 1: Check prerequisites
echo -e "\n${YELLOW}Step 1: Checking prerequisites...${NC}\n"

# Check bun
if ! check_command "bun"; then
    echo -e "${YELLOW}Installing bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Check tmux
if ! check_command "tmux"; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}Installing tmux via Homebrew...${NC}"
        if ! check_command "brew"; then
            echo -e "${RED}Homebrew not found. Please install tmux manually:${NC}"
            echo "  brew install tmux"
            exit 1
        fi
        brew install tmux
    else
        echo -e "${RED}tmux not found. Please install it:${NC}"
        echo "  Ubuntu/Debian: sudo apt install tmux"
        echo "  Fedora: sudo dnf install tmux"
        exit 1
    fi
fi

# Check git
check_command "git" || {
    echo -e "${RED}Git is required. Please install it first.${NC}"
    exit 1
}

# Step 2: Install dependencies
echo -e "\n${YELLOW}Step 2: Installing dependencies...${NC}\n"
bun install

# Step 3: Configure environment
echo -e "\n${YELLOW}Step 3: Configuring environment...${NC}\n"

ENV_FILE=".env.local"

if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Existing .env.local found.${NC}"
    if [ "$USE_DEFAULTS" = false ]; then
        read -p "Overwrite? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            echo "Keeping existing configuration."
        else
            rm "$ENV_FILE"
        fi
    fi
fi

# Upsert helper: set KEY=VALUE in $ENV_FILE, replacing in-place if present.
# Use a delimiter unlikely to appear in values to keep sed quoting sane.
upsert_env() {
    local key="$1" value="$2"
    if [ ! -f "$ENV_FILE" ]; then
        echo "${key}=${value}" >> "$ENV_FILE"
        return
    fi
    if grep -qE "^${key}=" "$ENV_FILE"; then
        # Use a temp file for portability across BSD/GNU sed.
        local tmp
        tmp=$(mktemp)
        # shellcheck disable=SC2016
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

if [ ! -f "$ENV_FILE" ]; then
    # Generate AUTH_SECRET
    AUTH_SECRET=$(openssl rand -base64 32)

    # Get port configuration
    [ -z "$PORT" ] && prompt "Next.js port" "$DEFAULT_PORT" PORT
    [ -z "$TERMINAL_PORT" ] && prompt "Terminal server port" "$DEFAULT_TERMINAL_PORT" TERMINAL_PORT

    # GitHub OAuth (optional)
    GITHUB_CLIENT_ID=""
    GITHUB_CLIENT_SECRET=""

    if [ "$USE_DEFAULTS" = false ]; then
        echo ""
        echo -e "${BLUE}GitHub OAuth Setup (optional - press Enter to skip)${NC}"
        echo "Create an OAuth app at: https://github.com/settings/developers"
        # Register BOTH callbacks: NextAuth uses /api/auth/callback/github
        # (sign-in), and the multi-account link flow uses
        # /api/auth/github/callback. Missing the second breaks "Link
        # another GitHub account" with a redirect_uri mismatch.
        echo "Register BOTH callback URLs in your GitHub OAuth app:"
        if [ -n "$BASE_PATH" ]; then
            echo "  Sign-in (NextAuth):    http://localhost:$PORT$BASE_PATH/api/auth/callback/github"
            echo "  Account-linking:       http://localhost:$PORT$BASE_PATH/api/auth/github/callback"
        else
            echo "  Sign-in (NextAuth):    http://localhost:$PORT/api/auth/callback/github"
            echo "  Account-linking:       http://localhost:$PORT/api/auth/github/callback"
        fi
        echo ""
        read -p "GitHub Client ID: " GITHUB_CLIENT_ID
        if [ -n "$GITHUB_CLIENT_ID" ]; then
            read -p "GitHub Client Secret: " GITHUB_CLIENT_SECRET
        fi
    fi

    # Write .env.local. AUTH_URL replaces the legacy NEXTAUTH_URL — NextAuth v5
    # reads AUTH_URL natively. When RDV_BASE_PATH is set, AUTH_URL must
    # include the prefix so OAuth callbacks resolve under the instance.
    AUTH_URL_VALUE="http://localhost:$PORT${BASE_PATH}"

    cat > "$ENV_FILE" << EOF
# Generated by init.sh on $(date)
AUTH_SECRET=$AUTH_SECRET

# Server ports
PORT=$PORT
TERMINAL_PORT=$TERMINAL_PORT
NEXT_PUBLIC_TERMINAL_PORT=$TERMINAL_PORT
AUTH_URL=$AUTH_URL_VALUE

# Multi-instance hosting (optional — see docs/SETUP.md "Multi-Instance Deployment")
RDV_BASE_PATH=$BASE_PATH
RDV_INSTANCE_SLUG=$INSTANCE_SLUG

# GitHub OAuth (optional)
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
EOF

    echo -e "${GREEN}✓${NC} Created .env.local"
else
    # Existing file: just upsert basePath/slug if the user passed flags.
    if [ -n "$BASE_PATH" ]; then
        upsert_env "RDV_BASE_PATH" "$BASE_PATH"
        echo -e "${GREEN}✓${NC} Set RDV_BASE_PATH=$BASE_PATH in .env.local"

        # Multi-instance deployments MUST use a unique AUTH_SECRET per
        # pod — two instances sharing a secret can decrypt each other's
        # JWTs, defeating the path-scoped cookies. We don't auto-rotate
        # (destructive — would log everyone out), but we WARN loudly
        # when the user is configuring a basePath against an existing
        # AUTH_SECRET that may have been carried over from a baseline
        # single-instance setup.
        if grep -qE "^AUTH_SECRET=" "$ENV_FILE"; then
            echo -e "${YELLOW}WARNING:${NC} --base-path is set but AUTH_SECRET in $ENV_FILE appears unchanged."
            echo "  For multi-instance deployments, AUTH_SECRET MUST be unique per instance."
            echo "  Generate fresh: openssl rand -base64 32"
            echo "  Then update AUTH_SECRET in $ENV_FILE manually."
        fi
    fi
    if [ -n "$INSTANCE_SLUG" ]; then
        upsert_env "RDV_INSTANCE_SLUG" "$INSTANCE_SLUG"
        echo -e "${GREEN}✓${NC} Set RDV_INSTANCE_SLUG=$INSTANCE_SLUG in .env.local"
    fi
fi

# Step 4: Initialize database
echo -e "\n${YELLOW}Step 4: Initializing database...${NC}\n"
bun run db:push

# Step 5: Add authorized users
echo -e "\n${YELLOW}Step 5: Adding authorized users...${NC}\n"

if [ -z "$EMAIL" ] && [ "$USE_DEFAULTS" = false ]; then
    read -p "Enter your email address for authorization: " EMAIL
fi

if [ -n "$EMAIL" ]; then
    AUTHORIZED_USERS="$EMAIL" bun run db:seed
    echo -e "${GREEN}✓${NC} Added authorized user: $EMAIL"
else
    echo -e "${YELLOW}⚠${NC} No email provided. Add users later with:"
    echo "  AUTHORIZED_USERS=\"your@email.com\" bun run db:seed"
fi

# Step 6: Build check
echo -e "\n${YELLOW}Step 6: Verifying build...${NC}\n"
bun run build

# Done!
echo -e "\n${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║         Setup Complete!                  ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Load port from .env.local for display
source "$ENV_FILE" 2>/dev/null || true

echo -e "Configuration:"
echo -e "  Next.js:    http://localhost:${PORT:-6001}"
echo -e "  Terminal:   ws://localhost:${TERMINAL_PORT:-6002}"
echo ""

if [ -n "$GITHUB_CLIENT_ID" ]; then
    echo -e "  ${GREEN}✓${NC} GitHub OAuth configured"
else
    echo -e "  ${YELLOW}⚠${NC} GitHub OAuth not configured (optional)"
fi

echo ""
echo -e "To start the development server:"
echo -e "  ${BLUE}bun run dev${NC}"
echo ""

if [ "$SKIP_START" = false ]; then
    if [ "$USE_DEFAULTS" = true ]; then
        start_server="y"
    else
        read -p "Start development server now? (Y/n): " start_server
    fi

    if [[ ! "$start_server" =~ ^[Nn]$ ]]; then
        echo -e "\n${YELLOW}Starting development server...${NC}\n"
        exec bun run dev
    fi
fi
