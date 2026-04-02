#!/bin/bash

# Import Secrets from .env Files to Phase
# This script helps migrate existing .env files into Phase

set -e

echo "📩 Import Secrets from .env Files"
echo "=================================="
echo ""

# Check if Phase CLI is installed
if ! command -v phase &> /dev/null; then
    echo "❌ Phase CLI is not installed"
    exit 1
fi

# Check if authenticated
if ! phase users whoami &> /dev/null; then
    echo "❌ Not authenticated with Phase"
    echo "Run: phase auth"
    exit 1
fi

# Check if project is initialized
if [ ! -f ".phase.json" ]; then
    echo "❌ Project not initialized with Phase"
    echo "Run: phase init"
    exit 1
fi

echo "✓ Ready to import secrets"
echo ""

# Find all .env files
env_files=$(find . -maxdepth 1 -name ".env*" -type f | grep -v ".phase.json" | sort)

if [ -z "$env_files" ]; then
    echo "❌ No .env files found in current directory"
    exit 1
fi

echo "Found .env files:"
echo "$env_files"
echo ""

# Import each file
for file in $env_files; do
    filename=$(basename "$file")

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Processing: $filename"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Suggest environment based on filename
    case "$filename" in
        .env.development|.env.dev)
            suggested_env="development"
            ;;
        .env.staging|.env.stage)
            suggested_env="staging"
            ;;
        .env.production|.env.prod)
            suggested_env="production"
            ;;
        .env.test)
            suggested_env="test"
            ;;
        .env.local)
            suggested_env="development"
            ;;
        .env)
            suggested_env="development"
            ;;
        *)
            suggested_env="development"
            ;;
    esac

    echo "Suggested environment: $suggested_env"
    read -p "Enter environment name (press Enter for '$suggested_env'): " env_name
    env_name=${env_name:-$suggested_env}

    echo ""
    echo "Importing $filename to environment: $env_name"

    # Count secrets in file
    secret_count=$(grep -c "^[^#].*=" "$file" 2>/dev/null || echo "0")
    echo "Found ~$secret_count secrets to import"
    echo ""

    # Import secrets
    if phase secrets import "$file" --env "$env_name"; then
        echo "✓ Successfully imported from $filename"

        # Ask about backing up the file
        echo ""
        read -p "Create backup of $filename? (Y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            backup_file="${file}.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$file" "$backup_file"
            echo "✓ Backup created: $backup_file"
        fi

        # Ask about removing the original
        echo ""
        echo "⚠️  Security recommendation: Remove .env files after migration"
        read -p "Remove $filename? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm "$file"
            echo "✓ Removed $filename"
        else
            echo "ℹ️  Kept $filename (consider adding to .gitignore)"
        fi
    else
        echo "❌ Failed to import from $filename"
    fi

    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Import complete!"
echo ""
echo "Next steps:"
echo "  1. Verify secrets: phase secrets list --env <environment>"
echo "  2. Test your app: phase run --env <environment> <command>"
echo "  3. Update .gitignore to exclude .env files"
echo ""
echo "Example usage:"
echo "  phase run --env development npm run dev"
echo "  phase shell --env development"
