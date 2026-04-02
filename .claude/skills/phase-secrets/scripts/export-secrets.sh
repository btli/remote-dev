#!/bin/bash

# Export Secrets from Phase
# This script helps export secrets in various formats

set -e

echo "🥡 Export Secrets from Phase"
echo "============================"
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

echo "✓ Ready to export secrets"
echo ""

# Get environment
read -p "Enter environment name (development, staging, production): " env_name
if [ -z "$env_name" ]; then
    echo "❌ Environment name is required"
    exit 1
fi

echo ""
echo "Export formats:"
echo "  1. .env format (default)"
echo "  2. JSON"
echo "  3. YAML"
echo ""
read -p "Select format (1-3) [1]: " format_choice
format_choice=${format_choice:-1}

case "$format_choice" in
    1)
        format="dotenv"
        extension=".env"
        ;;
    2)
        format="json"
        extension=".json"
        ;;
    3)
        format="yaml"
        extension=".yaml"
        ;;
    *)
        echo "Invalid choice, using .env format"
        format="dotenv"
        extension=".env"
        ;;
esac

# Generate filename
default_filename="secrets.${env_name}${extension}"
read -p "Output filename [$default_filename]: " output_file
output_file=${output_file:-$default_filename}

echo ""
echo "Exporting secrets from environment: $env_name"
echo "Format: $format"
echo "Output: $output_file"
echo ""

# Export secrets
if [ "$format" = "dotenv" ]; then
    phase secrets export --env "$env_name" > "$output_file"
else
    phase secrets export --env "$env_name" --format "$format" > "$output_file"
fi

if [ $? -eq 0 ]; then
    echo "✓ Secrets exported successfully to: $output_file"

    # Count exported secrets
    if [ "$format" = "dotenv" ]; then
        secret_count=$(grep -c "^[^#].*=" "$output_file" 2>/dev/null || echo "0")
        echo "  Exported $secret_count secrets"
    fi

    echo ""
    echo "⚠️  Security Warning:"
    echo "  - This file contains sensitive secrets in plain text"
    echo "  - Do NOT commit this file to version control"
    echo "  - Delete after use or store securely"
    echo ""

    # Suggest adding to .gitignore
    if [ -f ".gitignore" ]; then
        if ! grep -q "$output_file" .gitignore; then
            read -p "Add $output_file to .gitignore? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                echo "$output_file" >> .gitignore
                echo "✓ Added to .gitignore"
            fi
        fi
    fi

    # Preview option
    echo ""
    read -p "Preview exported secrets? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        head -n 20 "$output_file"
        if [ $(wc -l < "$output_file") -gt 20 ]; then
            echo "... (truncated, showing first 20 lines)"
        fi
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
else
    echo "❌ Failed to export secrets"
    exit 1
fi

echo ""
echo "Export complete!"
