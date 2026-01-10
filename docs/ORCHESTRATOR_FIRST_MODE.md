# Orchestrator-First Mode

Orchestrator-First Mode is a feature that enables the Master Control system to automatically monitor terminal sessions for stalls and provide AI-assisted intervention suggestions.

## Overview

When enabled, Master Control (the orchestrator system) will:
- Monitor all active terminal sessions for signs of stalling
- Detect when AI agents (Claude Code, Codex, Gemini, OpenCode) become unresponsive
- Generate insights about stalled sessions with suggested recovery actions
- Optionally auto-intervene to resume stalled sessions (when enabled)

## Feature Flag Configuration

### User-Level Setting

Users can enable/disable Orchestrator-First Mode globally in their settings:

1. Open Settings (gear icon in header)
2. Navigate to the "Master Control" section
3. Toggle "Orchestrator-First Mode" on/off

When enabled at the user level, all new sessions will be monitored by default.

### Folder-Level Override

Folders can override the user-level setting:

1. Right-click on a folder in the sidebar
2. Select "Preferences"
3. Find the "Orchestrator-First Mode" toggle
4. Enable/disable for that specific folder

Folder preferences cascade to child folders (unless they have their own override).

### Inheritance Chain

```
Default (OFF) → User Settings → Parent Folder → Child Folder
```

More specific settings override less specific ones:
- A folder with the flag enabled will have monitoring, even if user-level is disabled
- A folder with the flag disabled will not be monitored, even if user-level is enabled
- Child folders inherit from parents unless they have an explicit override

## API Configuration

### Environment Variables

The feature can be pre-configured via environment variable for initial deployments:

```bash
# In .env.local (optional, for initial setup)
ORCHESTRATOR_FIRST_MODE=false  # Default for new users
```

### API Keys Required

For orchestrator functionality, you need the appropriate AI provider API key:

```bash
# At least one is recommended for full functionality
ANTHROPIC_API_KEY=your-anthropic-api-key  # For Claude Code
OPENAI_API_KEY=your-openai-api-key        # For Codex/OpenCode
GOOGLE_API_KEY=your-google-api-key        # For Gemini CLI
```

## Migration from Pre-Feature-Flag Deployments

If you have existing orchestrators from before the feature flag was added:

### 1. Generate Report

First, see the current state of all orchestrators:

```bash
bun run db:migrate-orchestrators report
```

This shows:
- All orchestrators in the system
- Their current status (idle, analyzing, acting, paused)
- The effective feature flag state for each user/folder

### 2. Pause All (Safe Rollout)

For a safe rollout where the flag starts OFF:

```bash
bun run db:migrate-orchestrators pause
```

This pauses all orchestrators. They will not run until:
- User enables the feature flag in settings
- Server is restarted (monitoring service checks flag on startup)

### 3. Resume Enabled

After users have enabled the flag, resume their orchestrators:

```bash
bun run db:migrate-orchestrators resume
```

This only resumes orchestrators where the feature flag is enabled.

## Rollout Plan

### Phase 1: Deploy with Flag OFF (Default)

1. Deploy the new version with `orchestratorFirstMode` defaulting to `false`
2. Run `bun run db:migrate-orchestrators pause` to pause existing orchestrators
3. Existing users are unaffected (no monitoring by default)

### Phase 2: Internal Testing

1. Enable the flag for internal testing folders:
   - Open folder preferences
   - Toggle "Orchestrator-First Mode" ON
2. Verify monitoring works correctly
3. Test stall detection and insights

### Phase 3: Opt-In Rollout

1. Announce the feature to users
2. Users can enable in Settings → Master Control
3. Monitor adoption and gather feedback

### Phase 4: Full Rollout (Optional)

After validation, consider:
- Changing the default to `true` for new users
- Running `bun run db:migrate-orchestrators resume` to enable for all

## UI Components

### OrchestratorModeToggle

The toggle component is available for both user settings and folder preferences:

```tsx
import { OrchestratorModeToggle, OrchestratorModeCard } from "@/components/settings/OrchestratorModeToggle";

// In user settings
<OrchestratorModeToggle />

// In folder settings
<OrchestratorModeToggle folderId={folder.id} />

// With full card context
<OrchestratorModeCard folderId={folder.id} />
```

### Visual Indicators

When Orchestrator-First Mode is enabled:
- **Brain icon** in the header shows Master Control status
- **Bell notification** icon shows pending insights
- **Stalled session badge** appears on affected session tabs

## Technical Details

### Monitoring Service

The monitoring service (`src/services/monitoring-service.ts`) respects the feature flag:

```typescript
import { isOrchestratorModeEnabled } from "@/services/monitoring-service";

// Check if monitoring should run for a user/folder
const shouldMonitor = await isOrchestratorModeEnabled(userId, folderId);
```

### Database Schema

```sql
-- User-level setting (defaults to false)
ALTER TABLE user_settings ADD COLUMN orchestrator_first_mode INTEGER NOT NULL DEFAULT 0;

-- Folder-level override (null = inherit from user)
ALTER TABLE folder_preferences ADD COLUMN orchestrator_first_mode INTEGER;
```

### API Endpoints

```
PATCH /api/preferences
  Body: { "orchestratorFirstMode": true/false }

PUT /api/preferences/folders/:folderId
  Body: { "orchestratorFirstMode": true/false/null }
```

## Troubleshooting

### Orchestrator Not Starting

1. Check feature flag is enabled: Settings → Master Control
2. Verify API keys are configured in `.env.local`
3. Check server logs for initialization messages:
   ```
   [MonitoringService] Skipping <id> (orchestratorFirstMode disabled)
   ```

### Stall Detection Not Working

1. Ensure sessions have agent activity (agent hooks must be configured)
2. Check stall threshold (default: 5 minutes)
3. Verify terminal server is running with MCP enabled

### Migration Script Errors

If the migration script fails:
1. Check database connection in `.env.local`
2. Verify the `user_settings` table has `orchestrator_first_mode` column
3. Run `bun run db:push` to sync schema if needed
