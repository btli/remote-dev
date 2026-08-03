# Codex Lifecycle Status and Notifications — Implementation Plan

**Date:** 2026-08-03
**Issue:** `remote-dev-dexs`
**Spec:** `docs/plans/2026-08-03-codex-lifecycle-notifications-spec.md`

## Goal

Make Codex lifecycle reporting as reliable and visible as Claude reporting without copying Claude-specific hook assumptions. All native hooks, compatibility notifications, tmux exits, and liveness findings must converge on one durable, idempotent lifecycle service before they mutate session state or create notifications.

## Execution Rules

- Use test-driven development for each task: add the failing fixture/test, run it, implement the smallest slice, and rerun the focused test before broader gates.
- Keep the implementation behind `RDV_CODEX_HOOKS_ENABLED` until the live smoke gate passes.
- Preserve all user-authored hook entries and existing Claude behavior.
- Do not edit generated schema files by hand. Change `src/db/schema.def.ts`, run `bun run db:codegen`, commit all three generated schema files, and generate the PostgreSQL migration through the repository workflow.
- Use `createLogger`; do not log raw hook input.
- Do not enable Codex hook trust bypass automatically.

## Build Sequence

1. Normalized contract, official payload fixtures, and transition tests.
2. Provider hook adapters and safe Codex `hooks.json` installation.
3. Provider-aware Rust hook bridge and output codecs.
4. Durable lifecycle service, schema, endpoint, status broadcasts, and notification policy.
5. Authoritative tmux exit and liveness convergence.
6. Runtime health, trust diagnostics, resume/repair behavior, and UI visibility.
7. Compatibility fallback, end-to-end tests, documentation, and staged rollout.

---

## Task 1 — Lifecycle Contract and Codex Fixture Matrix

**Create**

- `src/types/agent-lifecycle.ts`
- `src/lib/agent-lifecycle/validate.ts`
- `src/lib/agent-lifecycle/idempotency.ts`
- `src/lib/agent-lifecycle/__tests__/validate.test.ts`
- `src/lib/agent-lifecycle/__tests__/idempotency.test.ts`
- `tests/fixtures/codex-hooks/session-start.json`
- `tests/fixtures/codex-hooks/user-prompt-submit.json`
- `tests/fixtures/codex-hooks/pre-tool-use.json`
- `tests/fixtures/codex-hooks/pre-tool-use-request-user-input.json`
- `tests/fixtures/codex-hooks/permission-request.json`
- `tests/fixtures/codex-hooks/post-tool-use.json`
- `tests/fixtures/codex-hooks/pre-compact.json`
- `tests/fixtures/codex-hooks/post-compact.json`
- `tests/fixtures/codex-hooks/subagent-start.json`
- `tests/fixtures/codex-hooks/subagent-stop.json`
- `tests/fixtures/codex-hooks/stop.json`
- `tests/fixtures/codex-hooks/session-end.json`

**Modify**

- `src/types/terminal-type.ts`
- `src/server/agent-status-ordering.ts`
- `src/server/__tests__/agent-status-ordering.test.ts`

### Steps

1. Define `AgentLifecycleEventV1`, event kinds, sources, hook-health states, and a discriminated validation result.
2. Add a strict normalized-envelope validator that:
   - accepts only lifecycle V1 fields produced by the local provider adapters
   - rejects bodies above a bounded size
   - strips control characters and caps previews
   - rejects caller-supplied dedupe keys and never carries raw tool input/output
3. Add server-derived idempotency builders for delivery, turn, tool, notification, session, and process-exit events. Use delivery identity plus notification coalescing for `PermissionRequest`, whose current schema has no stable request id.
4. Build fixtures from the current documented Codex fields. Keep them hand-authored and minimal so upstream field additions do not create brittle snapshots.
5. Record `tool_use_id` where supplied, and map verified question tools such as `request_user_input` to attention in the Rust provider normalizer rather than racing a second hook against generic `PreToolUse`.
6. Extend ordering tests for process generations, terminal error/end states, new-turn recovery, waiting-to-running, duplicate events, and subagent completion.

### Focused gate

```bash
bun run test:run src/lib/agent-lifecycle src/server/__tests__/agent-status-ordering.test.ts
```

Expected: valid envelopes pass, caller-controlled dedupe fields and malformed/oversized bodies fail closed, and ordering/idempotency rules are deterministic without exposing raw content. Provider-to-envelope mapping is proven in Task 3 against the same fixtures.

