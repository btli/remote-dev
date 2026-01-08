# Orchestrator Agent System - Code Review Findings & Remediation Plan

**Review Date:** 2026-01-08
**Reviewer:** Claude Sonnet 4.5 (Multi-Agent Code Review)
**Total Issues Found:** 31 (11 Critical, 8 High Priority, 12 Medium Priority)

---

## Epic 1: Security Fixes (Critical) 🔴

**Priority:** P0 - Must fix before production deployment
**Estimated Effort:** 3-4 days

### Task 1.1: Fix XSS vulnerabilities in InsightNotificationInbox component
**File:** `src/components/orchestrator/InsightNotificationInbox.tsx:152`
**Severity:** Critical
**Confidence:** 95%

**Issue:**
```tsx
<p className="text-sm font-medium mb-1">{insight.message}</p>
```
Unescaped `insight.message` can contain malicious HTML/JavaScript.

**Fix:**
```tsx
import DOMPurify from 'dompurify';

<p className="text-sm font-medium mb-1"
   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(insight.message) }} />
```

**Alternative:** Ensure backend sanitizes all insight messages before storage.

---

### Task 1.2: Fix XSS vulnerabilities in InsightDetailView component
**Files:**
- `src/components/orchestrator/InsightDetailView.tsx:174` (action.label)
- `src/components/orchestrator/InsightDetailView.tsx:176-178` (action.description)
- `src/components/orchestrator/InsightDetailView.tsx:194-196` (action.command)
- `src/components/orchestrator/InsightDetailView.tsx:136-150` (context values)

**Severity:** Critical
**Confidence:** 95%

**Issue:** All user-facing strings derived from orchestrator insights render without sanitization.

**Fix:** Apply DOMPurify sanitization to all dynamic content:
```tsx
<p className="text-sm font-medium">
  {DOMPurify.sanitize(action.label)}
</p>
```

---

### Task 1.3: Add folder ownership validation in ensureFolderSubOrchestrator
**File:** `src/services/orchestrator-service.ts:474-537`
**Called from:** `src/app/api/folders/[id]/orchestrator/route.ts:68-77`
**Severity:** Critical (IDOR Vulnerability)
**Confidence:** 95%

**Issue:** Users can create orchestrators for folders they don't own.

**Attack Scenario:**
```bash
curl -X POST /api/folders/{victim-folder-id}/orchestrator \
  -H "Authorization: Bearer $ATTACKER_TOKEN"
# Attacker now has command injection access to victim's sessions
```

**Fix:**
```typescript
export async function ensureFolderSubOrchestrator(
  userId: string,
  folderId: string,
  config?: { /* ... */ }
) {
  // ADD THIS: Verify folder ownership
  const folder = await db
    .select()
    .from(sessionFolders)
    .where(
      and(
        eq(sessionFolders.id, folderId),
        eq(sessionFolders.userId, userId)
      )
    )
    .limit(1);

  if (folder.length === 0) {
    throw new OrchestratorServiceError(
      "Folder not found or access denied",
      "FOLDER_NOT_FOUND"
    );
  }

  // ... rest of function
}
```

---

### Task 1.4: Improve command injection validation
**File:** `src/infrastructure/external/tmux/TmuxCommandInjector.ts:16-27,93-148`
**Severity:** Critical
**Confidence:** 90%

**Issue:** Dangerous command patterns can be bypassed:
- Extra whitespace: `rm  -rf  /`
- Tab characters: `rm\t-rf\t/`
- Command substitution: `$(rm -rf /)`
- Base64 encoding: `bash -c "$(echo cm0gLXJmIC8K | base64 -d)"`

**Missing Patterns:**
- `eval` commands
- `exec` commands
- Backtick substitution
- Brace expansion
- `nohup` + dangerous commands
- Session hijacking via `screen`/`tmux`

**Fix Options:**

**Option 1: Move to Allowlist Approach**
```typescript
const ALLOWED_COMMANDS = [
  'ls', 'cd', 'pwd', 'cat', 'grep', 'git', 'npm', 'node',
  'python', 'pip', 'cargo', 'rustc', 'go', 'make'
];

private isCommandAllowed(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(firstWord);
}
```

