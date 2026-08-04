# Codex Lifecycle Status and Notifications — Specification

**Date:** 2026-08-03
**Status:** Phase 1 implemented in PR #454; durable outbox/health UI remain follow-up work
**Issue:** `remote-dev-dexs`
**Implementation plan:** `docs/plans/2026-08-03-codex-lifecycle-notifications-plan.md`

## Summary

Before this change, Remote Dev treated Codex as a first-class agent at launch and resume time, but not at lifecycle time. Hook installation and validation explicitly returned early for every provider except Claude. As a result, a Codex session could not tell Remote Dev that a turn started, needed approval, was compacting, completed, or ended.

The fix is not a Codex-only collection of callbacks. Remote Dev should introduce one provider-neutral lifecycle ingestion path, adapt Claude and Codex payloads into that contract, and make tmux process exit an authoritative fallback. Lifecycle events must be durable, idempotent, ordered, observable, and safe to deliver more than once.

Codex native hooks are the primary signal. The installed `codex-cli 0.146.0` reports the `hooks` feature as `stable true`, and the current Codex documentation defines `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, and `SessionEnd`. Codex `notify` supports only `agent-turn-complete`; it is therefore a compatibility fallback, not the lifecycle transport.

## Evidence and Root Causes

### 1. Codex is deliberately skipped

- `src/services/session-service.ts:2042` returns from `ensureAgentConfig()` unless the provider is `claude`.
- `src/services/agent-profile-service.ts:741` returns from `installAgentHooks()` unless the provider is `claude`.
- `src/services/agent-profile-service.ts:913` treats every non-Claude provider as valid without inspecting or installing anything.
- `docs/AGENTS.md` consequently documents Codex as manual-pull only and says non-Claude providers have no hook system.

That documentation matched the old implementation, but it is no longer true of current Codex.

### 2. Claude and Codex lifecycle names are not interchangeable

Claude uses a `Notification` hook with matchers such as `permission_prompt`. Codex has no `Notification` lifecycle event; it uses `PermissionRequest`. Copying the Claude hook map would silently miss the exact attention state the user needs.

Codex also requires successful `Stop` and `SubagentStop` hooks to emit valid JSON or no output. The current `rdv hook stop` path may print plain continuation text for unfinished beads work. That is valid for the current Claude flow but invalid for Codex and must be encoded per provider.

### 3. Process exit is not a durable error path

The old tmux `pane-exited` callback called `/internal/agent-exit` without a
reliable status or signal. The endpoint broadcast an `agent_exited` message only
to attached clients; it did not persist the status through `markAgentExited()`,
broadcast `agent_activity_status`, or create an error/completion notification.

Consequences:

- A detached client misses the exit entirely.
- A non-zero agent exit can remain represented as a stale running state.
- The liveness sweep can only infer that a process vanished; it cannot reliably distinguish success from failure.

### 4. Installation checks do not prove runtime delivery

The existing validation checks that `rdv` and the servers are reachable. It does not prove that the agent loaded the hook configuration, that the hook was trusted, or that a lifecycle event actually arrived. A valid file can still be silently skipped by Codex hook trust.

### 5. Remote Dev already has the desired client behavior

`useAgentNotifications()` already maps `waiting`, `idle`, `error`, `compacting`, and `ended` status changes to browser notifications when the document is in the background. The Project settings copy already promises notifications when agents finish, need input, or encounter errors. Codex does not satisfy that promise because it never produces the status changes.

## Goals

1. Report Codex activity in real time using the existing statuses: `running`, `subagent`, `compacting`, `waiting`, `idle`, `error`, and `ended`.
2. Deliver one durable, actionable notification when Codex needs approval or input.
3. Deliver one durable error notification for an unrecovered non-zero agent-process exit, even when no client is attached.
4. Represent turn completion as `idle` plus a durable passive `agent_complete` event, enabling existing background browser notifications and optional server push.
5. Preserve user-authored Claude and Codex hooks during install, upgrade, repair, and uninstall.
6. Detect unsupported, invalid, unreachable, unhandshaken, and configuration-drift states rather than reporting false health; when trust cannot be inspected directly, present it as a likely remediation instead of a diagnosed fact.
7. Keep Claude behavior compatible while moving shared state, deduplication, ordering, and notification logic into one lifecycle service.
8. Make retries and duplicate delivery safe across process restarts.

## Non-goals

- Full lifecycle parity for Gemini, OpenCode, or Antigravity in this issue.
- Migrating the interactive terminal from the Codex CLI to Codex App Server.
- Parsing terminal prose, transcript files, or undocumented escape-sequence text as the primary signal.
- Automatically editing Codex hook trust state or enabling `--dangerously-bypass-hook-trust`.
- Persisting prompts, tool arguments, tool output, or full assistant messages in lifecycle rows.
- Treating every failed tool call as an agent failure. Agents frequently recover from tool errors inside a turn.

The current stable hook surface also has no structured “turn failed” event. This phase guarantees process-exit errors, hook-integration errors, and explicit attention states. A recoverable provider/model error that leaves the Codex TUI alive remains visible in the terminal but cannot be classified reliably without adopting the Codex App Server event stream; the UI and docs must state that boundary.

## User Experience Contract

| Situation | Live state | Durable notification | Browser / push behavior |
|---|---|---|---|
| Session or user turn starts | `running` | None | No alert; sidebar/progress only |
| Subagent is active | `subagent` | None | No alert |
| Context compaction starts | `compacting` | None | Existing browser behavior may show it; no server push |
| Compaction finishes | `running` | None | No alert |
| Codex asks for approval | `waiting` | `agent_waiting`, actionable | Notify when target session is not focused; coalesce repeats |
| Tool finishes and Codex continues | `running` | None | No alert |
| Turn finishes cleanly | `idle` | `agent_complete`, passive | Existing background browser notification; server push only when explicitly enabled |
| Codex process exits non-zero | `error` | `agent_error`, error | Notify even with no attached client, subject to user mute/type preferences |
| Codex process exits zero | `ended` | `agent_exited`, passive | Store in panel; no default server push |
| Hook integration has no runtime handshake | Preserve last trustworthy state | One coalesced integration error | Link to diagnostics and `/hooks` trust instructions |

“Working” is a state, not a notification. Sending a push for every running transition would create noise and make retries visible to the user.

## Architecture

```text
Claude/Codex native hook     Codex notify fallback     tmux pane exit/liveness
            \                       |                         /
             `----- lifecycle adapters and normalizer -------'
                                  |
                    POST /internal/agent-lifecycle
                                  |
                    AgentLifecycleService transaction
                    - validate provider/session
                    - insert idempotency key
                    - apply ordering/source precedence
                    - persist status + hook health
                    - enqueue deterministic delivery intents
                                  |
                       lifecycle outbox drainer
                                  |
             +--------------------+---------------------+
             |                    |                     |
       WebSocket status   NotificationService   lifecycle diagnostics
```

