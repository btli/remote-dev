---
name: phase-secrets
description: |
  Guide for using Phase - an open source, end-to-end encrypted platform for managing secrets and environment variables. This skill should be used when working with projects that use Phase as their secrets manager, including setting up Phase authentication, managing secrets via CLI, injecting secrets into applications at runtime, and configuring CI/CD pipelines with Phase.
---

# Phase Secrets Management

Guide for using Phase - an open source, end-to-end encrypted platform for managing secrets and environment variables.

## When to Use This Skill

- Setting up Phase in a new project
- Managing secrets and environment variables with Phase
- Injecting secrets into applications at runtime
- Importing/exporting secrets between environments
- Working with dynamic secrets (database credentials, API keys, etc.)
- Authenticating with Phase in CI/CD pipelines
- Debugging secret injection issues

## Core Concepts

### Phase Components

1. **Organization**: Top-level container for your Phase setup
2. **Application**: Represents a project/service within your organization
3. **Environment**: Deployment environments (dev, staging, production, etc.)
4. **Secrets**: Key-value pairs stored encrypted
5. **Paths**: Hierarchical organization of secrets (e.g., `/api`, `/database`)
6. **Tags**: Labels for filtering and organizing secrets

### Authentication Modes

- **webauth**: Interactive browser-based authentication (default)
- **token**: Use a Phase token for authentication
- **aws-iam**: AWS IAM-based authentication for cloud environments
- **service-account**: For CI/CD pipelines and automated workflows

## Installation & Setup

The Phase CLI should already be installed on this system. Verify with:

```bash
phase --version
```

### Initial Setup Workflow

1. **Authenticate**
```bash
phase auth
# Or for CI/CD:
phase auth --mode token
phase auth --mode aws-iam --service-account-id <id>
```

2. **Initialize Project**
```bash
phase init
```

This creates a `.phase.json` file linking your project to a Phase app.

3. **Import Existing Secrets** (Optional)
```bash
phase secrets import .env --env development
```

## CLI Commands Reference

### Authentication

```bash
# Interactive web authentication
phase auth

# Token-based authentication
phase auth --mode token

# AWS IAM authentication
phase auth --mode aws-iam --service-account-id <id>

# Don't store credentials (for CI/CD)
phase auth --mode aws-iam --no-store
```

### Project Initialization

```bash
# Link project to Phase app
phase init
```

### Running Applications with Secrets

```bash
# Inject secrets and run command
phase run <command>

# Specify environment
phase run --env production npm start

# Specify app (overrides .phase.json)
phase run --app my-api node server.js

# Use app ID directly
phase run --app-id <uuid> python app.py

# Filter by path
phase run --path /api/keys npm start

# Filter by tags
phase run --tags prod,database npm start

# Control dynamic secret leases
phase run --generate-leases false npm start
phase run --lease-ttl 3600 npm start
```

### Interactive Shell

```bash
# Start shell with secrets as environment variables
phase shell

# Specify environment
phase shell --env staging
```

### Secret Management

```bash
# List all secrets
phase secrets list
phase secrets list --env production

# Get specific secret details (JSON output)
phase secrets get SECRET_KEY --env development

# Create new secret
phase secrets create
# Follow interactive prompts for key, value, environment, path

# Update existing secret
phase secrets update
# Follow interactive prompts

# Delete secret
phase secrets delete SECRET_KEY --env production

# Import from .env file
phase secrets import .env --env development
phase secrets import .env.production --env production

# Export secrets
phase secrets export --env production
phase secrets export --env development --format json
phase secrets export --env staging --format yaml
```

### Dynamic Secrets

```bash
# Manage dynamically generated secrets (databases, APIs)
phase dynamic-secrets <command>
```

Dynamic secrets are automatically rotated credentials that Phase generates on-demand.

### User Management

```bash
# Manage users and accounts
phase users <command>
```

### Utilities

```bash
# Open documentation in browser
phase docs

# Open Phase Console web UI
phase console
```

## Common Patterns

### Development Workflow

```javascript
// package.json scripts
{
  "scripts": {
    "dev": "phase run --env development npm run dev:local",
    "dev:local": "next dev",
    "build": "next build",
    "start": "phase run --env production npm run start:local",
    "start:local": "next start"
  }
}
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Authenticate with Phase
  run: phase auth --mode aws-iam --service-account-id ${{ secrets.PHASE_SERVICE_ACCOUNT_ID }} --no-store

- name: Run tests with secrets
  run: phase run --env staging npm test

- name: Deploy with production secrets
  run: phase run --env production npm run deploy
```