**Option 2: Use Proper Command Parser**
```typescript
import { parse } from 'shell-quote';

async validateCommand(command: string): Promise<ValidationResult> {
  try {
    const parsed = parse(command);
    // Analyze AST for dangerous patterns
    for (const token of parsed) {
      if (typeof token === 'object' && token.op) {
        // Check for dangerous operators
        if (['||', '&&', '|', '>', '>>', '<'].includes(token.op)) {
          return { valid: false, reason: 'Dangerous operators not allowed' };
        }
      }
    }
  } catch (error) {
    return { valid: false, reason: 'Invalid command syntax' };
  }
}
```

---

### Task 1.5: Add try-catch for JSON parsing in repositories
**Files:**
- `src/infrastructure/persistence/repositories/DrizzleInsightRepository.ts:204-209`
- `src/infrastructure/persistence/repositories/DrizzleAuditLogRepository.ts:175`

**Severity:** Critical
**Confidence:** 95%

**Issue:** Unhandled JSON parsing can crash the application or enable prototype pollution.

**Fix:**
```typescript
private toDomain(row: typeof orchestratorInsights.$inferSelect): OrchestratorInsight {
  let context: InsightContext | null = null;
  let suggestedActions: SuggestedAction[] = [];

  // Wrap JSON parsing in try-catch
  try {
    context = row.contextJson ? JSON.parse(row.contextJson) : null;
  } catch (error) {
    console.error(`Failed to parse context JSON for insight ${row.id}:`, error);
    context = null; // Graceful degradation
  }

  try {
    suggestedActions = row.suggestedActions
      ? JSON.parse(row.suggestedActions)
      : [];
  } catch (error) {
    console.error(`Failed to parse suggestedActions JSON for insight ${row.id}:`, error);
    suggestedActions = [];
  }

  // Optional: Add Zod validation
  // const validatedContext = InsightContextSchema.parse(context);

  return OrchestratorInsight.reconstitute({
    id: row.id,
    orchestratorId: row.orchestratorId,
    sessionId: row.sessionId,
    type: row.type as InsightType,
    severity: row.severity as InsightSeverity,
    message: row.message,
    context,
    suggestedActions,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
    createdAt: new Date(row.createdAt),
  });
}
```

---

## Epic 2: Data Integrity & Memory Leaks (Critical) 🔴

**Priority:** P0 - Must fix before production deployment
**Estimated Effort:** 2-3 days

### Task 2.1: Fix cleanupOldInsights comparison (gte → lte)
**File:** `src/services/insight-service.ts:299`
**Severity:** Critical (Data Loss)
**Confidence:** 100%

**Issue:**
```typescript
// WRONG: This deletes NEW insights, keeps OLD ones
gte(orchestratorInsights.resolvedAt as any, cutoffDate)
```

**Fix:**
```typescript
// CORRECT: Delete insights older than cutoffDate
lte(orchestratorInsights.resolvedAt as any, cutoffDate)
```

**Test:** Add unit test to verify insights older than 30 days are deleted, not newer ones.

---

### Task 2.2: Implement snapshot cleanup for closed/deleted sessions
**File:** `src/services/monitoring-service.ts:64,129-141,230`
**Severity:** Critical (Memory Leak)
**Confidence:** 98%

**Issue:** `snapshotStore` grows unbounded with no cleanup.

**Memory Calculation:**
- 10,000 lines × 80 chars/line × 2 bytes/char = ~1.6MB per snapshot
- 100 sessions × 1.6MB = 160MB minimum
- Grows indefinitely over time

**Fix:**
```typescript
/**
 * Clean up snapshots for sessions that are no longer active
 */
async function cleanupOrphanedSnapshots(): Promise<void> {
  // Get all active session IDs from database
  const activeSessions = await db
    .select({ id: terminalSessions.id })
    .from(terminalSessions)
    .where(eq(terminalSessions.status, "active"));

  const activeSessionIds = new Set(activeSessions.map((s) => s.id));

  // Remove snapshots for inactive sessions
  let removedCount = 0;
  snapshotStore.forEach((orchestratorSnapshots, orchestratorId) => {
    orchestratorSnapshots.forEach((snapshot, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        orchestratorSnapshots.delete(sessionId);
        removedCount++;
      }
    });

    // Remove empty orchestrator entries
    if (orchestratorSnapshots.size === 0) {
      snapshotStore.delete(orchestratorId);
    }
  });

  if (removedCount > 0) {
    console.log(`[MonitoringService] Cleaned up ${removedCount} orphaned snapshots`);
  }
}
```