All sources converge before state mutation or notification creation. No adapter may write `terminal_session.agent_activity_status` directly.

## Normalized Lifecycle Contract

The Rust CLI creates normalized envelopes for native hook and `notify` callbacks. Server-side tmux, liveness, and integration-health adapters create the same shape. Hook callbacks get the Remote Dev session identity from trusted process environment, not from provider-controlled stdin.

```ts
type AgentLifecycleKind =
  | "session_started"
  | "turn_started"
  | "running"
  | "subagent_started"
  | "subagent_finished"
  | "compaction_started"
  | "compaction_finished"
  | "attention_required"
  | "turn_completed"
  | "session_ended"
  | "process_exited"
  | "hook_health";

interface AgentLifecycleEventV1 {
  version: 1;
  deliveryId: string;
  rdvSessionId: string;
  provider: "claude" | "codex";
  kind: AgentLifecycleKind;
  source:
    | "native_hook"
    | "notify_fallback"
    | "tmux_exit"
    | "liveness"
    | "integration";
  providerSessionId?: string;
  turnId?: string;
  providerEventId?: string;
  providerEvent?: string;
  processGeneration?: number;
  exitCode?: number | null;
  occurredAt: string;
  details?: {
    toolName?: string;
    reason?: string;
    configVersion?: number;
    messagePreview?: string;
  };
}
```

Constraints:

