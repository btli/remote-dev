# Phase CLI Complete Reference

Complete reference for all Phase CLI commands with full options and examples.

## Installation

```bash
curl -fsSL https://pkg.phase.dev/install.sh | bash
```

Verify installation:
```bash
phase --version
```

## Global Options

```
-h, --help     Show help message
-v, --version  Show version number
```

---

## Authentication (`phase auth`)

Authenticate with Phase.

### Options

| Option | Description |
|--------|-------------|
| `--mode {token,webauth,aws-iam}` | Mode of authentication. Default: `webauth` |
| `--service-account-id ID` | Service Account ID for external identity authentication |
| `--ttl SECONDS` | Token TTL in seconds for tokens created using external identities |
| `--no-store` | Print authentication token to stdout without storing credentials |

### Examples

```bash
# Interactive web authentication (default)
phase auth

# Token-based authentication
phase auth --mode token

# AWS IAM authentication
phase auth --mode aws-iam --service-account-id <service-account-id>

# AWS IAM without storing credentials (CI/CD)
phase auth --mode aws-iam --service-account-id <id> --no-store

# Set custom TTL for token
phase auth --mode aws-iam --service-account-id <id> --ttl 3600
```

---

## Project Initialization (`phase init`)

Link your project with a Phase app. Creates `.phase.json` in the project directory.

```bash
phase init
```

---

## Run Commands (`phase run`)

Execute commands with secrets injected as environment variables.

### Syntax

```bash
phase run [OPTIONS] <command_to_run>
```

### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name (e.g., dev, staging, production) |
| `--app APP` | App name (overrides `.phase.json`) |
| `--app-id APP_ID` | App ID (takes precedence over `--app`) |
| `--path PATH` | Path to fetch secrets from. Default: `/`. Use `""` for all paths |
| `--tags TAGS` | Comma-separated tags to filter secrets (case-insensitive, partial match) |
| `--generate-leases {true,false}` | Generate leases for dynamic secrets. Default: `true` |
| `--lease-ttl SECONDS` | TTL for generated leases |

### Examples

```bash
# Basic usage
phase run npm start

# Specify environment
phase run --env production npm start
phase run --env development node server.js

# Override app
phase run --app my-api npm start
phase run --app-id <uuid> python app.py

# Filter by path
phase run --path /api npm start
phase run --path /database node migrate.js
phase run --path "" npm start  # All paths

# Filter by tags
phase run --tags prod,database npm start
phase run --tags config,api node app.js

# Control dynamic secret leases
phase run --generate-leases false npm start
phase run --lease-ttl 3600 npm start
```

---

## Interactive Shell (`phase shell`)

Launch a sub-shell with secrets as environment variables. (BETA)

### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to fetch secrets from. Default: `/`. Use `""` for all paths |
| `--tags TAGS` | Comma-separated tags to filter secrets |
| `--shell SHELL` | Shell to use (bash, zsh, sh, fish, powershell). Default: current shell |
| `--generate-leases {true,false}` | Generate leases for dynamic secrets |
| `--lease-ttl SECONDS` | TTL for generated leases |

### Examples

```bash
# Start shell with secrets
phase shell

# Specific environment
phase shell --env staging

# Use specific shell
phase shell --shell zsh
phase shell --shell fish

# Filter secrets
phase shell --path /api --tags prod
```

---

## Secrets Management (`phase secrets`)

### List Secrets (`phase secrets list`)

View all secrets in an environment.

#### Options

| Option | Description |
|--------|-------------|
| `--show` | Show secrets uncensored |
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to list secrets from |
| `--tags TAGS` | Filter by tags |

#### Output Icons

| Icon | Meaning |
|------|---------|
| 🔗 | Secret references another secret in same environment |
| ⛓️ | Cross-environment reference |
| 🏷️ | Tag associated with secret |
| 💬 | Comment associated with secret |
| 🔏 | Personal secret (visible only to you) |
| ⚡️ | Dynamic secret |

#### Examples

```bash
phase secrets list
phase secrets list --env production
phase secrets list --show  # Uncensored values
phase secrets list --path /api --tags database
```

### Get Secret (`phase secrets get`)

Fetch details about a specific secret in JSON format.

#### Syntax