---

### Task 2.3: Add periodic garbage collection for orphaned snapshots
**File:** `src/services/monitoring-service.ts`
**Severity:** High
**Confidence:** 90%

**Fix:** Run cleanup every 5 minutes
```typescript
// Add to initializeMonitoring()
async function initializeMonitoring(): Promise<void> {
  console.log("[MonitoringService] Initializing monitoring for all orchestrators...");

  // Start cleanup interval
  const cleanupInterval = setInterval(async () => {
    try {
      await cleanupOrphanedSnapshots();
    } catch (error) {
      console.error("[MonitoringService] Snapshot cleanup failed:", error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Store interval for cleanup on shutdown
  activeIntervals.set("__cleanup__", cleanupInterval);

  // ... rest of initialization
}
```

---

## Epic 3: Concurrency & Race Conditions (Critical) 🔴

**Priority:** P0 - Must fix before production deployment
**Estimated Effort:** 2-3 days

### Task 3.1: Add unique database constraints for orchestrators
**Files:**
- `src/application/use-cases/orchestrator/CreateMasterOrchestratorUseCase.ts:43-62`
- `src/application/use-cases/orchestrator/CreateSubOrchestratorUseCase.ts:44-69`

**Severity:** Critical (Race Condition)
**Confidence:** 95%

**Issue:** Check-then-act pattern allows duplicate orchestrators.

**Race Scenario:**
1. Request A checks for master at T0 → not found
2. Request B checks for master at T1 → not found (before A saves)
3. Request A saves at T2
4. Request B saves at T3 → **duplicate created**

**Fix: Add Database Constraints**

Update `src/db/schema.ts`:
```typescript
export const orchestratorSessions = sqliteTable(
  "orchestrator_sessions",
  {
    // ... existing columns ...
  },
  (table) => ({
    userIdx: index("orchestrator_session_user_idx").on(table.userId),
    statusIdx: index("orchestrator_session_status_idx").on(table.status),
    scopeIdx: index("orchestrator_session_scope_idx").on(table.scopeType, table.scopeId),

    // NEW: Unique constraint for master orchestrator per user
    masterUniqueIdx: uniqueIndex("orchestrator_session_master_unique_idx")
      .on(table.userId)
      .where(sql`type = 'master'`),

    // NEW: Unique constraint for sub-orchestrator per folder
    folderUniqueIdx: uniqueIndex("orchestrator_session_folder_unique_idx")
      .on(table.userId, table.scopeId)
      .where(sql`type = 'sub_orchestrator' AND scope_type = 'folder'`),
  })
);
```

Run migration:
```bash
bun run db:generate
bun run db:migrate
```

---

### Task 3.2: Fix useEffect interval leak in OrchestratorContext
**File:** `src/contexts/OrchestratorContext.tsx:215-223`
**Severity:** Critical (Memory Leak)
**Confidence:** 85%

**Issue:** Effect re-runs on every `state.orchestrators` change, creating multiple intervals.

**Current Buggy Code:**
```tsx
useEffect(() => {
  const interval = setInterval(() => {
    state.orchestrators.forEach((orc) => {
      fetchInsights(orc.id).catch(console.error);
    });
  }, 30000);

  return () => clearInterval(interval);
}, [state.orchestrators, fetchInsights]); // Re-runs on every change!
```

**Fix:**
```tsx
useEffect(() => {
  const interval = setInterval(() => {
    // Use functional setState to get latest state
    setState((prevState) => {
      // Fetch insights for all current orchestrators
      prevState.orchestrators.forEach((orc) => {
        fetchInsights(orc.id).catch(console.error);
      });
      return prevState; // Don't trigger re-render
    });
  }, 30000);

  return () => clearInterval(interval);
}, [fetchInsights]); // Only depend on fetchInsights (stable)
```

---

### Task 3.3: Add concurrency limiting for parallel subprocess spawning
**File:** `src/services/monitoring-service.ts:216-245`
**Severity:** High
**Confidence:** 85%

**Issue:** 100+ sessions = 100+ concurrent tmux subprocess calls.

**Fix: Use p-limit**
```bash
bun add p-limit
```