---

## Task 2 — Provider Hook Adapters and Safe Codex Installation

**Create**

- `src/services/agent-hooks/types.ts`
- `src/services/agent-hooks/claude-adapter.ts`
- `src/services/agent-hooks/codex-adapter.ts`
- `src/services/agent-hooks/codex-config-inspector.ts`
- `src/services/agent-hooks/agent-hook-service.ts`
- `src/services/agent-hooks/__tests__/codex-adapter.test.ts`
- `src/services/agent-hooks/__tests__/codex-config-inspector.test.ts`
- `src/services/agent-hooks/__tests__/agent-hook-service.test.ts`

**Modify**

- `src/services/agent-profile-service.ts`
- `src/services/session-service.ts`
- `src/services/session-service-plugin-dispatch.test.ts`
- `src/services/session-service-update.test.ts`
- `src/services/__tests__/session-service-provider-resolution.test.ts`
- `src/types/agent-config.ts`
- `package.json`
- `bun.lock`

### Steps

1. Extract existing Claude hook construction/merge behavior behind an adapter without changing the emitted `.claude/settings.json` shape.
2. Remove the `provider !== "claude"` early return from `ensureAgentConfig()` and dispatch through an adapter registry.
3. Implement the Codex adapter at `<resolved CODEX_HOME>/hooks.json` with the mapping in the spec. Resolve from the final launch environment once; profile, explicit `CODEX_HOME`, HOME fallback, create, and resume paths must agree.
4. Use commands with one stable Remote Dev marker and config version, for example:

   ```text
   rdv hook lifecycle codex permission-request --config-version 1
   ```

   The command reads provider JSON on stdin; no provider field is shell-interpolated.
5. Preserve user entries and unknown top-level keys. Replace only exact Remote Dev-owned entries.
6. Treat invalid JSON as `config_error`; do not overwrite it.
7. Write through a same-directory temp file and atomic rename, retain restrictive mode, and skip semantic no-op writes.
8. Add uninstall/repair helpers that touch only Remote Dev entries.
9. Cache the result of `codex --version` plus `codex features list` for a short process-local interval. Mark missing/disabled hooks as unsupported.
10. Keep the current `rdv hook validate` connectivity check, but report it as connectivity—not runtime health.
11. Use a real TOML parser to inspect active user/profile config layers without rewriting them. Preserve inline `[hooks]`; because Codex loads those alongside `hooks.json`, expose its same-layer dual-source warning in diagnostics and reuse this inspector for the Task 7 `notify` fallback guard.

### Required tests

- empty config install
- user hook preservation for every overlapping event
- existing Remote Dev version replacement without duplication
- invalid JSON left unchanged
- simultaneous install calls converge on one valid file
- no-op install preserves mtime/content
- isolated profile, explicit `CODEX_HOME`, and HOME fallback paths
- inline TOML hooks remain byte-identical and produce a non-fatal diagnostic
- create and resume both invoke the Codex adapter with the active config root
- Claude output fixture remains byte-equivalent after extraction

### Focused gate

```bash
bun run test:run src/services/agent-hooks src/services/session-service-plugin-dispatch.test.ts src/services/session-service-update.test.ts src/services/__tests__/session-service-provider-resolution.test.ts
```

---

## Task 3 — Provider-aware `rdv` Hook Bridge

**Modify**

- `crates/rdv/src/commands/hook.rs`
- `crates/rdv/src/commands/mod.rs`
- `crates/rdv/src/client.rs` if the normalized endpoint needs a typed helper
- `docs/RDV_CLI.md`

**Create**

- `crates/rdv/tests/hook_lifecycle.rs`

### Steps

1. Add a provider-neutral command surface:

   ```text
   rdv hook lifecycle <provider> <event> --config-version <n>
   ```

2. Read stdin once with a hard byte cap. Parse defensively and normalize documented Claude/Codex fields into the V1 envelope.
3. Generate one `deliveryId` per callback invocation and reuse the same serialized envelope across the client's HTTP retries. Derive `rdvSessionId` from `RDV_SESSION_ID`; never accept a replacement from stdin.
4. POST the envelope to `/internal/agent-lifecycle` through the existing Unix-socket/port client.
5. Separate reporting from provider output encoding:
   - ordinary hooks: exit `0`, no output
   - Claude Stop continuation: preserve current behavior
   - Codex Stop/SubagentStop continuation: documented JSON or exit `2` stderr