### Multi-Environment Setup

```bash
# Development
phase run --env development npm run dev

# Staging
phase run --env staging npm run build && npm start

# Production
phase run --env production npm start
```

### Path-Based Secret Organization

```bash
# Fetch only API-related secrets
phase run --path /api node api-server.js

# Fetch only database secrets
phase run --path /database node db-migration.js

# Fetch all secrets from all paths
phase run --path "" node app.js
```

### Tag-Based Secret Filtering

```bash
# Only inject secrets tagged as "config" or "production"
phase run --tags prod,config npm start

# Tags are case-insensitive and support partial matching
phase run --tags database npm start
```

## Best Practices

### Security

1. **Never commit `.phase.json`** to version control if it contains sensitive IDs
2. **Use environment-specific commands** to avoid accidentally using wrong secrets
3. **Leverage service accounts** for CI/CD instead of user credentials
4. **Use paths and tags** to minimize secret exposure (principle of least privilege)
5. **Regularly rotate secrets**, especially for production environments

### Organization

1. **Use consistent naming**: `DATABASE_URL`, `API_KEY_STRIPE`, etc.
2. **Organize by path**: `/api`, `/database`, `/third-party`, etc.
3. **Tag appropriately**: `production`, `database`, `external-api`, etc.
4. **Document secret purposes** in Phase Console

### Development

1. **Import local .env files** when setting up Phase for existing projects
2. **Use `phase run`** instead of loading .env files directly
3. **Test with staging environment** before deploying to production
4. **Use `phase shell`** for debugging secret values

### CI/CD

1. **Use `--no-store` flag** to avoid persisting credentials
2. **Leverage cloud IAM** (AWS, GCP, Azure) for authentication
3. **Set appropriate TTLs** for service account tokens
4. **Use specific environments** in deployment pipelines

## Troubleshooting

### Authentication Issues

```bash
# Re-authenticate
phase auth

# Verify authentication status
phase users whoami
```

### Secret Not Found

```bash
# List all secrets to verify name and environment
phase secrets list --env <environment>

# Check if secret exists in different path
phase secrets list --env <environment> --path /
```

### Injection Not Working

```bash
# Test in interactive shell
phase shell --env <environment>
env | grep SECRET_NAME

# Verify .phase.json configuration
cat .phase.json

# Re-initialize if needed
phase init
```

### Dynamic Secrets Not Generating

```bash
# Ensure lease generation is enabled
phase run --generate-leases true <command>

# Set custom TTL
phase run --lease-ttl 7200 <command>
```

## Reference Documentation

For complete CLI command syntax and options, see `references/cli_reference.md`.

### Quick Lookup Patterns

To find specific command details in the reference:
- Authentication: search for `## Authentication`
- Run command options: search for `## Run Commands`
- Secret management: search for `## Secrets Management`
- Export formats: search for `### Export Secrets`
- Dynamic secrets: search for `## Dynamic Secrets`

## Integration Examples

### Node.js/TypeScript

```typescript
// No special code needed - secrets are environment variables
const dbUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_KEY;

// Run with: phase run --env development node app.js
```

### Next.js

```javascript
// next.config.js - secrets are automatically available
module.exports = {
  env: {
    // These will be injected by Phase
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};

// Run with: phase run --env production npm start
```

### Docker

```dockerfile
# Dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]

# Run with Phase:
# phase run --env production docker run my-app
```

### Python

```python
import os

# Secrets are available as environment variables
db_url = os.getenv('DATABASE_URL')
api_key = os.getenv('API_KEY')

# Run with: phase run --env development python app.py
```

## Additional Resources

- Documentation: https://docs.phase.dev/
- Open documentation: `phase docs`
- Open web console: `phase console`
- GitHub: https://github.com/phasehq/cli

## Notes for Claude

When helping users with Phase:

1. **Check for .phase.json** to determine if project is already initialized
2. **Ask about environment** before running commands (dev, staging, prod)
3. **Suggest path/tag filtering** when appropriate for security
4. **Recommend service accounts** for CI/CD setups
5. **Help debug** by checking Phase CLI output and suggesting verification steps
6. **Remind about security** best practices (don't commit secrets, use appropriate envs)
7. **Test commands** using the Phase CLI when needed to verify behavior

Always verify Phase CLI is available before suggesting commands, and adapt examples to the user's specific technology stack.