```typescript
import pLimit from 'p-limit';

// At module level
const CONCURRENCY_LIMIT = 10; // Max 10 concurrent captures
const limit = pLimit(CONCURRENCY_LIMIT);

// In runMonitoringCycle
const capturePromises = sessionsToMonitor.map((session) =>
  limit(async () => { // Wrap in limiter
    try {
      const exists = await TmuxService.sessionExists(session.tmuxSessionName);
      if (!exists) {
        return null;
      }

      const snapshot = await scrollbackMonitor.captureScrollback(
        session.tmuxSessionName
      );

      storeSnapshot(orchestratorId, session.sessionId, snapshot);

      return { session, snapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        sessionId: session.sessionId,
        error: `Failed to capture scrollback: ${message}`,
      });
      return null;
    }
  })
);
```

---

### Task 3.4: Fix TOCTOU in monitoring restart (await initial cycle)
**File:** `src/services/monitoring-service.ts:280-338`
**Severity:** High
**Confidence:** 95%

**Issue:** Initial cycle is fire-and-forget, potentially causing overlapping cycles.

**Fix:**
```typescript
export function startMonitoring(orchestratorId: string, userId: string): void {
  stopMonitoring(orchestratorId);

  db.select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .limit(1)
    .then(async (result) => { // Make async
      if (result.length === 0) {
        console.error(`[MonitoringService] Orchestrator ${orchestratorId} not found`);
        return;
      }

      const orchestrator = result[0];
      const intervalMs = orchestrator.monitoringInterval * 1000;

      // Run first cycle and WAIT for completion
      try {
        await runMonitoringCycle(orchestratorId, userId);
        console.log(`[MonitoringService] Initial cycle complete for ${orchestratorId}`);
      } catch (error) {
        console.error(`[MonitoringService] Initial cycle failed:`, error);
        // Don't start interval if initial cycle fails critically
        return;
      }

      // Now start interval
      const interval = setInterval(async () => {
        try {
          const cycleResult = await runMonitoringCycle(orchestratorId, userId);
          // ... logging
        } catch (error) {
          console.error(`[MonitoringService] Monitoring cycle failed:`, error);
        }
      }, intervalMs);

      activeIntervals.set(orchestratorId, interval);
      console.log(
        `[MonitoringService] Started monitoring for ${orchestratorId} (interval: ${orchestrator.monitoringInterval}s)`
      );
    })
    .catch((error) => {
      console.error(`[MonitoringService] Failed to start monitoring:`, error);
    });
}
```

---

## Epic 4: Performance & Optimization (High Priority) 🟠

**Priority:** P1 - Fix in next sprint
**Estimated Effort:** 1-2 days

### Task 4.1: Add composite indexes
**File:** `src/db/schema.ts`
**Severity:** High
**Confidence:** 85%

**Issue:** Missing composite indexes cause full table scans.

**Fix:**
```typescript
export const orchestratorSessions = sqliteTable(
  "orchestrator_sessions",
  {
    // ... columns ...
  },
  (table) => ({
    // ... existing indexes ...

    // NEW: Composite index for active orchestrator queries
    userStatusIdx: index("orchestrator_session_user_status_idx")
      .on(table.userId, table.status),
  })
);

export const orchestratorAuditLog = sqliteTable(
  "orchestrator_audit_log",
  {
    // ... columns ...
  },
  (table) => ({
    // ... existing indexes ...

    // NEW: Composite index for time-range queries
    orchestratorTimeIdx: index("orchestrator_audit_orchestrator_time_idx")
      .on(table.orchestratorId, table.createdAt),
  })
);
```

---

### Task 4.2: Fix count queries to use COUNT(*)
**Files:**
- `src/infrastructure/persistence/repositories/DrizzleOrchestratorRepository.ts:168-175`
- `src/infrastructure/persistence/repositories/DrizzleInsightRepository.ts:169-181,183-198`
- `src/infrastructure/persistence/repositories/DrizzleAuditLogRepository.ts:132-156`

**Severity:** High
**Confidence:** 95%

**Issue:** Count queries fetch all rows and count in application code.

**Current Buggy Code:**
```typescript
async countByUserId(userId: string): Promise<number> {
  const result = await db
    .select({ count: orchestratorSessions.id }) // Fetches all IDs!
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.userId, userId));

  return result.length; // Counts array length, not DB count
}
```

**Fix:**
```typescript
import { count } from "drizzle-orm";

async countByUserId(userId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.userId, userId));

  return result[0].count;
}
```

---