- `rdvSessionId` must match an existing agent/loop session.
- The session provider must match `provider`.
- `deliveryId` is generated once per hook/process callback and reused for every transport retry of that callback.
- String fields are length-capped and control characters are removed.
- `messagePreview` is optional, redacted, and capped at 280 characters. It is not used as an idempotency key.
- `reason` and `messagePreview` may contain only Remote Dev-authored process/integration summaries, never prompt or tool-input content.
- Raw provider payloads are never stored in the database or notification metadata.
- The server derives canonical event and notification keys from validated fields; it never trusts a caller-supplied dedupe key.
- Unknown event versions and kinds return `400`; an unknown session returns `404`.

## Durable Idempotency and Ordering

> **Phase 1 implementation note.** The complete normalized lifecycle ledger and
> leased outbox below remain the target design tracked in follow-up issues. PR
> #454 implements the immediately required guarantees with two smaller
> transactional receipt tables (`agent_status_delivery` and
> `notification_delivery`) plus `terminal_session.agent_exit_notification_at`
> as durable pending intent. Status state and its receipt commit atomically;
> exact retries can repair downstream notification storage without rewriting or
> rebroadcasting stale state. Pending exit intent has no replay age cutoff, while
> completed delivery receipts are retained for 30 days. PostgreSQL serializes
> the empty coalescing-group boundary with a transaction advisory lock.

Add an `agent_lifecycle_event` table with unique `(session_id, delivery_id)` and `(session_id, idempotency_key)` constraints. The table stores only the normalized, sanitized boundary event and its processing outcome. `delivery_id` absorbs transport retries; the server-derived idempotency key absorbs callbacks that have stable provider identity.

Suggested columns:

- `id`, `session_id`, `provider`, `kind`, `source`
- `provider_session_id`, `turn_id`, `provider_event_id`, `process_generation`
- `delivery_id` and server-derived `idempotency_key` (unique per Remote Dev session)
- `status_applied`, `notification_id`, `exit_code`
- `occurred_at`, `received_at`
- bounded `details` JSON

Boundary events are retained for 30 days by the existing terminal-server cleanup loop, with the newest event and current-generation health record always retained for active sessions. This prevents an unbounded audit table without deleting state needed for reconciliation.

Idempotency keys are deterministic where the provider exposes stable identity:

- Turn start/complete: provider + provider session + turn id + lifecycle kind.
- True session start/end: provider + provider session + event kind + process generation. Compaction callbacks use turn identity when available and otherwise fall back to delivery identity so later compactions are not collapsed.
- Process exit: Remote Dev session + process generation + exit kind.
- Tool callbacks: provider session + turn id + `tool_use_id` when Codex supplies it.
- `PermissionRequest` currently has no provider request id. Its ledger key therefore uses `deliveryId`; the user-facing notification uses a bounded `(session, turn, attention)` coalesce key. Do not hash or retain `tool_input` merely to manufacture identity.

The current arrival-time guard remains useful but is extended with source and generation rules:

1. Duplicate event keys are acknowledged without repeating a write or notification.
2. Events from an older process generation never overwrite the current generation.
3. `process_exited(error)` and `session_ended` are terminal within a generation.
4. `subagent_finished` may replace only an active `running` or `subagent` state;
   it cannot clear `waiting`, `compacting`, `idle`, `error`, or `ended`.
5. A new `turn_started` with a new turn id may transition `idle` or `waiting` back to `running`.
6. `running` from `PostToolUse` may clear `waiting` only within the same active turn.
7. Provider `occurredAt` is diagnostic only; server `receivedAt` remains the ordering clock.

The event insert and session-state update happen in one database transaction. That transaction also inserts deterministic lifecycle outbox intents for status broadcast, metadata refresh, and durable notification creation. A fast inline drainer runs after commit, and a startup/periodic drainer retries pending intents after crashes. The notification service accepts an exact `dedupeKey`, backed by a unique nullable column, so replay cannot create a second row. An outbox item is complete only after the durable notification row exists; WebSocket reconnect still reconciles from persisted session state.

The `agent_lifecycle_outbox` table contains the lifecycle event id, intent kind, deterministic intent key, `pending|processing|delivered|failed` state, lease expiry, attempt count, next-attempt time, bounded last error, and timestamps. Workers claim with a lease so an abandoned `processing` row becomes retryable. Notification dedupe keys are source-independent:

- completion: Remote Dev session + provider session + turn + `complete`
- attention: Remote Dev session + turn + `attention`
- exit/end: Remote Dev session + process generation + exit class
- integration health: Remote Dev session + process generation + config version + health class

