# Environment Variables Feature Design

## Executive Summary

This document describes the comprehensive design for adding environment variable management to folder preferences with hierarchical inheritance, port conflict detection, and worktree `.env` file propagation.

## Table of Contents

1. [Requirements](#1-requirements)
2. [Data Model](#2-data-model)
3. [Inheritance Semantics](#3-inheritance-semantics)
4. [Port Conflict Detection](#4-port-conflict-detection)
5. [Worktree .env Propagation](#5-worktree-env-propagation)
6. [API Design](#6-api-design)
7. [UI/UX Design](#7-uiux-design)
8. [Terminal Integration](#8-terminal-integration)
9. [Testing Strategy](#9-testing-strategy)
10. [Edge Cases](#10-edge-cases)
11. [Implementation Plan](#11-implementation-plan)
12. [File Manifest](#12-file-manifest)

---

## 1. Requirements

### 1.1 Core Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | Store environment variables as key-value pairs per folder | Must |
| R2 | Environment variables inherit through folder hierarchy | Must |
| R3 | Child folders can override specific inherited env vars | Must |
| R4 | Child folders can disable/remove inherited env vars | Must |
| R5 | UI shows inherited values with source indicators | Must |
| R6 | Port registry tracks which ports are claimed by folders | Must |
| R7 | Warn when port conflicts detected (non-blocking) | Must |
| R8 | Suggest alternative ports when conflicts detected | Should |
| R9 | Copy .env files to worktrees on creation | Must |
| R10 | Environment variables injected into terminal sessions | Must |

### 1.2 User Decisions

| Decision | Choice |
|----------|--------|
| Storage method | Key-value pairs in UI (not .env file references) |
| Port conflict detection | Port registry in database |
| Conflict handling | Warning with suggestion (non-blocking) |
| Worktree .env handling | Copy .env to worktree |
| Architecture approach | Minimal changes (extend existing preferences) |

---

## 2. Data Model

### 2.1 Database Schema Changes

#### 2.1.1 Modify `folder_preferences` Table

Add `environment_vars` column to store environment variables as JSON:

```sql
-- Add to folder_preferences table
environment_vars TEXT  -- JSON: { "PORT": "3000", "API_URL": "..." }
```

**Schema Definition:**
```typescript
// In src/db/schema.ts, add to folderPreferences table:
environmentVars: text("environment_vars"), // JSON blob
```

#### 2.1.2 New `port_registry` Table

Track port allocations for conflict detection:

```typescript
export const portRegistry = sqliteTable(
  "port_registry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    folderId: text("folder_id")
      .notNull()
      .references(() => sessionFolders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    variableName: text("variable_name").notNull(), // e.g., "PORT", "DB_PORT"
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("port_registry_user_idx").on(table.userId),
    index("port_registry_folder_idx").on(table.folderId),
    // Composite index for fast conflict detection
    index("port_registry_user_port_idx").on(table.userId, table.port),
  ]
);
```

### 2.2 Type Definitions

#### 2.2.1 Environment Variable Types

```typescript
// src/types/environment.ts

/**
 * Sentinel value to indicate an inherited env var should be disabled/removed.
 * When a child folder sets a variable to this value, it's excluded from the
 * resolved environment.
 */
export const ENV_VAR_DISABLED = "__DISABLED__";

/**
 * Environment variable value - either a string value or disabled sentinel
 */
export type EnvVarValue = string;

/**
 * Raw environment variables as stored in database
 * Values can be:
 * - Regular string: the actual value
 * - "__DISABLED__": explicitly disable this inherited variable
 */
export type EnvironmentVariables = Record<string, EnvVarValue>;

/**
 * Resolved environment variable with source tracking
 */
export interface ResolvedEnvVar {
  key: string;
  value: string;
  source: EnvVarSource;
  isDisabled: boolean;
  isOverridden: boolean;
}

/**
 * Source of an environment variable
 */
export type EnvVarSource =
  | { type: "user" }
  | { type: "folder"; folderId: string; folderName: string };

/**
 * Fully resolved environment for a folder
 */
export interface ResolvedEnvironment {
  /** Final merged environment (excludes disabled vars) */
  variables: Record<string, string>;

  /** All variables with source tracking (includes disabled for UI display) */
  details: ResolvedEnvVar[];

  /** Variables that are disabled in this folder */
  disabledKeys: string[];
}

/**
 * Port conflict information
 */
export interface PortConflict {
  port: number;
  variableName: string;
  conflictingFolder: {
    id: string;
    name: string;
  };
  conflictingVariableName: string;
  suggestedPort: number | null;
}

/**
 * Port validation result
 */
export interface PortValidationResult {
  conflicts: PortConflict[];
  hasConflicts: boolean;
}

/**
 * Port registry entry
 */
export interface PortRegistryEntry {
  id: string;
  folderId: string;
  userId: string;
  port: number;
  variableName: string;
  createdAt: Date;
}
```

#### 2.2.2 Update Preferences Types

```typescript
// In src/types/preferences.ts

// Update Preferences interface
export interface Preferences {
  defaultWorkingDirectory: string;
  defaultShell: string;
  theme: string;
  fontSize: number;
  fontFamily: string;
  startupCommand: string;
  environmentVars: EnvironmentVariables; // NEW
}

// Update ExtendedPreferences (inherits environmentVars from Preferences)

// Update FolderPreferences interface
export interface FolderPreferences {
  // ... existing fields ...
  environmentVars: EnvironmentVariables | null; // NEW
  // ... timestamps ...
}

// Update UpdateFolderPreferencesInput
export interface UpdateFolderPreferencesInput {
  // ... existing fields ...
  environmentVars?: EnvironmentVariables | null; // NEW
}
```

---

## 3. Inheritance Semantics

### 3.1 Inheritance Model

Environment variables follow the same inheritance chain as other preferences:

```
Default (empty) → User Settings → Grandparent Folder → Parent Folder → Child Folder
```

**Key Rules:**
1. **Merge**: Variables from each level are merged with more specific levels overriding less specific
2. **Override**: A child can override a parent's variable by setting the same key
3. **Disable**: A child can remove an inherited variable by setting it to `"__DISABLED__"`

### 3.2 Resolution Algorithm

```typescript
/**
 * Resolve environment variables with inheritance
 *
 * @param userSettings - User-level environment vars (optional)
 * @param folderPrefsChain - Ordered array from ancestor to target folder
 * @returns Resolved environment with source tracking
 */
function resolveEnvironmentVariables(
  userEnvVars: EnvironmentVariables | null,
  folderPrefsChain: FolderPreferencesWithMeta[]
): ResolvedEnvironment {
  const details: ResolvedEnvVar[] = [];
  const mergedVars: Record<string, { value: string; source: EnvVarSource }> = {};
  const disabledKeys = new Set<string>();

  // Layer 1: User settings
  if (userEnvVars) {
    for (const [key, value] of Object.entries(userEnvVars)) {
      if (value === ENV_VAR_DISABLED) {
        disabledKeys.add(key);
      } else {
        mergedVars[key] = { value, source: { type: "user" } };
      }
    }
  }

  // Layer 2+: Folder chain (ancestor → target)
  for (const folderPrefs of folderPrefsChain) {
    if (!folderPrefs.environmentVars) continue;

    const folderSource: EnvVarSource = {
      type: "folder",
      folderId: folderPrefs.folderId,
      folderName: folderPrefs.folderName,
    };

    for (const [key, value] of Object.entries(folderPrefs.environmentVars)) {
      if (value === ENV_VAR_DISABLED) {
        // Child explicitly disables this variable
        disabledKeys.add(key);
        delete mergedVars[key]; // Remove from merged
      } else {
        // Child sets or overrides the variable
        disabledKeys.delete(key); // Re-enable if previously disabled
        const wasOverridden = key in mergedVars;
        mergedVars[key] = { value, source: folderSource };
      }
    }
  }

  // Build final variables (excluding disabled)
  const variables: Record<string, string> = {};
  for (const [key, { value }] of Object.entries(mergedVars)) {
    if (!disabledKeys.has(key)) {
      variables[key] = value;
    }
  }

  // Build details array for UI
  // ... (includes disabled vars with isDisabled: true)

  return {
    variables,
    details,
    disabledKeys: Array.from(disabledKeys),
  };
}
```

### 3.3 Inheritance Examples

#### Example 1: Basic Override

```
User Settings: { PORT: "3000" }
Parent Folder: { API_URL: "https://api.dev" }
Child Folder:  { PORT: "3001" }

Resolved for Child: { PORT: "3001", API_URL: "https://api.dev" }
  - PORT=3001 (from Child, overrides User)
  - API_URL=https://api.dev (inherited from Parent)
```

#### Example 2: Disable Inherited Variable

```
Parent Folder: { PORT: "3000", API_URL: "https://api.dev", DEBUG: "true" }
Child Folder:  { DEBUG: "__DISABLED__" }

Resolved for Child: { PORT: "3000", API_URL: "https://api.dev" }
  - PORT=3000 (inherited from Parent)
  - API_URL=https://api.dev (inherited from Parent)
  - DEBUG is DISABLED (explicitly removed by Child)
```

#### Example 3: Re-enable Previously Disabled Variable

```
Grandparent: { FEATURE_FLAG: "true" }
Parent:      { FEATURE_FLAG: "__DISABLED__" }
Child:       { FEATURE_FLAG: "false" }

Resolved for Parent: { } (FEATURE_FLAG disabled)
Resolved for Child:  { FEATURE_FLAG: "false" } (re-enabled with new value)
```

#### Example 4: Deep Hierarchy

```
User:        { BASE_URL: "http://localhost" }
Project:     { PORT: "3000", ENV: "development" }
  └─ API:    { PORT: "3001", API_PREFIX: "/api" }
    └─ v2:   { PORT: "__DISABLED__", API_PREFIX: "/api/v2" }

Resolved for v2: {
  BASE_URL: "http://localhost",  // from User
  ENV: "development",            // from Project
  API_PREFIX: "/api/v2"          // from v2 (overrides API)
  // PORT is DISABLED
}
```

---

## 4. Port Conflict Detection

### 4.1 Port Detection Algorithm

```typescript
/**
 * Extract port variables from environment
 * Detects variables that look like port numbers (1024-65535)
 */
function extractPortVariables(envVars: EnvironmentVariables): Array<{
  variableName: string;
  port: number;
}> {
  const ports: Array<{ variableName: string; port: number }> = [];
  const portPattern = /^\d{2,5}$/;

  for (const [key, value] of Object.entries(envVars)) {
    // Skip disabled variables
    if (value === ENV_VAR_DISABLED) continue;

    const trimmedValue = value.trim();
    if (portPattern.test(trimmedValue)) {
      const port = parseInt(trimmedValue, 10);
      // Valid user port range
      if (port >= 1024 && port <= 65535) {
        ports.push({ variableName: key, port });
      }
    }
  }

  return ports;
}
```

### 4.2 Port Registry Sync

```typescript
/**
 * Sync port registry when folder environment is updated
 */
async function syncPortRegistry(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<void> {
  // Delete existing ports for this folder
  await db
    .delete(portRegistry)
    .where(and(
      eq(portRegistry.folderId, folderId),
      eq(portRegistry.userId, userId)
    ));

  if (!envVars) return;

  // Extract and insert new ports
  const ports = extractPortVariables(envVars);
  if (ports.length === 0) return;

  await db.insert(portRegistry).values(
    ports.map(({ variableName, port }) => ({
      folderId,
      userId,
      port,
      variableName,
    }))
  );
}
```

### 4.3 Conflict Detection

```typescript
/**
 * Validate ports and detect conflicts
 */
async function validatePorts(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<PortValidationResult> {
  if (!envVars) {
    return { conflicts: [], hasConflicts: false };
  }

  const ports = extractPortVariables(envVars);
  if (ports.length === 0) {
    return { conflicts: [], hasConflicts: false };
  }

  const conflicts: PortConflict[] = [];

  for (const { variableName, port } of ports) {
    // Find existing allocations for this port (excluding current folder)
    const existing = await db.query.portRegistry.findFirst({
      where: and(
        eq(portRegistry.userId, userId),
        eq(portRegistry.port, port),
        ne(portRegistry.folderId, folderId)
      ),
    });

    if (existing) {
      // Get folder name for display
      const folder = await db.query.sessionFolders.findFirst({
        where: eq(sessionFolders.id, existing.folderId),
        columns: { id: true, name: true },
      });

      if (folder) {
        const suggested = await suggestAlternativePort(userId, port);
        conflicts.push({
          port,
          variableName,
          conflictingFolder: { id: folder.id, name: folder.name },
          conflictingVariableName: existing.variableName,
          suggestedPort: suggested,
        });
      }
    }
  }

  return {
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

/**
 * Suggest an alternative port near the requested port
 */
async function suggestAlternativePort(
  userId: string,
  preferredPort: number
): Promise<number | null> {
  const allocations = await db.query.portRegistry.findMany({
    where: eq(portRegistry.userId, userId),
    columns: { port: true },
  });

  const usedPorts = new Set(allocations.map(a => a.port));
  const reserved = new Set([3000, 3001, 5432, 5672, 6379, 8080, 8443, 9200]);

  // Try ports near the preferred port
  for (let offset = 1; offset <= 100; offset++) {
    const candidate = preferredPort + offset;
    if (
      candidate >= 1024 &&
      candidate <= 65535 &&
      !usedPorts.has(candidate) &&
      !reserved.has(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}
```

---

## 5. Worktree .env Propagation

### 5.1 Copy Logic

When a worktree is created, copy the parent repository's `.env` file to the worktree:

```typescript
/**
 * Copy .env file from source repo to worktree
 * Non-blocking - logs warning if file doesn't exist
 */
async function copyEnvFile(
  sourceRepoPath: string,
  worktreePath: string
): Promise<boolean> {
  const { copyFile, access, constants } = await import("fs/promises");
  const { join } = await import("path");

  const sourceEnv = join(sourceRepoPath, ".env");
  const targetEnv = join(worktreePath, ".env");

  try {
    await access(sourceEnv, constants.R_OK);
    await copyFile(sourceEnv, targetEnv);
    console.log(`Copied .env from ${sourceRepoPath} to ${worktreePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`No .env file in ${sourceRepoPath}, skipping copy`);
    } else {
      console.warn(`Failed to copy .env: ${error}`);
    }
    return false;
  }
}
```

### 5.2 Integration with WorktreeService

Modify `createBranchWithWorktree` and `createWorktree` to call `copyEnvFile`:

```typescript
// After worktree creation succeeds:
try {
  await copyEnvFile(repoPath, worktreePath);
} catch {
  // Non-blocking - don't fail worktree creation
}
```

### 5.3 Files to Copy

Copy these files if they exist:
- `.env`
- `.env.local`
- `.env.development`
- `.env.development.local`

Do NOT copy:
- `.env.production` (security risk)
- `.env.production.local` (security risk)
- `.env.test` (test-specific)

---

## 6. API Design

### 6.1 Existing Endpoints (Modified)

#### PUT `/api/preferences/folders/:folderId`

Add `environmentVars` to allowed fields:

```typescript
const allowedFields = [
  // ... existing fields ...
  "environmentVars",
];
```

Response includes port validation:

```json
{
  "id": "...",
  "folderId": "...",
  "environmentVars": { "PORT": "3000" },
  "portValidation": {
    "conflicts": [
      {
        "port": 3000,
        "variableName": "PORT",
        "conflictingFolder": { "id": "...", "name": "Other Project" },
        "conflictingVariableName": "DEV_PORT",
        "suggestedPort": 3001
      }
    ],
    "hasConflicts": true
  }
}
```

### 6.2 New Endpoints

#### POST `/api/preferences/folders/:folderId/validate-ports`

Validate ports without saving (for real-time feedback):

**Request:**
```json
{
  "environmentVars": { "PORT": "3000", "DB_PORT": "5432" }
}
```

**Response:**
```json
{
  "conflicts": [...],
  "hasConflicts": true
}
```

#### GET `/api/preferences/folders/:folderId/environment`

Get resolved environment for a folder:

**Response:**
```json
{
  "variables": { "PORT": "3001", "API_URL": "..." },
  "details": [
    {
      "key": "PORT",
      "value": "3001",
      "source": { "type": "folder", "folderId": "...", "folderName": "API" },
      "isDisabled": false,
      "isOverridden": true
    },
    {
      "key": "DEBUG",
      "value": "true",
      "source": { "type": "folder", "folderId": "...", "folderName": "Parent" },
      "isDisabled": true,
      "isOverridden": false
    }
  ],
  "disabledKeys": ["DEBUG"]
}
```

---

## 7. UI/UX Design

### 7.1 FolderPreferencesModal Updates

Add an "Environment" section to the modal:

```
┌──────────────────────────────────────────────────────────────┐
│ [Folder Icon] Project A Preferences                          │
│ Override settings for sessions in this folder.               │
│ Leave empty to inherit from parent folder.                   │
├──────────────────────────────────────────────────────────────┤
│ Working Directory: [________________________]                 │
│ Shell: [Bash ▼]                                              │
│ Startup Command: [________________________]                   │
│ ...                                                          │
├──────────────────────────────────────────────────────────────┤
│ ┌─ Environment Variables ───────────────────────────────────┐│
│ │                                                           ││
│ │ ⚠️ Port Conflict: PORT 3000 is used by "Other Project"    ││
│ │    [Use 3001 instead]                                     ││
│ │                                                           ││
│ │ ┌────────────────┬────────────────────┬───────┐          ││
│ │ │ Variable       │ Value              │       │          ││
│ │ ├────────────────┼────────────────────┼───────┤          ││
│ │ │ PORT           │ 3000               │ [🗑]  │          ││
│ │ │ (Overrides User)                             │          ││
│ │ ├────────────────┼────────────────────┼───────┤          ││
│ │ │ API_URL        │ https://api.dev    │ [↩]  │          ││
│ │ │ 🔗 Inherited from: Parent Folder             │          ││
│ │ ├────────────────┼────────────────────┼───────┤          ││
│ │ │ DEBUG          │ [DISABLED]         │ [↩]  │          ││
│ │ │ 🚫 Disabled (was: "true" from Parent)        │          ││
│ │ └────────────────┴────────────────────┴───────┘          ││
│ │                                                           ││
│ │ [+ Add Variable]                                          ││
│ │                                                           ││
│ └───────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│ [Reset to Defaults]                    [Cancel] [Save]       │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 UI Components

#### 7.2.1 EnvVarRow Component

```typescript
interface EnvVarRowProps {
  varKey: string;
  value: string;
  source: EnvVarSource | null; // null = set in this folder
  isInherited: boolean;
  isDisabled: boolean;
  inheritedValue?: string; // Original value if overridden
  onChange: (key: string, value: string) => void;
  onDisable: (key: string) => void;
  onReset: (key: string) => void; // Remove override, revert to inherited
  onDelete: (key: string) => void;
}
```

States:
- **Set locally**: Editable input, delete button
- **Inherited**: Read-only with source badge, option to override or disable
- **Overridden**: Editable input, reset button to revert to inherited
- **Disabled**: Grayed out, reset button to re-enable

#### 7.2.2 PortConflictBanner Component

```typescript
interface PortConflictBannerProps {
  conflicts: PortConflict[];
  onUseSuggestion: (varName: string, suggestedPort: number) => void;
  onDismiss: () => void;
}
```

### 7.3 Interaction Flows

#### Adding a New Variable

1. Click "+ Add Variable"
2. Enter key name (validated: uppercase alphanumeric + underscore)
3. Enter value
4. If value looks like a port, check for conflicts
5. Save → sync to database and port registry

#### Overriding an Inherited Variable

1. Click on inherited variable row
2. Edit value → marks as "overridden"
3. Save → stores override in this folder's preferences

#### Disabling an Inherited Variable

1. Click disable button (🚫) on inherited variable
2. Variable shown as disabled with strikethrough
3. Save → stores `"__DISABLED__"` for this key

#### Re-enabling a Disabled Variable

1. Click reset button (↩) on disabled variable
2. If parent had a value, reverts to inherited
3. If was set in this folder, removes the disable

---

## 8. Terminal Integration

### 8.1 Environment Injection

Modify `src/server/terminal.ts` to inject environment variables:

```typescript
// In attachToTmuxSession function
function attachToTmuxSession(
  sessionName: string,
  cols: number,
  rows: number,
  customEnv?: Record<string, string>
): IPty {
  // Merge custom env with system env
  const mergedEnv = customEnv
    ? { ...process.env, ...customEnv }
    : process.env;

  const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", sessionName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: mergedEnv as Record<string, string>,
  });

  return ptyProcess;
}
```

### 8.2 Session Creation Flow

1. Client creates session with `folderId`
2. `SessionService.createSession()` resolves preferences including env vars
3. Resolved env vars stored with session or passed to terminal server
4. Terminal server receives env vars via WebSocket query or token
5. PTY spawned with merged environment

### 8.3 WebSocket Query Parameter

Add `environmentVars` to WebSocket connection:

```typescript
// In Terminal.tsx
const params = new URLSearchParams({
  token,
  sessionId,
  tmuxSession: tmuxSessionName,
  cols: String(cols),
  rows: String(rows),
});

if (environmentVars && Object.keys(environmentVars).length > 0) {
  params.set("environmentVars", JSON.stringify(environmentVars));
}

const ws = new WebSocket(`ws://localhost:${terminalPort}?${params}`);
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

#### 9.1.1 Environment Resolution Tests

```typescript
describe("resolveEnvironmentVariables", () => {
  it("should merge variables from user and folders", () => {
    const userEnvVars = { BASE_URL: "http://localhost" };
    const folderChain = [
      { folderId: "1", folderName: "Project", environmentVars: { PORT: "3000" } },
    ];

    const result = resolveEnvironmentVariables(userEnvVars, folderChain);

    expect(result.variables).toEqual({
      BASE_URL: "http://localhost",
      PORT: "3000",
    });
  });

  it("should allow child to override parent variable", () => {
    const folderChain = [
      { folderId: "1", folderName: "Parent", environmentVars: { PORT: "3000" } },
      { folderId: "2", folderName: "Child", environmentVars: { PORT: "3001" } },
    ];

    const result = resolveEnvironmentVariables(null, folderChain);

    expect(result.variables.PORT).toBe("3001");
    expect(result.details.find(d => d.key === "PORT")?.isOverridden).toBe(true);
  });

  it("should handle disabled variables", () => {
    const folderChain = [
      { folderId: "1", folderName: "Parent", environmentVars: { DEBUG: "true" } },
      { folderId: "2", folderName: "Child", environmentVars: { DEBUG: "__DISABLED__" } },
    ];

    const result = resolveEnvironmentVariables(null, folderChain);

    expect(result.variables.DEBUG).toBeUndefined();
    expect(result.disabledKeys).toContain("DEBUG");
  });

  it("should allow re-enabling a disabled variable", () => {
    const folderChain = [
      { folderId: "1", folderName: "Grandparent", environmentVars: { FLAG: "true" } },
      { folderId: "2", folderName: "Parent", environmentVars: { FLAG: "__DISABLED__" } },
      { folderId: "3", folderName: "Child", environmentVars: { FLAG: "false" } },
    ];

    const result = resolveEnvironmentVariables(null, folderChain);

    expect(result.variables.FLAG).toBe("false");
    expect(result.disabledKeys).not.toContain("FLAG");
  });

  it("should handle empty environments", () => {
    const result = resolveEnvironmentVariables(null, []);

    expect(result.variables).toEqual({});
    expect(result.details).toEqual([]);
  });
});
```

#### 9.1.2 Port Extraction Tests

```typescript
describe("extractPortVariables", () => {
  it("should extract variables with port-like values", () => {
    const envVars = {
      PORT: "3000",
      DB_PORT: "5432",
      API_URL: "https://api.dev",
      DEBUG: "true",
    };

    const ports = extractPortVariables(envVars);

    expect(ports).toHaveLength(2);
    expect(ports).toContainEqual({ variableName: "PORT", port: 3000 });
    expect(ports).toContainEqual({ variableName: "DB_PORT", port: 5432 });
  });

  it("should ignore disabled variables", () => {
    const envVars = {
      PORT: "__DISABLED__",
    };

    const ports = extractPortVariables(envVars);

    expect(ports).toHaveLength(0);
  });

  it("should ignore invalid port numbers", () => {
    const envVars = {
      LOW_PORT: "80",    // Below 1024
      HIGH_PORT: "70000", // Above 65535
      NOT_PORT: "abc",
    };

    const ports = extractPortVariables(envVars);

    expect(ports).toHaveLength(0);
  });
});
```

#### 9.1.3 Port Conflict Tests

```typescript
describe("validatePorts", () => {
  it("should detect conflicts with other folders", async () => {
    // Setup: Insert existing port allocation
    await db.insert(portRegistry).values({
      folderId: "other-folder",
      userId: "user-1",
      port: 3000,
      variableName: "DEV_PORT",
    });

    const result = await validatePorts("my-folder", "user-1", {
      PORT: "3000",
    });

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0].port).toBe(3000);
    expect(result.conflicts[0].conflictingVariableName).toBe("DEV_PORT");
  });

  it("should not conflict with own folder", async () => {
    await db.insert(portRegistry).values({
      folderId: "my-folder",
      userId: "user-1",
      port: 3000,
      variableName: "PORT",
    });

    const result = await validatePorts("my-folder", "user-1", {
      PORT: "3000",
    });

    expect(result.hasConflicts).toBe(false);
  });

  it("should suggest alternative ports", async () => {
    await db.insert(portRegistry).values({
      folderId: "other-folder",
      userId: "user-1",
      port: 3000,
      variableName: "PORT",
    });

    const result = await validatePorts("my-folder", "user-1", {
      PORT: "3000",
    });

    expect(result.conflicts[0].suggestedPort).toBe(3001);
  });
});
```

### 9.2 Integration Tests

#### 9.2.1 API Tests

```typescript
describe("PUT /api/preferences/folders/:folderId", () => {
  it("should save environment variables", async () => {
    const response = await fetch(`/api/preferences/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        environmentVars: { PORT: "3000", API_URL: "https://api.dev" },
      }),
    });

    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.environmentVars).toEqual({
      PORT: "3000",
      API_URL: "https://api.dev",
    });
  });

  it("should return port conflicts in response", async () => {
    // Setup: Create conflict
    await setupPortConflict("other-folder", 3000);

    const response = await fetch(`/api/preferences/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({
        environmentVars: { PORT: "3000" },
      }),
    });

    const data = await response.json();
    expect(data.portValidation.hasConflicts).toBe(true);
  });

  it("should sync port registry after save", async () => {
    await fetch(`/api/preferences/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({
        environmentVars: { PORT: "3000", DB_PORT: "5432" },
      }),
    });

    const ports = await db.query.portRegistry.findMany({
      where: eq(portRegistry.folderId, folderId),
    });

    expect(ports).toHaveLength(2);
  });
});
```

#### 9.2.2 Worktree .env Copy Tests

```typescript
describe("copyEnvFile", () => {
  it("should copy .env file to worktree", async () => {
    // Setup: Create source .env
    await writeFile("/tmp/test-repo/.env", "PORT=3000\nDEBUG=true");

    const copied = await copyEnvFile("/tmp/test-repo", "/tmp/worktree");

    expect(copied).toBe(true);

    const content = await readFile("/tmp/worktree/.env", "utf-8");
    expect(content).toContain("PORT=3000");
  });

  it("should handle missing .env gracefully", async () => {
    const copied = await copyEnvFile("/tmp/no-env-repo", "/tmp/worktree");

    expect(copied).toBe(false);
    // Should not throw
  });
});
```

### 9.3 E2E Tests

```typescript
describe("Environment Variables E2E", () => {
  it("should show env vars in terminal", async () => {
    // 1. Create folder with env vars
    await createFolderWithEnvVars("Project", { PORT: "3000" });

    // 2. Create session in folder
    const session = await createSession({ folderId: "Project" });

    // 3. Connect to terminal
    const terminal = await connectToTerminal(session.id);

    // 4. Echo env var
    terminal.type("echo $PORT\n");
    await waitForOutput("3000");

    // 5. Verify
    expect(terminal.output).toContain("3000");
  });

  it("should copy .env to worktree", async () => {
    // 1. Create .env in repo
    await writeFile(`${repoPath}/.env`, "SECRET=test123");

    // 2. Create worktree
    const worktree = await createWorktree(repoPath, "feature/test");

    // 3. Check .env exists in worktree
    const envExists = await fileExists(`${worktree.path}/.env`);
    expect(envExists).toBe(true);
  });
});
```

---

## 10. Edge Cases

### 10.1 Variable Name Validation

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty key | Reject, show error |
| Key with spaces | Reject, show error |
| Key starting with number | Reject, show error |
| Key with special chars | Reject except underscore |
| Duplicate key | Overwrite existing |

Validation regex: `/^[A-Z][A-Z0-9_]*$/`

### 10.2 Value Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty value | Allow (empty string is valid) |
| Value with spaces | Allow, preserve as-is |
| Value with quotes | Allow, store literally |
| Value with newlines | Allow, escape for display |
| Very long value (>10KB) | Truncate with warning |

### 10.3 Inheritance Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Circular folder reference | Detect and break loop |
| Missing folder in chain | Skip, log warning |
| Orphaned preferences | Clean up on folder delete |
| Concurrent updates | Last write wins |

### 10.4 Port Conflict Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Same port, different users | No conflict (isolated) |
| Port in disabled var | Don't register, no conflict |
| Port in inherited var (not overridden) | Register under inheriting folder |
| All ports 1024-9999 taken | Return null for suggestion |

### 10.5 Terminal Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Very large environment | Truncate at 64KB total |
| Invalid JSON in query | Skip custom env, use defaults |
| Env var with = in value | Parse correctly |
| Unicode in env var value | Preserve encoding |

---

## 11. Implementation Plan

### Phase 1: Database & Types (Foundation)

**Files to create/modify:**
- [ ] `src/db/schema.ts` - Add `environmentVars` column, `portRegistry` table
- [ ] `src/types/environment.ts` - New type definitions
- [ ] `src/types/preferences.ts` - Update existing types

**Tasks:**
1. Add `environmentVars` TEXT column to `folderPreferences`
2. Create `portRegistry` table with indexes
3. Run `bun run db:push`
4. Create environment type definitions
5. Update preferences types

### Phase 2: Service Layer (Business Logic)

**Files to create/modify:**
- [ ] `src/services/port-registry-service.ts` - New service
- [ ] `src/services/preferences-service.ts` - Update for env vars
- [ ] `src/lib/preferences.ts` - Update resolution logic
- [ ] `src/lib/environment.ts` - New env resolution logic

**Tasks:**
1. Create PortRegistryService with CRUD operations
2. Add env var resolution to preferences resolver
3. Update preferences service mappers
4. Add port sync on preference update

### Phase 3: Worktree Integration

**Files to modify:**
- [ ] `src/services/worktree-service.ts` - Add `.env` copy

**Tasks:**
1. Add `copyEnvFile` function
2. Integrate with `createWorktree` and `createBranchWithWorktree`
3. Copy `.env`, `.env.local`, `.env.development`

### Phase 4: API Layer

**Files to modify:**
- [ ] `src/app/api/preferences/folders/[folderId]/route.ts` - Update PUT
- [ ] `src/app/api/preferences/folders/[folderId]/validate-ports/route.ts` - New
- [ ] `src/app/api/preferences/folders/[folderId]/environment/route.ts` - New

**Tasks:**
1. Add `environmentVars` to allowed fields
2. Add port validation to PUT response
3. Create validate-ports endpoint
4. Create environment resolution endpoint

### Phase 5: Terminal Integration

**Files to modify:**
- [ ] `src/server/terminal.ts` - Merge custom env
- [ ] `src/components/terminal/Terminal.tsx` - Pass env vars

**Tasks:**
1. Update `attachToTmuxSession` to accept custom env
2. Parse `environmentVars` from WebSocket query
3. Update Terminal component to include env in connection

### Phase 6: UI Layer

**Files to modify:**
- [ ] `src/components/preferences/FolderPreferencesModal.tsx` - Add env section
- [ ] `src/components/preferences/EnvVarEditor.tsx` - New component
- [ ] `src/components/preferences/PortConflictBanner.tsx` - New component

**Tasks:**
1. Add Environment Variables section to modal
2. Create EnvVarRow component with all states
3. Create PortConflictBanner component
4. Handle add/edit/delete/disable interactions

### Phase 7: Testing

**Files to create:**
- [ ] `src/__tests__/lib/environment.test.ts`
- [ ] `src/__tests__/services/port-registry-service.test.ts`
- [ ] `src/__tests__/integration/env-vars.test.ts`

**Tasks:**
1. Write unit tests for env resolution
2. Write unit tests for port extraction/validation
3. Write integration tests for API
4. Manual E2E testing

### Phase 8: Documentation

**Files to modify:**
- [ ] `docs/API.md` - Add new endpoints
- [ ] `docs/ARCHITECTURE.md` - Update with env vars
- [ ] `CLAUDE.md` - Add env vars to feature list

---

## 12. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `src/types/environment.ts` | Environment variable type definitions |
| `src/lib/environment.ts` | Environment resolution logic |
| `src/services/port-registry-service.ts` | Port conflict detection service |
| `src/app/api/preferences/folders/[folderId]/validate-ports/route.ts` | Port validation API |
| `src/app/api/preferences/folders/[folderId]/environment/route.ts` | Environment resolution API |
| `src/components/preferences/EnvVarEditor.tsx` | Environment variable editor component |
| `src/components/preferences/PortConflictBanner.tsx` | Port conflict warning component |

### Modified Files

| File | Changes |
|------|---------|
| `src/db/schema.ts` | Add `environmentVars` column, `portRegistry` table |
| `src/types/preferences.ts` | Add `environmentVars` to interfaces |
| `src/lib/preferences.ts` | Update default preferences |
| `src/services/preferences-service.ts` | Handle env vars in CRUD |
| `src/services/worktree-service.ts` | Add `.env` copy logic |
| `src/server/terminal.ts` | Merge custom environment |
| `src/app/api/preferences/folders/[folderId]/route.ts` | Add env vars, port validation |
| `src/components/preferences/FolderPreferencesModal.tsx` | Add environment section |
| `src/components/terminal/Terminal.tsx` | Pass env vars to WebSocket |
| `src/contexts/PreferencesContext.tsx` | Include env vars in state |

---

## Appendix A: Security Considerations

### A.1 Secrets in Environment Variables

**Current Implementation:** Plain text storage in SQLite.

**Risks:**
- Secrets visible in database dumps
- Secrets visible in API responses
- Secrets visible in browser dev tools

**Mitigations:**
- Mask values in UI (show `****` option)
- Add `isSecret` flag to prevent logging
- Future: Encrypt at rest with `AUTH_SECRET`

### A.2 Path Traversal in .env Copy

**Risk:** User could configure malicious worktree path.

**Mitigation:** Already handled by existing `validatePath()` function.

### A.3 Command Injection via Env Vars

**Risk:** Malicious env var values could be exploited.

**Mitigation:** Env vars are passed directly to `pty.spawn()` without shell interpolation.

---

## Appendix B: Performance Considerations

### B.1 Environment Resolution

- Cache resolved environments in React context
- Invalidate on folder preference change
- Use memoization for expensive computations

### B.2 Port Conflict Detection

- Index on `(userId, port)` for fast lookups
- Batch port inserts
- Lazy validation (only on save, not keystroke)

### B.3 WebSocket Overhead

- Serialize env vars once on connection
- URL-encode to prevent special char issues
- Limit total env size to ~4KB