### Task 4.3: Add hard limit validation for scrollback capture
**File:** `src/infrastructure/external/tmux/TmuxScrollbackMonitor.ts:18-42`
**Severity:** High
**Confidence:** 90%

**Issue:** No upper limit enforcement on scrollback lines, can exhaust memory.

**Fix:**
```typescript
async captureScrollback(
  tmuxSessionName: string,
  lines?: number
): Promise<ScrollbackSnapshot> {
  const MAX_LINES = 50000; // Hard upper limit (50k lines)
  const DEFAULT_LINES = 10000;

  const requestedLines = lines ?? DEFAULT_LINES;

  if (requestedLines > MAX_LINES) {
    throw new ScrollbackMonitorError(
      `Cannot capture more than ${MAX_LINES} lines (requested: ${requestedLines})`,
      "LIMIT_EXCEEDED"
    );
  }

  const limitedLines = Math.min(requestedLines, MAX_LINES);

  const content = await TmuxService.captureOutput(tmuxSessionName, limitedLines);

  // ... rest of function
}
```

---

## Epic 5: Authorization & Validation (High Priority) 🟠

**Priority:** P1 - Fix in next sprint
**Estimated Effort:** 2-3 days

### Task 5.1: Add userId validation to all orchestrator use cases
**Files:** All use cases in `src/application/use-cases/orchestrator/`
**Severity:** High (TOCTOU Vulnerability)
**Confidence:** 90%

**Issue:** Use cases re-fetch orchestrators without validating ownership.

**Fix Pattern:**

Update interface to include userId:
```typescript
export interface PauseOrchestratorInput {
  orchestratorId: string;
  userId: string; // ADD THIS
  reason?: string;
}
```

Update use case to validate ownership:
```typescript
async execute(input: PauseOrchestratorInput): Promise<PauseOrchestratorOutput> {
  // Add new repository method that validates both ID and userId
  const orchestrator = await this.orchestratorRepository.findByIdAndUser(
    input.orchestratorId,
    input.userId
  );

  if (!orchestrator) {
    throw new OrchestratorNotFoundError(input.orchestratorId);
  }

  // ... rest of logic
}
```

Add new repository method to interface:
```typescript
export interface IOrchestratorRepository {
  // ... existing methods ...

  /**
   * Find orchestrator by ID and validate user ownership atomically
   */
  findByIdAndUser(orchestratorId: string, userId: string): Promise<Orchestrator | null>;
}
```

Implement in repository:
```typescript
async findByIdAndUser(orchestratorId: string, userId: string): Promise<Orchestrator | null> {
  const result = await db
    .select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .limit(1);

  return result.length > 0 ? this.toDomain(result[0]) : null;
}
```

**Apply to all use cases:**
- PauseOrchestratorUseCase
- ResumeOrchestratorUseCase
- InjectCommandUseCase
- DetectStalledSessionsUseCase

---

### Task 5.2: Add session validation in orchestrator creation use cases
**Files:**
- `src/application/use-cases/orchestrator/CreateMasterOrchestratorUseCase.ts`
- `src/application/use-cases/orchestrator/CreateSubOrchestratorUseCase.ts`

**Severity:** High
**Confidence:** 90%

**Issue:** No validation that provided sessionId exists or is an orchestrator session.

**Fix:**
```typescript
async execute(input: CreateMasterOrchestratorInput): Promise<CreateMasterOrchestratorOutput> {
  // Step 0: Validate session exists and belongs to user
  const session = await db
    .select()
    .from(terminalSessions)
    .where(
      and(
        eq(terminalSessions.id, input.sessionId),
        eq(terminalSessions.userId, input.userId)
      )
    )
    .limit(1);

  if (session.length === 0) {
    throw new InvalidSessionError(
      "Session not found or access denied",
      "SESSION_NOT_FOUND"
    );
  }

  if (!session[0].isOrchestratorSession) {
    throw new InvalidSessionError(
      "Session must be an orchestrator session",
      "NOT_ORCHESTRATOR_SESSION"
    );
  }

  if (session[0].status === "closed") {
    throw new InvalidSessionError(
      "Cannot create orchestrator with closed session",
      "SESSION_CLOSED"
    );
  }

  // Step 1: Check for existing master
  const existingMaster = await this.orchestratorRepository.findMasterByUserId(input.userId);
  if (existingMaster) {
    throw new MasterOrchestratorAlreadyExistsError(input.userId, existingMaster.id);
  }

  // ... rest of logic
}
```