This deliberately permits harmless repeated WebSocket delivery while preventing repeated durable notification rows. Clients already reject stale status by `statusAt` and reconcile current state after reconnect.

External push providers cannot prove that a device displayed a notification. This phase guarantees the durable panel event, background browser state, and an observable push attempt under existing notification policy; it does not claim end-device exactly-once delivery.

## Codex Hook Mapping

Codex hooks are written to the active `$CODEX_HOME/hooks.json`. Resolve that root from the same final environment used to launch Codex: an isolated profile currently sets `CODEX_HOME=join(profile.configDir, ".codex")`; otherwise preserve an explicit inherited/session `CODEX_HOME`, falling back to `join(HOME, ".codex")`. The installer and launched process must receive the exact same resolved path.

| Codex hook | Matcher | Normalized kind | Notes |
|---|---|---|---|
| `SessionStart` | `startup|resume|clear|compact` | `session_started` or `compaction_finished` | Runtime health handshake; `compact` maps back to running |
| `UserPromptSubmit` | omitted | `turn_started` | Exact top-level turn-start signal |
| `PreToolUse` | omitted | `running`, `subagent_started`, or `attention_required` | `request_user_input`/equivalent attention tools map to waiting; otherwise fallback running and git guard |
| `PermissionRequest` | omitted | `attention_required` | Replaces Claude `Notification`; handler returns no decision |
| `PostToolUse` | omitted | `running` | Clears waiting after approval; tool failure alone is not `error` |
| `PreCompact` | `manual|auto` | `compaction_started` | Maps to `compacting` |
| `PostCompact` | `manual|auto` | `compaction_finished` | Maps back to `running` |
| `SubagentStart` | omitted | `subagent_started` | Maps to `subagent` without alert |
| `SubagentStop` | omitted | `subagent_finished` | Parent returns to `running`; valid JSON/no output only |
| `Stop` | omitted | `turn_completed` | Maps to `idle` and passive completion event |
| `SessionEnd` | `other` or omitted | `session_ended` | Session closure, not turn completion |

The PreToolUse handler inspects `tool_name` once rather than installing overlapping “running” and “attention” hook groups, which would race because Codex launches all matching hooks concurrently. `request_user_input` and any verified equivalent question tool map to `attention_required`; `PostToolUse` maps back to `running` after the response.

Protected `git commit` and `git push` invocations are parsed across normal Git global options, shell separators/wrappers, and command-local identity overrides. The authenticated hook resolves its project from the owner-scoped session record and calls the owner-checked project policy endpoint before best-effort peer work. A policy lookup error, invalid response, or deadline expiry denies the protected command; it is never interpreted as approval.

`SessionStart(source=compact)` is normalized as `compaction_finished`, because Codex runs it after compaction before the continuation request.

### Hook output codecs

The handler must know the provider wire contract:

- Ordinary reporting hooks exit `0` with no output.
- Codex `Stop` and `SubagentStop` exit `0` with no output when work may stop.
- When unfinished beads work should continue a Codex turn, return the documented JSON `{"decision":"block","reason":"..."}` or exit `2` with the reason on stderr.
- Preserve the current Claude continuation behavior through a Claude codec.
- A notification/reporting failure is fail-open for the agent turn but fail-visible in integration health.

## Hook Configuration Management

Move provider hook behavior behind an adapter registry rather than another provider conditional.

Each adapter defines:

- active config root and file path
- owned hook markers
- desired hook entries and config version
- static validation
- runtime capability check
- provider output codec

Install rules:

1. Parse the existing file. Invalid JSON is an error; never replace an invalid user file with a fresh object.
2. Remove only entries containing the exact Remote Dev marker/version prefix.
3. Preserve unknown top-level keys, hook events, matchers, and commands byte-for-byte where JSON semantics allow.
4. Insert deterministic Remote Dev entries once. Codex tracks trust with each
   hook command's hash, so repair or upgrade must preserve every user hook
   definition unchanged while replacing/removing only Remote Dev-owned entries.
   Do not leave inert placeholder commands behind: each would be a new untrusted
   hook with no lifecycle value.
