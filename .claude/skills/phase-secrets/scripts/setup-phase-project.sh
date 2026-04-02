#!/bin/bash

# Setup Phase Secrets in a Project
# This script helps initialize Phase in a new or existing project

set -e

echo "🔐 Phase Secrets Setup"
echo "======================"
echo ""

# Check if Phase CLI is installed
if ! command -v phase &> /dev/null; then
    echo "❌ Phase CLI is not installed"
    echo "Please install from: https://docs.phase.dev/cli/install"
    exit 1
fi

echo "✓ Phase CLI found ($(phase --version))"
echo ""

# Check if already initialized
if [ -f ".phase.json" ]; then
    echo "⚠️  Project already initialized with Phase"
    echo "Found .phase.json:"
    cat .phase.json
    echo ""
    read -p "Do you want to re-initialize? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Check authentication
echo "Checking authentication status..."
if ! phase users whoami &> /dev/null; then
    echo "❌ Not authenticated with Phase"
    echo ""
    echo "Please authenticate first:"
    echo "  phase auth"
    echo ""
    read -p "Authenticate now? (Y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        phase auth
    else
        exit 0
    fi
else
    echo "✓ Authenticated with Phase"
fi

echo ""
echo "Initializing Phase in project..."
phase init

echo ""
echo "✓ Phase initialized successfully!"
echo ""

# Check for existing .env files
if [ -f ".env" ] || [ -f ".env.local" ] || [ -f ".env.development" ]; then
    echo "📋 Found existing .env files:"
    ls -la .env* 2>/dev/null || true
    echo ""
    echo "Would you like to import secrets from these files?"
    echo "This will help migrate your existing secrets to Phase."
    echo ""
    read -p "Import secrets? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        bash "$(dirname "$0")/import-env-file.sh"
    fi
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create secrets in Phase Console: phase console"
echo "  2. Run your app with Phase: phase run --env development <command>"
echo "  3. Test in shell: phase shell --env development"
echo ""
echo "Recommended: Add .phase.json to .gitignore if it contains sensitive IDs"