---

### Task 5.3: Add folder validation in sub-orchestrator creation
**File:** `src/application/use-cases/orchestrator/CreateSubOrchestratorUseCase.ts`
**Severity:** High
**Confidence:** 90%

**Issue:** No validation that folderId exists or belongs to user.

**Fix:**
```typescript
async execute(input: CreateSubOrchestratorInput): Promise<CreateSubOrchestratorOutput> {
  // Step 0: Validate folder exists and belongs to user
  const folder = await db
    .select()
    .from(sessionFolders)
    .where(
      and(
        eq(sessionFolders.id, input.folderId),
        eq(sessionFolders.userId, input.userId)
      )
    )
    .limit(1);

  if (folder.length === 0) {
    throw new InvalidFolderError(
      "Folder not found or access denied",
      "FOLDER_NOT_FOUND"
    );
  }

  // ... rest of validation and logic
}
```

---

### Task 5.4: Add transaction boundaries for multi-step operations
**Files:** All use cases that perform multiple database operations
**Severity:** High
**Confidence:** 85%

**Issue:** If second operation fails, system ends in inconsistent state.

**Example Problem:**
```typescript
await this.orchestratorRepository.save(orchestrator);  // ✅ Succeeds
await this.auditLogRepository.save(auditLog);  // ❌ Fails
// Result: Orchestrator exists but no audit trail (compliance issue!)
```

**Fix Pattern:**
```typescript
async execute(input: CreateMasterOrchestratorInput): Promise<CreateMasterOrchestratorOutput> {
  // ... validation ...

  // Use database transaction
  const result = await db.transaction(async (tx) => {
    // Create orchestrator entity
    const orchestrator = Orchestrator.createMaster({...});

    // Save orchestrator (within transaction)
    await this.orchestratorRepository.saveWithTransaction(tx, orchestrator);

    // Create audit log
    const auditLog = OrchestratorAuditLog.forOrchestratorCreated(
      orchestrator.id,
      orchestrator.type,
      null,
      { userId: input.userId }
    );

    // Save audit log (within transaction)
    await this.auditLogRepository.saveWithTransaction(tx, auditLog);

    return { orchestrator, auditLog };
  });

  return result;
}
```

**Repository Interface Update:**
```typescript
export interface IOrchestratorRepository {
  // ... existing methods ...

  /**
   * Save orchestrator within a transaction
   */
  saveWithTransaction(tx: Transaction, orchestrator: Orchestrator): Promise<void>;
}
```

---

## Epic 6: Domain Entity Immutability (High Priority) 🟠

**Priority:** P1 - Fix in next sprint
**Estimated Effort:** 1 day

### Task 6.1-6.3: Clone Date objects in all entity getters
**Files:**
- `src/domain/entities/Orchestrator.ts:240-250`
- `src/domain/entities/OrchestratorInsight.ts:172-177`
- `src/domain/entities/OrchestratorAuditLog.ts:232-234`

**Severity:** High (Immutability Violation)
**Confidence:** 95%

**Issue:** Date objects are mutable, exposing internal state.

**Example Bug:**
```typescript
const orchestrator = Orchestrator.create({ /* ... */ });
const createdAt = orchestrator.createdAt;
createdAt.setFullYear(2000); // Mutates internal state!
console.log(orchestrator.createdAt); // Changed unexpectedly
```

**Fix (Apply to all Date getters):**
```typescript
// In Orchestrator.ts
get lastActivityAt(): Date {
  return new Date(this.props.lastActivityAt);
}

get createdAt(): Date {
  return new Date(this.props.createdAt);
}

get updatedAt(): Date {
  return new Date(this.props.updatedAt);
}

// In OrchestratorInsight.ts
get createdAt(): Date {
  return new Date(this.props.createdAt);
}

get resolvedAt(): Date | null {
  return this.props.resolvedAt ? new Date(this.props.resolvedAt) : null;
}

// In OrchestratorAuditLog.ts
get createdAt(): Date {
  return new Date(this.props.createdAt);
}
```

---

### Task 6.4: Deep clone suggestedActions array
**File:** `src/domain/entities/OrchestratorInsight.ts:165`
**Severity:** Medium
**Confidence:** 82%

**Issue:** Array is shallow copied, but objects inside are mutable.

