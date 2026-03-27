# Polish Plan: Stop Hook Reliability & Hook Enforcement

**Date**: 2026-03-27
**Focus**: Stop hook design, task completion enforcement, hook installation

## Summary

The stop hook system is architecturally sound — stdout-based enforcement is correct for
Claude Code's hook contract, and the dual rdv/curl fallback provides good resilience.
However, there are 12 concrete issues across 5 areas that reduce reliability:

- Server-side error handling silently allows stop on DB failures
- No retry logic in Rust for transient network issues
- SessionEnd hook handler exists but is never triggered
- Hook marker matching could strip user hooks
- stableId hash is collision-prone

## Worktree A: Terminal Server Hardening

**Branch**: `fix/stop-check-server-hardening`
**Items**: #1, #2

### Files to modify:
- `src/server/terminal.ts`

### Changes:

1. **Fix agent-stop-check error handling** (Critical, #1)
   - Lines 693-702: On `checkTasksOnStop()` error, currently returns `{ message: null }` (allows stop)
   - Change to return an error message: `{ message: "Unable to verify task completion. Please run TaskList to check your tasks before stopping." }`
   - The Rust client already handles non-empty messages by printing to stdout, so this will work

2. **Add localhost restriction for agent endpoints** (High, #2)
   - Add `/internal/agent-status`, `/internal/agent-exit`, `/internal/notify` to the localhost check
   - Group all `/internal/*` endpoints under a single localhost guard

## Worktree B: Rust Stop Hook Robustness

**Branch**: `fix/stop-hook-rust-retry`
**Items**: #3, #4

### Files to modify:
- `crates/rdv/src/commands/hook.rs`

### Changes:

1. **Add retry for stop-check** (High, #3)
   - In `handle_stop()`, if `/internal/agent-stop-check` fails with network error, retry once after 500ms
   - Only retry on connection errors, not on HTTP 4xx/5xx (those are definitive)
   - Keep the fallback message if retry also fails

2. **Support text/plain response** (Medium, #4)
   - The stop-check endpoint supports `Accept: text/plain` (used by curl fallback)
   - The Rust client uses `post_empty_with_query` which expects JSON
   - This works fine — the endpoint returns JSON by default. No change needed here.
   - Instead, improve the error fallback message to be more actionable

## Worktree C: Hook Installation Improvements

**Branch**: `fix/hook-installation-improvements`
**Items**: #5, #9, #10

### Files to modify:
- `src/services/agent-profile-service.ts`

### Changes:

1. **Add SessionEnd hook** (High, #5)
   - Add SessionEnd hook entry to `installAgentHooks()` after the Stop hook
   - Command: `rdvOrCurlCommand("rdv hook session-end", curlForStatus("ended"))`
   - Timeout: 10s
   - No matcher needed (fires on all session ends)

2. **Improve hook marker matching** (Medium, #9)
   - Replace `JSON.stringify(entry).includes(marker)` with a more specific check
   - Check only the `command` field of hook entries, not the entire serialized object
   - This prevents false matches on user hooks that happen to contain marker substrings in descriptions or other fields

3. **Quote shell variables in curl fallback** (Medium, #10)
   - In `curlCmd()`, quote `$RDV_TERMINAL_SOCKET` and `$RDV_TERMINAL_PORT`
   - Use double quotes around variable references in the generated shell

## Worktree D: Session Service Validation

**Branch**: `fix/hook-validation-notification`
**Items**: #6

### Files to modify:
- `src/services/session-service.ts`

### Changes:

1. **Create notification on validation failure** (Medium, #6)
   - In `ensureAgentConfig()`, when validation fails, create a notification via NotificationService
   - Keep it fire-and-forget (don't block session creation), but ensure the user is notified
   - Message: "Agent hooks validation failed for session — hooks may not report status correctly"

## Worktree E: Task Sync Robustness

**Branch**: `fix/task-sync-stableid-collisions`
**Items**: #7, #8, #12

### Files to modify:
- `src/services/agent-todo-sync-pure.ts`
- `src/services/__tests__/agent-todo-sync.test.ts`
- `src/services/agent-todo-sync.ts`

### Changes:

1. **Replace 32-bit hash with FNV-1a 52-bit** (Medium, #7)
   - Replace `stableId()` with FNV-1a hash using 52-bit output (safe for JS number precision)
   - Output format: `cc-{base36}` (longer but collision-resistant)
   - Existing `cc-` prefixed keys in DB remain compatible (lookup is by exact match)

2. **Add stableId collision tests** (Medium, #8)
   - Test that similar subjects produce different IDs
   - Test that same subject produces same ID (determinism)
   - Test common task name patterns (numbered steps, prefixed tasks)

3. **Fix post-task dedup description check** (Low, #12)
   - In `checkTasksOnStop()` line 248: `t.description?.startsWith(postTaskKey)` is vestigial
   - Post-tasks are now created with `agentTaskKey` set, so the description fallback is dead code
   - Remove the description-based dedup since agentTaskKey is the canonical mechanism

## Worktree F: Plugin Hooks Cleanup

**Branch**: `fix/plugin-hooks-cleanup`
**Items**: #11

### Files to modify:
- `hooks/hooks.json`

### Changes:

1. **Remove redundant session-start PreToolUse hook** (Low, #11)
   - The empty-matcher PreToolUse entry runs `rdv hook claude session-start` on every tool use
   - The Bash-matcher PreToolUse entry already runs `rdv hook pre-tool-use` for Bash tools
   - These are redundant — both ultimately call `report_status("running")`
   - Keep only the Bash-matcher entry (which also does git identity guard)
   - Add a non-Bash catch-all with just status reporting if needed

## Expected Commits per Worktree

- **A**: `fix: return error message from agent-stop-check on failure` + `fix: restrict all /internal/* endpoints to localhost`
- **B**: `fix: add retry logic for stop-check in rdv hook stop`
- **C**: `feat: install SessionEnd hook for agent sessions` + `fix: improve hook marker matching specificity` + `fix: quote shell variables in curl fallback hooks`
- **D**: `fix: create notification on hook validation failure`
- **E**: `fix: replace stableId 32-bit hash with FNV-1a 52-bit` + `test: add stableId collision resistance tests` + `fix: remove vestigial description-based post-task dedup`
- **F**: `fix: clean up redundant plugin PreToolUse hook entry`