```bash
phase secrets get <key> [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to fetch from. Default: `/`. Use `""` for all paths |
| `--tags TAGS` | Filter by tags |
| `--generate-leases {true,false}` | Generate leases for dynamic secrets |
| `--lease-ttl SECONDS` | TTL for leases |

#### Examples

```bash
phase secrets get DATABASE_URL
phase secrets get API_KEY --env production
phase secrets get REDIS_URL --path /cache
```

### Create Secret (`phase secrets create`)

Create a new secret. Value can be provided via stdin or generated randomly.

#### Syntax

```bash
phase secrets create <key> [OPTIONS]
# Or pipe value:
echo "value" | phase secrets create <key> [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to create secret in. Default: `/` |
| `--random {hex,alphanumeric,base64,base64url,key128,key256}` | Generate random value |
| `--length LENGTH` | Length of random value. Default: 32 |
| `--override` | Create as personal override secret |

#### Examples

```bash
# Interactive creation
phase secrets create

# Pipe value from stdin
echo "my-secret-value" | phase secrets create MY_SECRET --env development

# Pipe file content
cat ~/.ssh/id_rsa | phase secrets create SSH_PRIVATE_KEY --env production

# Generate random value
phase secrets create API_KEY --random hex --length 32
phase secrets create JWT_SECRET --random base64 --length 64
phase secrets create ENCRYPTION_KEY --random key256

# Create in specific path
echo "value" | phase secrets create DB_PASSWORD --path /database --env production
```

### Update Secret (`phase secrets update`)

Update an existing secret.

#### Syntax

```bash
phase secrets update <key> [OPTIONS]
# Or pipe new value:
echo "new-value" | phase secrets update <key> [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Current path of secret. Default: `/` |
| `--updated-path NEW_PATH` | Move secret to new path |
| `--random {hex,alphanumeric,base64,base64url,key128,key256}` | Generate random value |
| `--length LENGTH` | Length of random value |
| `--override` | Update personal override value |
| `--toggle-override` | Toggle override state |

#### Examples

```bash
# Interactive update
phase secrets update

# Update with new value
echo "new-password" | phase secrets update DB_PASSWORD --env production

# Update with new file content
cat ~/.ssh/id_ed25519 | phase secrets update SSH_PRIVATE_KEY

# Rotate with random value
phase secrets update API_KEY --random hex --length 32 --env production

# Move to different path
phase secrets update OLD_SECRET --path /old --updated-path /new/location
```

### Delete Secret (`phase secrets delete`)

Delete one or more secrets.

#### Syntax

```bash
phase secrets delete <key> [key2 ...] [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to delete from. Default: `/` |

#### Examples

```bash
phase secrets delete OLD_API_KEY --env development
phase secrets delete KEY1 KEY2 KEY3 --env staging
phase secrets delete DB_PASSWORD --path /database --env production
```

### Import Secrets (`phase secrets import`)

Import secrets from a `.env` file.

#### Syntax

```bash
phase secrets import <env_file> [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to import to. Default: `/` |

#### Examples

```bash
phase secrets import .env --env development
phase secrets import .env.production --env production
phase secrets import secrets.env --env staging --path /api
```

### Export Secrets (`phase secrets export`)

Export secrets in various formats.

#### Syntax

```bash
phase secrets export [keys...] [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to export from. Default: `/`. Use `""` for all |
| `--format FORMAT` | Output format (see below) |
| `--tags TAGS` | Filter by tags |
| `--generate-leases {true,false}` | Generate leases for dynamic secrets |
| `--lease-ttl SECONDS` | TTL for leases |

#### Supported Formats

- `dotenv` (default)
- `json`
- `csv`
- `yaml`
- `xml`
- `toml`
- `hcl`
- `ini`
- `java_properties`
- `kv`

#### Examples

```bash
# Export all secrets (dotenv format)
phase secrets export --env production

# Export specific keys
phase secrets export DATABASE_URL API_KEY --env production

# Different formats
phase secrets export --env staging --format json
phase secrets export --env production --format yaml
phase secrets export --env development --format toml

# Save to file
phase secrets export --env production > .env.production
phase secrets export --env staging --format json > secrets.json

# Export from specific path
phase secrets export --path /api --env production
phase secrets export --path "" --env production  # All paths

# Filter by tags
phase secrets export --tags database,prod --env production
```

---

## Dynamic Secrets (`phase dynamic-secrets`)

Manage dynamically generated secrets (database credentials, API keys, etc.).

### List Dynamic Secrets

```bash
phase dynamic-secrets list [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--env ENV` | Environment name |
| `--app APP` | App name |
| `--app-id APP_ID` | App ID |
| `--path PATH` | Path to filter |

### Manage Leases (`phase dynamic-secrets lease`)

```bash
phase dynamic-secrets lease get <secret_key>     # Get leases
phase dynamic-secrets lease renew <lease_id>     # Renew a lease
phase dynamic-secrets lease revoke <lease_id>    # Revoke a lease
phase dynamic-secrets lease generate <secret_key> # Generate new lease
```

---

## User Management (`phase users`)

### Commands

```bash
phase users whoami    # See current user details
phase users switch    # Switch between users, orgs, hosts
phase users logout    # Logout from phase-cli
phase users keyring   # Display Phase keyring information
```

---

## Utilities

```bash
phase docs      # Open Phase CLI documentation in browser
phase console   # Open Phase Console web UI in browser
phase update    # Update to latest CLI version
```

---

## Environment Variables

Phase CLI respects these environment variables:

| Variable | Description |
|----------|-------------|
| `PHASE_HOST` | Custom Phase server host |
| `PHASE_SERVICE_TOKEN` | Service token for authentication |

---

## Configuration Files

### `.phase.json`

Created by `phase init`, links project to Phase app:

```json
{
  "version": "2",
  "default_app": "<app-id>"
}
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error occurred |

Check stderr for error messages.

---

## Common Error Solutions

| Error | Solution |
|-------|----------|
| Not authenticated | Run `phase auth` |
| No .phase.json found | Run `phase init` |
| Secret not found | Check with `phase secrets list --env <env>` |
| Environment not found | Verify in Phase Console |
| Permission denied | Check app permissions in Console |

---

## CI/CD Integration Patterns

### GitHub Actions

```yaml
- name: Install Phase CLI
  run: curl -fsSL https://pkg.phase.dev/install.sh | bash

- name: Authenticate
  run: phase auth --mode aws-iam --service-account-id ${{ secrets.PHASE_SERVICE_ACCOUNT_ID }} --no-store

- name: Run with secrets
  run: phase run --env production npm run deploy
```

### GitLab CI

```yaml
deploy:
  script:
    - curl -fsSL https://pkg.phase.dev/install.sh | bash
    - phase auth --mode token
    - phase run --env production ./deploy.sh
```

### Docker

```dockerfile
# Install Phase CLI
RUN curl -fsSL https://pkg.phase.dev/install.sh | bash

# Or use with docker run:
# phase run --env production docker run my-app
```

---

## Additional Resources

- Documentation: https://docs.phase.dev/
- GitHub: https://github.com/phasehq/cli
- Console: `phase console`
- CLI Docs: `phase docs`