**Fix:**
```typescript
get suggestedActions(): SuggestedAction[] {
  // Deep clone each action object
  return this.props.suggestedActions.map(action => ({
    ...action,
    // If action contains nested objects, clone them too
  }));
}
```

**Alternative:** Document that SuggestedAction should be treated as readonly.

---

## Epic 7: Error Handling & Observability (Medium Priority) 🟡

**Priority:** P2 - Address in backlog
**Estimated Effort:** 2-3 days

### Task 7.1: Add error boundaries to orchestrator UI components
**Files:** All components in `src/components/orchestrator/`
**Severity:** Medium
**Confidence:** 80%

**Fix:**
```tsx
// Create error boundary component
class OrchestratorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Orchestrator UI Error:', error, errorInfo);
    // Send to error tracking service
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-red-500 rounded-lg bg-red-500/10">
          <h3 className="font-semibold text-red-500 mb-2">
            Orchestrator Error
          </h3>
          <p className="text-sm text-muted-foreground">
            An error occurred in the orchestrator system. Please refresh the page.
          </p>
          <pre className="mt-2 text-xs bg-background rounded p-2 overflow-auto">
            {this.state.error?.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// Wrap orchestrator components
export function OrchestratorStatusIndicator() {
  return (
    <OrchestratorErrorBoundary>
      {/* Component content */}
    </OrchestratorErrorBoundary>
  );
}
```

---

### Task 7.2: Implement failure tracking in monitoring service
**File:** `src/services/monitoring-service.ts:304-323`
**Severity:** Medium
**Confidence:** 82%

**Issue:** Errors are swallowed; no visibility into persistent failures.

**Fix:**
```typescript
// Add failure tracking
const failureCount = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 5;

const interval = setInterval(async () => {
  try {
    const cycleResult = await runMonitoringCycle(orchestratorId, userId);

    // Reset failure count on success
    failureCount.set(orchestratorId, 0);

    // ... logging
  } catch (error) {
    console.error(`[MonitoringService] Monitoring cycle failed:`, error);

    // Track consecutive failures
    const currentFailures = (failureCount.get(orchestratorId) || 0) + 1;
    failureCount.set(orchestratorId, currentFailures);

    // Stop monitoring after N consecutive failures
    if (currentFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `[MonitoringService] Stopping orchestrator ${orchestratorId} after ${currentFailures} consecutive failures`
      );
      stopMonitoring(orchestratorId);

      // TODO: Send alert/notification to user
    }
  }
}, intervalMs);
```

---

### Task 7.3: Add health metrics API for monitoring service
**File:** New file `src/app/api/orchestrators/health/route.ts`
**Severity:** Medium
**Confidence:** 80%

**Fix:**
```typescript
import { NextResponse } from "next/server";
import * as MonitoringService from "@/services/monitoring-service";

export async function GET() {
  const activeMonitoring = MonitoringService.getActiveMonitoringSessions();

  // Get failure counts from monitoring service
  const health = {
    active: activeMonitoring.length,
    orchestrators: activeMonitoring,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(health);
}
```

---

### Task 7.4: Improve error accumulation in stall detection loop
**File:** `src/application/use-cases/orchestrator/DetectStalledSessionsUseCase.ts:123-127`
**Severity:** Medium
**Confidence:** 85%

**Issue:** Errors are logged but not returned to caller.

**Fix:**
```typescript
// Return errors in output
export interface DetectStalledSessionsOutput {
  insights: OrchestratorInsight[];
  auditLogs: OrchestratorAuditLog[];
  stallDetectionResults: Map<string, StallDetectionResult>;
  errors: Array<{ sessionId: string; error: string }>; // ADD THIS
}

async execute(input: DetectStalledSessionsInput): Promise<DetectStalledSessionsOutput> {
  const errors: Array<{ sessionId: string; error: string }> = [];

  // ... monitoring logic

  return {
    insights,
    auditLogs,
    stallDetectionResults,
    errors, // Return errors
  };
}
```

---

## Epic 8: UI/UX Improvements (Medium Priority) 🟡

**Priority:** P2 - Address in backlog
**Estimated Effort:** 1-2 days

### Task 8.1: Add ARIA labels to icon-only buttons
**Files:** All orchestrator UI components
**Severity:** Medium (Accessibility)
**Confidence:** 80%