6. Preserve the beads unfinished-work guard, peer check-in/out, git identity guard, and git-push broadcast, but invoke them from normalized event handlers so each side effect runs at most once per event key. For Stop, run the unfinished-work guard before emitting `turn_completed`; a blocked stop emits/retains `running` and returns the provider-specific continuation output.
7. Treat server/reporting failure as fail-open for the agent loop and emit a concise stderr diagnostic. Never print raw JSON.
8. Keep legacy `rdv hook pre-tool-use`, `notification`, `stop`, and `claude` commands as compatibility wrappers until generated Claude hooks migrate.

### Required tests

- every Codex fixture produces the expected endpoint envelope
- no-output success for Codex Stop/SubagentStop
- valid Codex continuation JSON for unfinished beads
- Claude continuation output unchanged
- oversized/malformed stdin cannot panic or leak payload
- absent `RDV_SESSION_ID` is a visible validation failure but does not block an ordinary agent turn
- transport retries reuse one delivery id; separate provider callbacks do not accidentally share one

### Focused gate

```bash
cargo test --manifest-path crates/rdv/Cargo.toml hook_lifecycle
cargo test --manifest-path crates/rdv/Cargo.toml
```

---

## Task 4 — Durable Lifecycle Service and Notifications

**Create**

- `src/services/agent-lifecycle-service.ts`
- `src/services/__tests__/agent-lifecycle-service.test.ts`
- `src/services/agent-lifecycle-outbox-service.ts`
- `src/services/__tests__/agent-lifecycle-outbox-service.test.ts`
- `src/server/agent-lifecycle-handler.ts`
- `src/server/__tests__/agent-lifecycle-handler.test.ts`

**Modify**

- `src/db/schema.def.ts`
- generated `src/db/schema.ts`
- generated `src/db/schema.sqlite.ts`
- generated `src/db/schema.pg.ts`
- new PostgreSQL migration under `drizzle/pg/`
- `src/server/terminal.ts`
- `src/services/notification-service.ts`
- `src/services/notification-preferences-service.ts`
- `src/lib/notification-policy.ts`
- `src/types/notification.ts`
- `src/services/__tests__/notification-service.test.ts`
- `src/lib/__tests__/notification-policy.test.ts`

### Schema

1. Add `agentLifecycleEvents` with the delivery/idempotency constraints in the spec.
2. Add `agentLifecycleOutbox` with a deterministic unique intent key, state, lease expiry, attempt count, next-attempt time, completion time, and bounded last error. Add a nullable unique notification `dedupeKey` for exact lifecycle replay.
3. Add terminal-session health fields:
   - `agentHookHealth`
   - `agentHookHealthReason`
   - `agentHookConfigVersion`
   - `agentHookLastSeenAt`
4. Add indexes for session/received time, provider/kind, pending outbox age, and hook health.
5. Add a 30-day boundary-event prune to the existing cleanup loop while retaining active-session/current-generation records. Completed outbox rows may be pruned; pending rows may not.
6. Regenerate both dialect schemas and generate the PostgreSQL migration. SQLite development is push-based; do not invent a hand-written SQLite migration:

   ```bash
   bun run db:codegen
   bun run db:generate:pg
   ```

### Service behavior

1. Validate the session, provider, lifecycle kind, event version, and process generation.
2. In one transaction:
   - insert the lifecycle event under its unique key
   - return early on duplicate
   - apply ordering/source-precedence rules
   - update exit/activity/hook-health fields
   - insert deterministic status/metadata/notification outbox intents
3. After commit:
   - run a bounded inline outbox drain
   - broadcast `agent_activity_status` with `statusAt`
   - refresh session metadata
   - create/broadcast the exact-deduped notification when required
4. Drain pending intents again on terminal-server startup and on a bounded periodic sweep. Use backoff and surface terminal failures in integration health; never block hook completion on downstream delivery.
5. Make `/internal/agent-lifecycle` a thin parsing/response adapter around the service.
6. Keep `/internal/agent-status` temporarily as a legacy adapter that creates a normalized Claude event. Remove its duplicated DB/notification logic only after parity tests pass.

### Notification behavior

- `attention_required` → `agent_waiting`, actionable, session deep link
- non-zero `process_exited` → `agent_error`, error
- `turn_completed` → `agent_complete`, passive
- zero `process_exited`/clean session end → `agent_exited`, passive
- all other lifecycle kinds → no durable notification

