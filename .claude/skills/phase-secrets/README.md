# Phase Secrets Management Skill

A comprehensive skill for working with Phase - an open source, end-to-end encrypted platform for managing secrets and environment variables.

## Overview

This skill provides guidance and tools for:
- Setting up Phase in projects
- Managing secrets across environments
- Injecting secrets into applications
- Importing/exporting secrets
- CI/CD integration patterns
- Security best practices

## When to Use

Use this skill when:
- A project uses Phase as its secrets manager
- Setting up secrets management in a new project
- Migrating from .env files to Phase
- Implementing secure secret injection
- Working with dynamic secrets
- Debugging secret-related issues

## Quick Start

```bash
# Authenticate with Phase
phase auth

# Initialize Phase in your project
phase init

# Import existing secrets
phase secrets import .env --env development

# Run your app with secrets
phase run --env development npm start

# Test in interactive shell
phase shell --env development
```

## File Structure

```
phase-secrets/
├── README.md                         # This file
├── SKILL.md                          # Comprehensive usage guide
├── scripts/
│   ├── setup-phase-project.sh       # Initialize Phase in a project
│   ├── import-env-file.sh           # Import secrets from .env files
│   ├── export-secrets.sh            # Export secrets to various formats
│   └── rotate-secrets.js            # Rotate secrets for security
└── references/
    └── cli-quick-reference.md       # Quick CLI command reference
```

## Documentation

### Main Skill Guide
See [SKILL.md](./SKILL.md) for comprehensive documentation including:
- Core concepts and terminology
- Complete CLI command reference
- Integration patterns for different frameworks
- CI/CD setup examples
- Security best practices
- Troubleshooting guide

### Quick Reference
See [cli-quick-reference.md](./references/cli-quick-reference.md) for a quick CLI command cheat sheet.

## Example Scripts

### Setup Phase in Project
```bash
./scripts/setup-phase-project.sh
```
Interactive script to initialize Phase in your project and optionally import existing .env files.

### Import Secrets
```bash
./scripts/import-env-file.sh
```
Import secrets from multiple .env files into different Phase environments.

### Export Secrets
```bash
./scripts/export-secrets.sh
```
Export secrets from Phase in .env, JSON, or YAML format.

### Rotate Secrets
```bash
./scripts/rotate-secrets.js --env production --secrets API_KEY,JWT_SECRET
```
Rotate secrets for security compliance and best practices.

## Common Use Cases

### Development Workflow

```bash
# Run dev server with Phase
phase run --env development npm run dev

# Debug secrets
phase shell --env development
env | grep DATABASE
```

### Staging/Production

```bash
# Deploy with staging secrets
phase run --env staging npm run deploy:staging

# Run production app
phase run --env production npm start
```

### CI/CD Integration

```bash
# Authenticate in CI
phase auth --mode aws-iam --service-account-id $ID --no-store

# Run tests with secrets
phase run --env staging npm test

# Deploy with production secrets
phase run --env production npm run deploy
```

## Integration Examples

### Node.js
```javascript
// Secrets are injected as environment variables
const dbUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_KEY;
```

### Next.js
```javascript
// next.config.js
module.exports = {
  env: {
    API_URL: process.env.API_URL,
  },
};
```

### Docker
```bash
# Run container with Phase-injected secrets
phase run --env production docker run my-app
```

## Key Features

### Secret Management
- Create, read, update, delete secrets
- Import from .env files
- Export to multiple formats
- Path-based organization
- Tag-based filtering

### Environment Support
- Multiple environments (dev, staging, prod)
- Environment-specific secrets
- Easy environment switching

### Security
- End-to-end encryption
- Service account authentication
- AWS IAM integration
- No plain-text storage

### Developer Experience
- Interactive CLI
- Shell integration
- Seamless injection
- Framework agnostic

## Best Practices

1. **Never commit secrets** - Use Phase instead of .env files
2. **Use appropriate environments** - Don't accidentally use prod secrets in dev
3. **Leverage paths and tags** - Minimize secret exposure
4. **Service accounts for CI/CD** - Don't use personal credentials
5. **Regular rotation** - Rotate sensitive secrets periodically

## Resources

- Phase Documentation: https://docs.phase.dev/
- Phase CLI: `phase --help`
- Open Console: `phase console`
- Open Docs: `phase docs`
- GitHub: https://github.com/phasehq/cli

## Requirements

- Phase CLI installed on system
- Phase account and organization
- Authenticated user or service account

## Support

For issues or questions:
1. Check the [troubleshooting section](./SKILL.md#troubleshooting) in SKILL.md
2. Run `phase docs` to open documentation
3. Visit https://docs.phase.dev/
4. Check Phase GitHub for CLI issues

## License

This skill documentation is provided as-is for use with Claude Code.
Phase CLI is open source - see https://github.com/phasehq/cli for details.