**Fix:**
```tsx
// In InsightNotificationInbox.tsx
<Button
  variant="ghost"
  size="icon"
  className="relative"
  aria-label="Orchestrator insights notifications"
>
  <Bell className="h-5 w-5" />
</Button>

// In OrchestratorStatusIndicator.tsx
<Button
  variant="ghost"
  size="sm"
  onClick={handleToggle}
  aria-label={isPaused ? "Resume orchestrator monitoring" : "Pause orchestrator monitoring"}
>
  {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
</Button>
```

---

### Task 8.2: Add input validation with clamping
**File:** `src/components/orchestrator/SubOrchestratorConfigModal.tsx:151-178`
**Severity:** Medium
**Confidence:** 80%

**Fix:**
```tsx
<Input
  id="monitoringInterval"
  type="number"
  min={10}
  max={300}
  value={monitoringInterval}
  onChange={(e) => {
    const value = parseInt(e.target.value);
    if (isNaN(value)) {
      setMonitoringInterval(30); // Default
    } else {
      // Clamp value between min and max
      setMonitoringInterval(Math.max(10, Math.min(300, value)));
    }
  }}
/>
```

---

### Task 8.3: Fix form state reset bug
**File:** `src/components/orchestrator/CommandInjectionDialog.tsx:59-66`
**Severity:** Medium
**Confidence:** 80%

**Fix:**
```tsx
const handleSubmit = async () => {
  if (!command.trim()) return;

  setIsExecuting(true);
  setError(null);

  try {
    await onConfirm(command.trim(), reason.trim());

    // Reset form and close on success
    setCommand("");
    setReason("");
    setError(null);
    onClose();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to inject command");
    // DON'T close dialog on error - let user retry or cancel
  } finally {
    setIsExecuting(false);
  }
};

// Add cancel handler that resets state
const handleCancel = () => {
  setCommand("");
  setReason("");
  setError(null);
  onClose();
};
```

---

### Task 8.4: Add rate limiting to orchestrator API routes
**Files:** All API routes in `src/app/api/orchestrators/`
**Severity:** Medium
**Confidence:** 75%

**Fix:**
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Create rate limiter
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 requests per minute
  analytics: true,
});

// Add to API route handlers
export const POST = withAuth(async (request, { userId }) => {
  // Check rate limit
  const { success, reset } = await ratelimit.limit(
    `orchestrator:commands:${userId}`
  );

  if (!success) {
    return errorResponse(
      "Rate limit exceeded. Please try again later.",
      429,
      "RATE_LIMIT_EXCEEDED",
      { resetAt: new Date(reset).toISOString() }
    );
  }

  // ... rest of handler
});
```

---

## Testing Strategy

### Unit Tests (Priority: High)
- [ ] Domain entity immutability tests
- [ ] Command validation bypass tests
- [ ] Repository count query tests
- [ ] Use case authorization tests
- [ ] Snapshot cleanup logic tests

### Integration Tests (Priority: Medium)
- [ ] Orchestrator creation race condition tests
- [ ] Transaction rollback tests
- [ ] API authorization tests
- [ ] Memory leak reproduction tests

### E2E Tests (Priority: Low)
- [ ] Full orchestrator lifecycle test
- [ ] Command injection workflow test
- [ ] Insight generation and resolution test

---

## Deployment Checklist

Before deploying to production:

- [ ] All P0 (Critical) issues fixed and tested
- [ ] Database migrations run for new indexes/constraints
- [ ] Error tracking service integrated (Sentry, etc.)
- [ ] Rate limiting configured
- [ ] Memory monitoring alerts set up
- [ ] Backup strategy for snapshot data
- [ ] Rollback plan documented
- [ ] Security review sign-off
- [ ] Performance testing completed

---

## Summary

**Total Issues:** 31
**Critical (P0):** 11 issues across 3 epics (Security, Data Integrity, Concurrency)
**High (P1):** 8 issues across 3 epics (Performance, Authorization, Immutability)
**Medium (P2):** 12 issues across 2 epics (Error Handling, UI/UX)

**Estimated Total Effort:** 14-19 days
**P0 Only:** 7-10 days
**P0 + P1:** 11-16 days

**Recommended Approach:**
1. Week 1: Fix all P0 issues (security + critical bugs)
2. Week 2: Fix P1 issues (performance + authorization)
3. Week 3: Address P2 issues (observability + UX)
4. Week 4: Testing, documentation, deployment prep