Change `pushByType` handling to tri-state: explicit `true` may push passive types while absent still obeys `minPushSeverity`. Session mute, quiet hours, and type `false` remain authoritative.

### Required tests

- event insert and status write are atomic
- duplicate event produces no new status broadcast/notification
- crash after commit leaves pending intents that replay exactly once after restart
- concurrent outbox drainers lease safely and cannot duplicate a durable notification; abandoned leases are recoverable
- delayed and older-generation events are stored as rejected but do not mutate state
- new turn can move idle/waiting to running
- subagent completion cannot resurrect terminal state
- waiting/error/complete map to correct severity and type
- completion explicit opt-in overrides severity floor; absent does not
- focused/muted behavior remains unchanged
- endpoint rejects provider/session mismatch and raw oversized bodies
- retention prunes old inactive events without deleting active/current-generation health evidence

### Focused gate

```bash
bun run test:run src/services/__tests__/agent-lifecycle-service.test.ts src/services/__tests__/agent-lifecycle-outbox-service.test.ts src/server/__tests__/agent-lifecycle-handler.test.ts src/services/__tests__/notification-service.test.ts src/lib/__tests__/notification-policy.test.ts
bun run db:check-drift
```

---

## Task 5 — Authoritative tmux Exit and Liveness Backstop

**Modify**

- `src/services/session-service.ts`
- `src/services/tmux-service.ts` if hook formatting needs a typed helper
- `src/server/terminal.ts`
- `src/services/session-liveness-service.ts`
- `src/services/__tests__/session-liveness-service.test.ts`
- `src/services/__tests__/tmux-service.test.ts`
- `src/services/__tests__/session-durability.integration.test.ts`

### Steps

1. Install `pane-exited` with the tmux `#{pane_dead_status}` format value and a stable process generation derived from the session restart generation.
2. Make `/internal/agent-exit` normalize and delegate to `AgentLifecycleService`.
3. Persist `agentExitState`, real exit code, exit time, and activity status before broadcasting.
4. Emit one error notification for non-zero exit and one passive exit record for zero exit.
5. Deduplicate the tmux hook, PTY callback, native SessionEnd, and liveness sweep by process generation/event key.
6. Route liveness findings through the service. Only use `agent_stuck` when the exit code is unknown and death is independently confirmed.
7. Ensure suspend/close/restart intentional exits do not create false error notifications.

### Required tests

- tmux hook command includes an escaped `pane_dead_status`
- detached non-zero exit persists error and notifies
- zero exit persists ended/passive state
- duplicate callbacks produce one event/notification
- intentional suspend/close is silent
- restart generation permits a new running state and rejects the previous generation
- liveness sweep remains exactly-once at the user-notification layer

### Focused gate

```bash
bun run test:run src/services/__tests__/session-liveness-service.test.ts src/services/__tests__/tmux-service.test.ts src/services/__tests__/session-durability.integration.test.ts
```

---

## Task 6 — Runtime Handshake, Trust Diagnostics, and UI Visibility

**Create**

- `src/app/api/sessions/[id]/agent-lifecycle/route.ts`
- `src/app/api/sessions/[id]/agent-lifecycle/route.test.ts`
- `src/components/agents/AgentLifecycleHealth.tsx`
- `src/components/agents/AgentLifecycleHealth.test.tsx`

**Modify**

- `src/services/agent-hooks/agent-hook-service.ts`
- `src/services/session-service.ts`
- `src/services/session-metadata-service.ts`
- `src/types/session-metadata.ts` or the existing metadata type source
- `src/components/session/SessionMetadataBar.tsx`
- `src/components/agents/AgentCLIStatusPanel.tsx`
- `src/components/agents/index.ts`
- `src/services/__tests__/session-metadata-parsers.test.ts`

### Steps

1. Mark hook health `awaiting_handshake` after a successful static install/connectivity validation.
2. Have `SessionStart` carry the generated config version; a current native event marks the active generation healthy.
3. Run a bounded post-launch/resume check. If no handshake arrives, mark stale/degraded and create one coalesced integration notification.
4. Do not claim a trust failure without evidence. Remediation should say that trust is a likely cause and direct the user to Codex `/hooks`.
5. Expose read-only diagnostics: active config path, Codex version, hooks feature state, desired/installed config version, connectivity result, last event, health reason, and remediation.
6. Show compact health state in session metadata and the Agents settings panel. Do not add a permanent toast loop.
7. Add a “repair config” action that reruns the safe merge/validation. It must not alter trust state.