5. Write atomically through a same-directory temporary file and rename; use restrictive permissions.
6. Skip the write when the semantic result is unchanged.
7. Validate both new and resumed sessions.
8. Support explicit uninstall of only Remote Dev-owned entries.
9. Inspect, but do not rewrite, sibling `config.toml` hook definitions. Codex merges inline hooks with `hooks.json` and warns when both exist in one layer; preserve the user file, install the isolated Remote Dev entries in `hooks.json`, and surface that warning in diagnostics instead of silently mutating TOML or declaring the integration unhealthy.

## Trust, Capability, and Health

Codex requires non-managed command hooks to be reviewed and trusted. The trust
record is tied to a command hash (`trusted_hash`), not its group/array position.
Remote Dev must not write the trust store directly and must not automatically
use `--dangerously-bypass-hook-trust`, because that flag bypasses trust for every
enabled hook, not only Remote Dev hooks.

Health is multi-stage:

| Stage | Meaning |
|---|---|
| `unsupported` | Codex binary missing, hooks feature missing/disabled, or version incompatible |
| `config_error` | Hook file cannot be parsed, merged, or statically validated |
| `connectivity_error` | `rdv hook validate` cannot reach the terminal/API server with the session environment |
| `awaiting_handshake` | Config is valid but no native `SessionStart` event has arrived yet |
| `healthy` | Native hook with current config version arrived for the active process generation |
| `stale` | Installed config version drifted, the active generation never completed its launch/resume handshake, or a specifically expected boundary event was missed |

Persist on `terminal_session`:

- `agent_hook_health`
- `agent_hook_health_reason`
- `agent_hook_config_version`
- `agent_hook_last_seen_at`

After launch/resume, lack of a handshake within a grace period becomes a single coalesced integration notification. The copy must say what is known (“Codex hooks did not start”) and give the likely trust action (`/hooks`) without claiming trust is definitely the cause. Do not mark a healthy session stale merely because a model reasons for a long time without invoking a tool; Codex exposes no lifecycle heartbeat.

Expose health in agent diagnostics and session metadata. A valid config plus connectivity is not labeled healthy until a runtime event arrives.

## Process Exit and Liveness

The tmux hook must include `#{pane_dead_status}` and the current process generation. `/internal/agent-exit` becomes a compatibility adapter that creates a normalized `process_exited` event and calls `AgentLifecycleService`; it must no longer own separate broadcast-only behavior.

Processing rules:

- Non-zero exit: persist `agentExitState=exited`, real exit code, `error` activity status, one `agent_error` notification, and WebSocket updates.
- Zero exit: persist `ended`, one passive `agent_exited` event, and WebSocket updates.
- Unknown exit code: use liveness semantics (`agent_stuck`) only after confirming the pane/process is gone.
- A duplicate PTY/tmux exit callback is absorbed by the process-generation idempotency key.
- Exact callback notification delivery and liveness repair share a
  `(session, generation)` critical section through durable notification storage.
- The liveness sweep persists exit intent but does not immediately materialize a
  notification. It gives the exact callback longer than its bounded transport
  retry window, then repairs any still-undelivered intent on a later sweep. This
  preserves focus-aware push policy and WebSocket notification delivery when the
  callback is merely delayed.

## Notification Semantics

Remote Dev has two delivery layers and must keep them distinct:

1. Live activity status drives sidebar state and `useAgentNotifications()` browser notifications.
2. `NotificationService` stores a durable panel record and optionally sends FCM.

Rules:

- `running`, `subagent`, and `compacting` never create durable notification rows.
- `attention_required` creates `agent_waiting` with actionable severity.
- Non-zero `process_exited` creates `agent_error` with error severity.
- `turn_completed` creates `agent_complete` with passive severity and a session deep link.
- Clean `session_ended` creates at most one passive `agent_exited` event.
- Status retry and dual-source completion never create a second notification.
- A crash after lifecycle commit but before broadcast/notification dispatch is recovered from the lifecycle outbox.

The existing `pushByType` preference becomes truly tri-state:

- `false`: explicit opt-out.
- `true`: explicit opt-in, including passive completion events, while still respecting session mute and quiet hours.
- absent: use the minimum-severity default (`actionable` today).

Thus background browser completion notifications continue to work by default, while mobile/server push for `agent_complete` is explicit and does not recreate the previous clean-stop firehose.

## Compatibility Fallback

If a Codex build lacks native hooks, Remote Dev may use the documented `notify` program for `agent-turn-complete` only. This fallback:

- maps only to `turn_completed`
- reports degraded health because approval/running/compaction states are unavailable
- must not overwrite a user-configured `notify` program
- is injected as a per-session `-c notify=...` launch override, never by rewriting `config.toml`, and only after a real TOML parser confirms that every active user/profile layer Remote Dev can resolve has no `notify` value
- must normalize `thread-id`/`turn-id` into the same idempotency key used by native `Stop`

If a config layer is unreadable, ambiguous, managed outside Remote Dev, or already defines `notify`, Remote Dev leaves the effective configuration untouched and reports the limitation. The fallback is an explicit degraded compatibility path, not a reason to weaken parsing or config-preservation rules.

## Security and Privacy

- Hook input is untrusted JSON. Parse defensively and cap stdin size.
- Derive the Remote Dev session from `RDV_SESSION_ID`; reject provider/session mismatch server-side.
- Never shell-interpolate provider payload values.
- Do not log or persist prompts, tool input/output, transcript content, auth material, or full assistant messages.
- Sanitize control characters in notification previews and diagnostics.
- Keep hook timeouts short; reporting must not stall the agent loop.
- Preserve Codex trust review. Any future bypass must be an explicit user-visible session option with a separate security review.

## Observability

Structured logs include `rdvSessionId`, provider, kind, source, event-key prefix, process generation, duplicate/applied result, and latency. They never include raw hook payloads.

Metrics/counters:

- lifecycle events received by provider/kind/source
- duplicates discarded
- stale/out-of-generation events rejected
- hook config install/repair failures
- sessions awaiting/stale handshake
- notifications emitted/coalesced/suppressed
- lifecycle outbox pending age, retries, and terminal failures
- process exits by provider/exit class

Diagnostics should show the active config path, desired/installed config version, Codex version and hook feature state, last hook event, connectivity result, and remediation text.

## Rollout and Rollback

1. Land contract, adapters, and tests with an explicit
   `RDV_CODEX_HOOKS_ENABLED=0` rollback.
2. Run generated-config and isolated live Codex smoke tests.
3. Enable by default after the supported Codex CLI reports hooks stable and the
   live smoke demonstrates actual delivery.
4. Keep Claude on its existing adapter until parity tests pass, then route Claude through the shared ingestion service without changing its installed wire format.
5. Roll back by disabling the feature flag. Installer/uninstaller removes only Remote Dev Codex entries; user hooks remain.

The Phase 1 implementation completed steps 1–3 with Codex CLI 0.146.0. Its live
smoke delivered SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop,
and SessionEnd through the installed configuration. PermissionRequest remains
fixture-tested because non-interactive `codex exec` disables approvals. The
authenticated, generation-bound tmux fallback is separately exercised against a
real tmux server, including exact non-zero exit status and cross-session
isolation.

## Acceptance Criteria

1. New and resumed Codex sessions receive idempotently merged Remote Dev hooks in the active `$CODEX_HOME` without losing user hooks.
2. Codex reports running, waiting, compacting, idle/complete, ended, and process-error transitions with durable provider/session/turn/event identity.
3. Approval creates exactly one coalesced actionable notification.
4. Turn completion drives `idle`, a background browser notification, and one passive `agent_complete` record; server push follows explicit preference.
5. A non-zero process exit persists and creates one error notification when no browser is connected.
6. Duplicate, delayed, older-generation, and subagent-stop events cannot regress terminal states.
7. Invalid config, unsupported hooks, unreachable servers, missing runtime handshake, and stale integration are visible and actionable.
8. User-authored Claude/Codex hooks survive install, repair, upgrade, and uninstall.
9. Claude lifecycle behavior remains compatible.
10. Contract fixtures, unit tests, integration tests, resume/restart tests, detached-client tests, and a gated real-Codex smoke test pass.
11. A forced crash between lifecycle commit and dispatch replays the pending outbox without duplicating status or notification rows.

## References

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex notifications and `notify`](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
- [Codex generated hook schemas](https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated)
- `src/services/agent-profile-service.ts`
- `src/services/session-service.ts`
- `crates/rdv/src/commands/hook.rs`
- `src/server/terminal.ts`
- `src/services/session-liveness-service.ts`
- `src/hooks/useAgentNotifications.ts`
- `docs/claude/plans/2026-06-03-notifications-impl-plan.md`