### Required tests

- valid config/connectivity without event is not labeled healthy
- current SessionStart handshake becomes healthy
- old config version becomes repair-needed
- timeout creates one notification, not one per poll
- resume refreshes config and resets generation/handshake
- diagnostics never return env secrets or raw hook payload
- repair preserves user hooks

### Focused gate

```bash
bun run test:run src/app/api/sessions/[id]/agent-lifecycle/route.test.ts src/components/agents/AgentLifecycleHealth.test.tsx src/services/__tests__/session-metadata-parsers.test.ts
```

---

## Task 7 — Completion Fallback, End-to-end Gates, Docs, and Rollout

**Create**

- `scripts/smoke-codex-hooks.ts`
- `src/services/agent-hooks/__tests__/codex-real-smoke.test.ts` (environment-gated)

**Modify**

- `src/services/agent-hooks/codex-adapter.ts`
- `src/lib/terminal-plugins/agent-utils.ts`
- `src/components/settings/sections/ProjectSection.tsx` or a dedicated notification settings surface
- `docs/AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/RDV_CLI.md`
- `CHANGELOG.md`

### Steps

1. Add the documented `notify` completion fallback only when native hooks are unsupported and a real TOML parser proves every resolvable active user/profile layer has no user `notify` command. Inject it with a per-session `-c notify=...` launch override; never rewrite `config.toml`. On parse/layer ambiguity, preserve user behavior and report degraded health because the fallback cannot safely be installed or cover approvals/running state.
2. Normalize `thread-id` and `turn-id` to the same completion idempotency key as native `Stop`.
3. Add a notification preference control for passive completion push. Keep default server push off; existing background browser completion remains on under the current Agent notifications toggle.
4. Create a generated-config smoke script that:
   - uses a temporary `CODEX_HOME`
   - installs hooks through the real adapter
   - invokes every generated command with official fixtures
   - asserts lifecycle rows/statuses/notifications against a test server
5. Add an opt-in real-Codex smoke (`RDV_CODEX_HOOK_SMOKE=1`) that verifies `SessionStart`, `UserPromptSubmit`, `PermissionRequest` where feasible, and `Stop` against the installed CLI. Do not run it by default or require model credentials in ordinary CI.
6. Update provider documentation from “Codex has no hooks/manual pull” to the actual capability and health model.
7. Document hook trust review, repair, feature flag rollback, log/metric locations, and fallback limitations.
8. Enable `RDV_CODEX_HOOKS_ENABLED` by default only after the smoke evidence is recorded in the issue.

### Focused gate

```bash
bun run scripts/smoke-codex-hooks.ts
RDV_CODEX_HOOK_SMOKE=1 bun run test:run src/services/agent-hooks/__tests__/codex-real-smoke.test.ts
```

The second command is a release/manual gate and may be skipped in CI with the skip reason recorded.

---

## Full Quality Gates

Run from the repository root:

```bash
bun run db:codegen
bun run db:check-drift
bun run typecheck
bun run lint
bun run test:run
cargo fmt --manifest-path crates/rdv/Cargo.toml --check
cargo clippy --manifest-path crates/rdv/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/rdv/Cargo.toml
bun run build
```

Then run the generated-config smoke and, before default enablement, the gated real-Codex smoke.

## Rollout Checklist

- [ ] Feature flag defaults off in the first merge.
- [ ] Existing Claude hook fixture is unchanged.
- [ ] User Codex hook preservation is demonstrated with fixtures.
- [ ] A detached non-zero Codex exit produces one durable error notification.
- [ ] Approval, completion, and restart/resume scenarios pass end to end.
- [ ] A deliberately untrusted hook produces handshake-degraded health and `/hooks` remediation without asserting an unproven cause.
- [ ] Metrics/logs distinguish config, connectivity, handshake, stale, and process-exit failures.
- [ ] Live Codex smoke evidence is attached to `remote-dev-dexs`.
- [ ] Feature flag default flips only after smoke evidence.

## Handoff

Implementation should start with Task 1 and Task 2 in an isolated worktree. Do not begin with the UI or by copying the Claude hook object into Codex config; the wire contract and safe merge behavior are the compatibility boundary for every later task.
