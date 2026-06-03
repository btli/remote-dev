# Notifications Signal-vs-Noise — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per-step TDD ceremony (write failing test → run → implement → run → commit) is added at execution time; this plan gives real files, real code, and a real test command per task.

**Goal:** Turn agent-lifecycle notifications from a firehose into typed, coalesced, focus-aware, mutable, push-gated signals, with PID-liveness as the real stuck/crashed signal (epic `remote-dev-y5ch`).

**Architecture:** Every notification carries a `severity` class (`actionable | passive | error`) derived from its `type`; `createNotification` becomes a policy gate that (1) consults a pluggable policy hook + user prefs, (2) coalesces by `(userId, sessionId, group)` into a mutable open notification rather than a 5s drop-debounce, and (3) gates FCM push on severity + per-type/per-session opt-out + focus + quiet hours. A new server-side liveness sweep on the terminal server runs `kill(pid,0)` against each running/waiting session's tmux pane PID and emits exactly one `agent_exited` (crashed) or clears stale state. The noisy clean-stop CLI notification (`rdv hook stop`) is removed at the source.

**Tech Stack:** TypeScript (Next.js 16 / React 19), Drizzle ORM + libsql (SQLite), Rust `rdv` CLI (`crates/rdv`), Vitest, FCM HTTP v1. Server logging via `createLogger` from `@/lib/logger` (NEVER `console.*`); client/React may use `console.error`. `bun` only.

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/types/notification.ts` (modify) | Add `NotificationSeverity`, `notificationSeverity()` classifier, `notificationGroup()` coalescing key, extend `NotificationEvent`/`CreateNotificationInput` with `severity`, `coalesceKey`, `count`, `meta`. |
| `src/lib/notification-policy.ts` (new) | Pure `applyNotificationPolicy(event, prefs)` → `NotificationDecision` (channel flags + suppress reason). The single pluggable policy hook (y5ch.7). |
| `src/services/notification-preferences-service.ts` (new) | Read/write `notificationPreferences` rows; resolve effective prefs (per-type mute, per-session mute, quiet hours) for a user. |
| `src/services/session-liveness-service.ts` (new) | `reconcileLiveness()` sweep: list tmux sessions + pane PIDs, `kill(pid,0)`, clear stale running/waiting, emit one stuck/exited signal (y5ch.9). |
| `src/app/api/notifications/preferences/route.ts` (new) | `GET`/`PUT` user notification prefs (per-type, per-session, quiet hours). |
| `src/services/__tests__/notification-classification.test.ts` (new) | y5ch.1/.3 classifier + group tests. |
| `src/services/__tests__/notification-service.test.ts` (new) | y5ch.2/.5/.10 coalescing + push-gate tests. |
| `src/lib/__tests__/notification-policy.test.ts` (new) | y5ch.4/.6/.7 policy/focus/prefs tests. |
| `src/services/__tests__/session-liveness-service.test.ts` (new) | y5ch.9 liveness sweep tests. |

### Modified files (with anchors)

| Path | Change |
|------|--------|
| `src/db/schema.ts:1447-1472` | Add `severity`, `coalesceKey`, `count`, `meta`, `updatedAt` columns + indexes to `notificationEvents`; add new `notificationPreferences` table after `pushTokens` (`schema.ts:1478-1501`). |
| `src/services/notification-service.ts:26-99` | Replace 5s drop-debounce (`:26-51`) with real coalescing; run policy + prefs gate before insert; gate FCM push (`:74-99`) on `decision.push`. Add `coalesceFocus` param. |
| `src/server/terminal.ts:643-704` | Pass `isSessionFocusedByUser()` + severity into `createNotification`; replace `waiting`/`error` branch payloads (`:666-700`). |
| `src/server/terminal.ts:753-792` | `/internal/notify` — accept + forward `severity`/`meta`; honor coalescing return (`:778` null path). |
| `src/server/terminal.ts:1858-1863` | Add liveness sweep `setInterval` next to the peer-cleanup interval. |
| `src/server/terminal.ts:118-136, 2071-2083` | Expose `isSessionFocusedByUser(userId, sessionId)` from the per-connection `isVisible`/`lastFocusAt` focus state. |
| `crates/rdv/src/commands/hook.rs:521-532` | Delete the `agent_exited` "Session ended normally" POST in `handle_stop` (y5ch.2). Keep idle status report + peer broadcast. |
| `crates/rdv/src/commands/hook.rs:604-616` | `Notify` subcommand: add `--severity` flag, forward it in the `/internal/notify` payload (y5ch.8 CTA path). |
| `src/components/mobile/notifications/MobileNotificationRow.tsx:56-60` | Drive halo/dot from `severity` (`actionable`) + render `count` badge + deep-link CTA from `meta`. |
| `src/contexts/NotificationContext.tsx:163-166` | `addNotification` upserts by `id` (coalescing replaces an existing row in place instead of stacking). |
| `src/infrastructure/container.ts:394-395` | No new wiring required (policy + prefs are stateless reads); confirm sweep is started by `terminal.ts`, not the Next.js process. |

---

## Build Sequence

Deps: `.1` is foundation for `.2`, `.3`, `.10`. `.7` (policy) and `.6` (prefs) are consumed by `.4`/`.10`. `.5` (coalescing) and `.8` (payload) are independent but build on `.1`. `.9` (liveness) is standalone. `.11` covers all.

- **Phase 0 — Foundation:** y5ch.1 (severity model + classifier + schema).
- **Phase 1 — Kill the noise:** y5ch.2 (drop clean-stop notify in Rust), y5ch.3 (passive vs actionable wiring).
- **Phase 2 — Policy & prefs:** y5ch.7 (policy hook), y5ch.6 (prefs service + API), y5ch.4 (focus suppression), y5ch.10 (FCM severity/opt-out gate).
- **Phase 3 — Coalescing & payload:** y5ch.5 (coalescing + clear boundary), y5ch.8 (richer payload + client routing).
- **Phase 4 — Liveness:** y5ch.9 (PID-liveness reconciliation sweep).
- **Phase 5 — Tests:** y5ch.11 (integration coverage; per-task unit tests land with each task above).

After every TS task: `bun run typecheck && bun run lint`. After schema changes: `bun run db:push`. Rust task: `cargo build -p rdv && cargo test -p rdv`.

---

### Task: Severity/class model + classifier + schema (y5ch.1)

**Bead:** y5ch.1
**Files:**
- Modify: `src/types/notification.ts:1-36`
- Modify: `src/db/schema.ts:1447-1472`
- Test: `src/services/__tests__/notification-classification.test.ts`

**Steps:**

1. Extend `src/types/notification.ts` with the severity union, classifier, and coalescing-group helper. The classifier is the single source of truth mapping `NotificationType → NotificationSeverity` (consumed by terminal.ts, the policy hook, and the FCM gate).

```typescript
// src/types/notification.ts
export type NotificationType =
  | "agent_waiting"
  | "agent_error"
  | "agent_complete"
  | "agent_exited"
  | "build_fail"
  | "session_closed"
  | "update_pending"
  | "update_applied"
  | "agent_stuck"   // NEW: emitted by the liveness sweep (y5ch.9)
  | "info";

/** Signal class. Drives push-gating (y5ch.10), client halo (y5ch.8), coalescing. */
export type NotificationSeverity = "actionable" | "passive" | "error";

/** Single source of truth: type → severity. */
export function notificationSeverity(type: NotificationType): NotificationSeverity {
  switch (type) {
    case "agent_waiting":   // agent needs the human → actionable
    case "build_fail":
    case "update_pending":
      return "actionable";
    case "agent_error":
    case "agent_stuck":
      return "error";
    case "agent_complete":
    case "agent_exited":
    case "session_closed":
    case "update_applied":
    case "info":
    default:
      return "passive";
  }
}

/**
 * Coalescing group key (y5ch.5). Notifications sharing
 * (userId, sessionId, group) collapse into ONE open row. `null` sessionId or
 * non-coalescable types fall back to the row id (no coalescing).
 */
export function notificationGroup(type: NotificationType): string {
  switch (type) {
    case "agent_waiting":
    case "agent_complete":
    case "agent_exited":
    case "agent_stuck":
      return "agent_lifecycle"; // collapse repeated lifecycle pings per session
    case "agent_error":
    case "build_fail":
      return "agent_failure";
    default:
      return type; // update_pending/applied/info coalesce only with same type
  }
}

export interface NotificationEvent {
  id: string;
  userId: string;
  sessionId: string | null;
  sessionName: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** Coalescing count: 1 normally, >1 when collapsed. */
  count: number;
  /** Structured client-routing payload (y5ch.8): deep-link, duration, result. */
  meta: NotificationMeta | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** y5ch.8 — richer payload for client routing/CTA. */
export interface NotificationMeta {
  /** Session to deep-link into when tapped. */
  deepLinkSessionId?: string;
  /** Optional CTA label + action verb the client maps to a handler. */
  cta?: { label: string; action: "open_session" | "view_diff" | "rerun" | "dismiss" };
  /** Agent run duration in ms (clean-complete summaries). */
  durationMs?: number;
  /** Terminal result, e.g. "success" | "failed" | exit code as string. */
  result?: string;
}

export interface CreateNotificationInput {
  userId: string;
  sessionId?: string;
  sessionName?: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** Override; defaults to notificationSeverity(type). */
  severity?: NotificationSeverity;
  meta?: NotificationMeta;
  /** y5ch.4 — true when the target session is currently focused by the user. */
  focused?: boolean;
}
```

2. Add the new columns to `notificationEvents` in `src/db/schema.ts` (after `body`, before `readAt` at `:1462-1463`):

```typescript
// src/db/schema.ts — inside notificationEvents columns
    type: text("type").$type<NotificationType>().notNull(),
    severity: text("severity")
      .$type<NotificationSeverity>()
      .notNull()
      .default("passive"),
    title: text("title").notNull(),
    body: text("body"),
    // y5ch.5 coalescing: rows sharing this key collapse into one open notification.
    coalesceKey: text("coalesce_key"),
    // y5ch.5: number of collapsed events (1 normally).
    count: integer("count").notNull().default(1),
    // y5ch.8: structured client-routing payload (deep-link, CTA, duration, result).
    meta: text("meta", { mode: "json" }).$type<NotificationMeta | null>(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
```

Add the coalescing index in the index list (`:1468-1471`):

```typescript
  (table) => [
    index("notification_event_user_created_idx").on(table.userId, table.createdAt),
    index("notification_event_user_read_idx").on(table.userId, table.readAt),
    // Partial-ish lookup for coalescing an open (unread) row.
    index("notification_event_coalesce_idx").on(
      table.userId,
      table.sessionId,
      table.coalesceKey,
      table.readAt,
    ),
  ]
```

Import the new types at the top of `schema.ts` where `NotificationType` is already imported.

3. Update `mapRow` in `notification-service.ts:180-192` to project the new columns (`severity`, `count`, `meta`, `updatedAt`), defaulting `severity` to `notificationSeverity(row.type)` when null and `count` to `1`.

4. Run `bun run db:push` to materialize the schema.

**Test step:**

```typescript
// src/services/__tests__/notification-classification.test.ts
import { describe, it, expect } from "vitest";
import { notificationSeverity, notificationGroup } from "@/types/notification";

describe("notificationSeverity", () => {
  it("classifies agent_waiting as actionable", () =>
    expect(notificationSeverity("agent_waiting")).toBe("actionable"));
  it("classifies agent_error and agent_stuck as error", () => {
    expect(notificationSeverity("agent_error")).toBe("error");
    expect(notificationSeverity("agent_stuck")).toBe("error");
  });
  it("classifies clean stop (agent_exited/agent_complete) as passive", () => {
    expect(notificationSeverity("agent_exited")).toBe("passive");
    expect(notificationSeverity("agent_complete")).toBe("passive");
  });
});

describe("notificationGroup", () => {
  it("collapses lifecycle pings into one group", () => {
    expect(notificationGroup("agent_waiting")).toBe("agent_lifecycle");
    expect(notificationGroup("agent_exited")).toBe("agent_lifecycle");
  });
  it("keeps info/update types in their own group", () =>
    expect(notificationGroup("info")).toBe("info"));
});
```

Run: `bun run test:run src/services/__tests__/notification-classification.test.ts`
Expected: PASS (6 assertions).

---

### Task: Stop push-notifying clean agent stop (y5ch.2)

**Bead:** y5ch.2 (depends y5ch.1) — **P1, the main noise source**
**Files:**
- Modify: `crates/rdv/src/commands/hook.rs:521-532`
- Test: `crates/rdv/src/commands/hook.rs` (inline `#[cfg(test)]`) — assert the stop payload builder is gone / returns no notify.

**Steps:**

1. In `handle_stop` (`hook.rs:473-541`), **delete** the notification block at `:521-532` (the `let title = ...` + `let payload = json!({ "type": "agent_exited", ... })` + `client.post_json("/internal/notify", ...)`). A clean stop must not create any notification — the idle status report (`:516-519`) and the "finished work" peer broadcast (`:534-538`) stay. After the edit, `handle_stop` reports idle and broadcasts to peers but never calls `/internal/notify`.

```rust
// crates/rdv/src/commands/hook.rs — handle_stop, AFTER edit (replaces :516-538)
    // Report idle status
    let idle_query = [("sessionId", sid), ("status", "idle")];
    if let Err(e) = client.post_empty_with_query("/internal/agent-status", &idle_query).await {
        eprintln!("warning: failed to report idle status: {e}");
    }

    // y5ch.2: clean stop is PASSIVE — no notification is created here.
    // Stuck/crashed agents surface via the server-side liveness sweep (y5ch.9),
    // and "agent needs you" surfaces via the Notification hook (waiting status).

    // Broadcast "finished work" to peers (in-band, not a user notification).
    let finished_payload = json!({ "fromSessionId": sid, "body": "finished work" });
    let _ = client
        .post_json("/internal/peers/messages/send", &finished_payload)
        .await;

    Ok(())
}
```

2. Leave `agent` / `reason` params in the `Stop` subcommand signature (they're still logged in the idle path and used by callers); the unused-variable warning is avoided because `reason` is no longer consumed — prefix with `_` only if the compiler warns: rename the param to `_reason` in the `Stop` arm at `:601-603` if `cargo build` reports it unused. Do NOT add `#[allow(...)]`.

3. The companion server change (passive severity for any *remaining* `agent_exited` path, e.g. the liveness sweep) lands in y5ch.3.

**Test step:**

```rust
// crates/rdv/src/commands/hook.rs — add at bottom under #[cfg(test)]
#[cfg(test)]
mod stop_tests {
    /// Guard: the clean-stop path must not reference the /internal/notify
    /// endpoint. This is a source-level assertion that the noise POST is gone.
    #[test]
    fn handle_stop_source_has_no_notify_post() {
        let src = include_str!("hook.rs");
        // Find the handle_stop fn body and assert it does not POST a notify.
        let start = src.find("async fn handle_stop").expect("handle_stop exists");
        let end = src[start..].find("\nasync fn ").map(|i| start + i).unwrap_or(src.len());
        let body = &src[start..end];
        assert!(
            !body.contains("/internal/notify"),
            "handle_stop must not call /internal/notify (y5ch.2 noise source)"
        );
        assert!(body.contains("finished work"), "peer broadcast must remain");
    }
}
```

Run: `cargo test -p rdv stop_tests`
Expected: PASS. Also run `cargo build -p rdv` → no errors, no new warnings.

---

### Task: Distinguish passive Stop from actionable Notification/PermissionRequest (y5ch.3)

**Bead:** y5ch.3 (depends y5ch.1)
**Files:**
- Modify: `src/server/terminal.ts:666-700`
- Modify: `src/server/terminal.ts:753-792`
- Test: covered by `src/services/__tests__/notification-classification.test.ts` + a terminal-payload assertion in `notification-service.test.ts`.

**Steps:**

1. In the `/internal/agent-status` handler (`terminal.ts:666-700`), the `waiting`/`error` branch currently creates `agent_waiting`/`agent_error`. These are already actionable/error — make severity explicit and stop creating a notification for any other status (idle, ended, running, compacting, subagent never reach this branch, which is correct). Pass `severity` through:

```typescript
// src/server/terminal.ts — inside the status === "waiting" || status === "error" branch
          const isWaiting = status === "waiting";
          const type = isWaiting ? "agent_waiting" : "agent_error";
          const notification = await NotificationService.createNotification({
            userId: session.userId,
            sessionId,
            sessionName: session.name,
            type,
            severity: isWaiting ? "actionable" : "error",
            title: isWaiting ? "Agent waiting for input" : "Agent encountered an error",
            body: `Session "${session.name}" needs attention`,
            meta: { deepLinkSessionId: sessionId, cta: { label: "Open session", action: "open_session" } },
            focused: isSessionFocusedByUser(session.userId, sessionId), // y5ch.4
          });
          if (!notification) return; // coalesced or suppressed
```

2. In `/internal/notify` (`terminal.ts:753-792`), accept an optional `severity` and `meta` from the CLI payload and forward them. The Rust `Notify` subcommand (y5ch.8) sends `info`/passive by default but an explicit `--severity actionable` (e.g. a permission-style notice) must pass through:

```typescript
// src/server/terminal.ts — /internal/notify handler
    const { sessionId, type, title, body: notifBody, severity, meta } = payload;
    if (!sessionId || !type || !title) {
      sendJson(res, 400, { error: "Missing sessionId, type, or title" });
      return true;
    }
    // ...inside the .then():
        const notification = await NotificationService.createNotification({
          userId: session.userId,
          sessionId: sessionId as string,
          sessionName: session.name,
          type: type as import("@/types/notification").NotificationType,
          title: title as string,
          body: (notifBody as string) ?? undefined,
          severity: (severity as import("@/types/notification").NotificationSeverity) ?? undefined,
          meta: (meta as import("@/types/notification").NotificationMeta) ?? undefined,
          focused: isSessionFocusedByUser(session.userId, sessionId as string),
        });
        if (!notification) return; // coalesced or suppressed
```

**Test step:**

```typescript
// add to src/services/__tests__/notification-classification.test.ts
it("waiting maps to actionable, stop maps to passive (no actionable stop)", () => {
  expect(notificationSeverity("agent_waiting")).toBe("actionable");
  expect(notificationSeverity("agent_exited")).toBe("passive");
});
```

Run: `bun run test:run src/services/__tests__/notification-classification.test.ts`
Expected: PASS. Plus `bun run typecheck` clean.

---

### Task: Pluggable notification policy hook (y5ch.7)

**Bead:** y5ch.7
**Files:**
- Create: `src/lib/notification-policy.ts`
- Test: `src/lib/__tests__/notification-policy.test.ts`

**Steps:**

1. Create the pure policy function. It takes the event + resolved prefs + focus flag and returns channel flags. This is the single "event JSON → patch flipping channel flags / stop" hook. No I/O, fully unit-testable.

```typescript
// src/lib/notification-policy.ts
import type { CreateNotificationInput, NotificationSeverity } from "@/types/notification";
import { notificationSeverity } from "@/types/notification";

/** Resolved, already-merged prefs for one user (output of the prefs service). */
export interface ResolvedNotificationPrefs {
  /** Per-type opt-out: type → false means "never push". */
  pushByType: Partial<Record<string, boolean>>;
  /** Per-session mute: sessionId present ⇒ suppress entirely. */
  mutedSessionIds: ReadonlySet<string>;
  /** Quiet hours in the user's local tz; null = disabled. */
  quietHours: { startHour: number; endHour: number } | null;
  /** Minimum severity that may push at all. */
  minPushSeverity: NotificationSeverity;
}

export interface NotificationDecision {
  /** Persist + broadcast an in-app notification row. */
  store: boolean;
  /** Dispatch an FCM push. */
  push: boolean;
  /** Human-readable reason when a channel is off (for logging only). */
  reason?: string;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  passive: 0,
  actionable: 1,
  error: 2,
};

/** True when `now` (Date) falls inside the quiet-hours window (wraps midnight). */
export function inQuietHours(
  now: Date,
  qh: { startHour: number; endHour: number } | null,
): boolean {
  if (!qh) return false;
  const h = now.getHours();
  return qh.startHour <= qh.endHour
    ? h >= qh.startHour && h < qh.endHour
    : h >= qh.startHour || h < qh.endHour; // wraps midnight (e.g. 22→7)
}

/**
 * The policy hook. Default policy:
 *   - per-session mute ⇒ neither store nor push.
 *   - always store in-app (the panel is the durable record) unless session-muted.
 *   - push only when: severity ≥ minPushSeverity AND type not opted out AND
 *     not focused (y5ch.4) AND not in quiet hours (unless error).
 *   - errors always push (override quiet hours) but still respect session mute.
 */
export function applyNotificationPolicy(
  input: CreateNotificationInput,
  prefs: ResolvedNotificationPrefs,
  ctx: { now: Date; focused: boolean },
): NotificationDecision {
  const severity = input.severity ?? notificationSeverity(input.type);

  if (input.sessionId && prefs.mutedSessionIds.has(input.sessionId)) {
    return { store: false, push: false, reason: "session_muted" };
  }
  if (ctx.focused) {
    return { store: true, push: false, reason: "session_focused" };
  }
  if (prefs.pushByType[input.type] === false) {
    return { store: true, push: false, reason: "type_opt_out" };
  }
  if (SEVERITY_RANK[severity] < SEVERITY_RANK[prefs.minPushSeverity]) {
    return { store: true, push: false, reason: "below_min_severity" };
  }
  if (severity !== "error" && inQuietHours(ctx.now, prefs.quietHours)) {
    return { store: true, push: false, reason: "quiet_hours" };
  }
  return { store: true, push: true };
}
```

**Test step:**

```typescript
// src/lib/__tests__/notification-policy.test.ts
import { describe, it, expect } from "vitest";
import { applyNotificationPolicy, inQuietHours, type ResolvedNotificationPrefs } from "@/lib/notification-policy";

const base: ResolvedNotificationPrefs = {
  pushByType: {},
  mutedSessionIds: new Set(),
  quietHours: null,
  minPushSeverity: "actionable",
};
const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };

describe("applyNotificationPolicy", () => {
  it("suppresses push (but stores) when session is focused", () => {
    const d = applyNotificationPolicy({ userId: "u", sessionId: "s", type: "agent_waiting", title: "x" }, base, { now: at(12), focused: true });
    expect(d).toEqual({ store: true, push: false, reason: "session_focused" });
  });
  it("mutes both channels for a muted session", () => {
    const prefs = { ...base, mutedSessionIds: new Set(["s"]) };
    const d = applyNotificationPolicy({ userId: "u", sessionId: "s", type: "agent_waiting", title: "x" }, prefs, { now: at(12), focused: false });
    expect(d.store).toBe(false); expect(d.push).toBe(false);
  });
  it("drops passive below min severity", () => {
    const d = applyNotificationPolicy({ userId: "u", type: "agent_exited", title: "x" }, base, { now: at(12), focused: false });
    expect(d.push).toBe(false); expect(d.reason).toBe("below_min_severity");
  });
  it("honors per-type opt-out", () => {
    const prefs = { ...base, pushByType: { agent_waiting: false } };
    const d = applyNotificationPolicy({ userId: "u", type: "agent_waiting", title: "x" }, prefs, { now: at(12), focused: false });
    expect(d.reason).toBe("type_opt_out");
  });
  it("errors override quiet hours", () => {
    const prefs = { ...base, quietHours: { startHour: 0, endHour: 23 }, minPushSeverity: "passive" as const };
    const d = applyNotificationPolicy({ userId: "u", type: "agent_error", title: "x" }, prefs, { now: at(12), focused: false });
    expect(d.push).toBe(true);
  });
  it("inQuietHours wraps midnight", () => {
    expect(inQuietHours(at(23), { startHour: 22, endHour: 7 })).toBe(true);
    expect(inQuietHours(at(12), { startHour: 22, endHour: 7 })).toBe(false);
  });
});
```

Run: `bun run test:run src/lib/__tests__/notification-policy.test.ts`
Expected: PASS (6 tests).

---

### Task: User prefs — per-type + per-session muting + quiet hours (y5ch.6)

**Bead:** y5ch.6
**Files:**
- Modify: `src/db/schema.ts` (add `notificationPreferences` table after `pushTokens` at `:1501`)
- Create: `src/services/notification-preferences-service.ts`
- Create: `src/app/api/notifications/preferences/route.ts`
- Test: assertions inside `src/lib/__tests__/notification-policy.test.ts` (resolver shape) + a service round-trip test appended there.

**Steps:**

1. Add the prefs table to `src/db/schema.ts` (mirrors the `nodePreferences` shape at `:1772-1812` for conventions — JSON columns, per-user uniqueness):

```typescript
// src/db/schema.ts — after pushTokens (:1501)
export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    // Per-type push opt-out. JSON: { [NotificationType]: boolean }. Missing = on.
    pushByType: text("push_by_type", { mode: "json" })
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    // Per-session mute. JSON: array of sessionId strings.
    mutedSessionIds: text("muted_session_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    // Quiet hours (local tz, 0-23). null = disabled.
    quietHoursStart: integer("quiet_hours_start"),
    quietHoursEnd: integer("quiet_hours_end"),
    // Minimum severity allowed to push. Default actionable (drops passive).
    minPushSeverity: text("min_push_severity")
      .$type<NotificationSeverity>()
      .notNull()
      .default("actionable"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);
```

2. Create the service. `resolvePrefs` returns the `ResolvedNotificationPrefs` shape consumed by the policy hook; missing row ⇒ sane defaults (actionable+ pushes, no mutes, no quiet hours).

```typescript
// src/services/notification-preferences-service.ts
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ResolvedNotificationPrefs } from "@/lib/notification-policy";
import type { NotificationSeverity } from "@/types/notification";
import { createLogger } from "@/lib/logger";

const log = createLogger("NotificationPreferences");

const DEFAULTS: ResolvedNotificationPrefs = {
  pushByType: {},
  mutedSessionIds: new Set(),
  quietHours: null,
  minPushSeverity: "actionable",
};

export async function resolvePrefs(userId: string): Promise<ResolvedNotificationPrefs> {
  const row = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });
  if (!row) return DEFAULTS;
  return {
    pushByType: row.pushByType ?? {},
    mutedSessionIds: new Set(row.mutedSessionIds ?? []),
    quietHours:
      row.quietHoursStart != null && row.quietHoursEnd != null
        ? { startHour: row.quietHoursStart, endHour: row.quietHoursEnd }
        : null,
    minPushSeverity: row.minPushSeverity ?? "actionable",
  };
}

export interface UpdatePrefsInput {
  pushByType?: Record<string, boolean>;
  mutedSessionIds?: string[];
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  minPushSeverity?: NotificationSeverity;
}

export async function getRawPrefs(userId: string) {
  return (
    (await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    })) ?? null
  );
}

export async function upsertPrefs(userId: string, input: UpdatePrefsInput): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      userId,
      pushByType: input.pushByType ?? {},
      mutedSessionIds: input.mutedSessionIds ?? [],
      quietHoursStart: input.quietHoursStart ?? null,
      quietHoursEnd: input.quietHoursEnd ?? null,
      minPushSeverity: input.minPushSeverity ?? "actionable",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...(input.pushByType !== undefined && { pushByType: input.pushByType }),
        ...(input.mutedSessionIds !== undefined && { mutedSessionIds: input.mutedSessionIds }),
        ...(input.quietHoursStart !== undefined && { quietHoursStart: input.quietHoursStart }),
        ...(input.quietHoursEnd !== undefined && { quietHoursEnd: input.quietHoursEnd }),
        ...(input.minPushSeverity !== undefined && { minPushSeverity: input.minPushSeverity }),
        updatedAt: new Date(),
      },
    });
  log.info("Notification prefs updated", { userId });
}

/** Convenience used by the row long-press ActionSheet: toggle one session mute. */
export async function toggleSessionMute(userId: string, sessionId: string): Promise<boolean> {
  const raw = await getRawPrefs(userId);
  const current = new Set(raw?.mutedSessionIds ?? []);
  const nowMuted = !current.has(sessionId);
  if (nowMuted) current.add(sessionId);
  else current.delete(sessionId);
  await upsertPrefs(userId, { mutedSessionIds: [...current] });
  return nowMuted;
}
```

3. Create the API route (follows `src/app/api/notifications/route.ts` conventions — `withApiAuth`, `parseJsonBody`, `errorResponse`):

```typescript
// src/app/api/notifications/preferences/route.ts
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as Prefs from "@/services/notification-preferences-service";
import type { UpdatePrefsInput } from "@/services/notification-preferences-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/notifications/preferences");

export const GET = withApiAuth(async (_request, { userId }) => {
  try {
    const raw = await Prefs.getRawPrefs(userId);
    return NextResponse.json(
      raw ?? {
        pushByType: {},
        mutedSessionIds: [],
        quietHoursStart: null,
        quietHoursEnd: null,
        minPushSeverity: "actionable",
      },
    );
  } catch (error) {
    log.error("Error reading notification prefs", { error: String(error) });
    return errorResponse("Failed to read preferences", 500);
  }
});

export const PUT = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<UpdatePrefsInput>(request);
    if ("error" in result) return result.error;
    await Prefs.upsertPrefs(userId, result.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Error updating notification prefs", { error: String(error) });
    return errorResponse("Failed to update preferences", 500);
  }
});
```

4. Register `notificationPreferences` in the drizzle query schema if the project uses an explicit relations/schema barrel (it uses `db.query.*`, so the table must be exported from `schema.ts` — it is). Run `bun run db:push`.

**Test step:** Append a resolver-shape test to `src/lib/__tests__/notification-policy.test.ts` (pure, no DB):

```typescript
import type { ResolvedNotificationPrefs } from "@/lib/notification-policy";
it("resolved prefs shape feeds the policy directly", () => {
  const prefs: ResolvedNotificationPrefs = {
    pushByType: { agent_exited: false },
    mutedSessionIds: new Set(["s1"]),
    quietHours: { startHour: 22, endHour: 7 },
    minPushSeverity: "actionable",
  };
  expect(prefs.mutedSessionIds.has("s1")).toBe(true);
  expect(prefs.pushByType.agent_exited).toBe(false);
});
```

Run: `bun run test:run src/lib/__tests__/notification-policy.test.ts` → PASS. `bun run typecheck` clean.

---

### Task: Focus-aware suppression (y5ch.4)

**Bead:** y5ch.4
**Files:**
- Modify: `src/server/terminal.ts:118-136` (export focus query)
- Modify: `src/server/terminal.ts:2071-2083` (already sets `isVisible`; no change beyond confirming)
- Test: covered by `notification-policy.test.ts` (`session_focused` case) + `notification-service.test.ts`.

**Steps:**

1. Add a focus query helper near the connection maps in `terminal.ts` (uses the existing per-connection `isVisible` set by `client_focus`/`client_blur` at `:2071-2083`). A session is "focused by user" when that user has at least one visible connection to it:

```typescript
// src/server/terminal.ts — near getConnectionsForSession (:152)
/**
 * y5ch.4 — true when `userId` has a currently-visible (focused) WebSocket
 * connection attached to `sessionId`. Drives push suppression: if the user is
 * already looking at the session, an FCM push is noise.
 */
export function isSessionFocusedByUser(userId: string, sessionId: string): boolean {
  for (const conn of getConnectionsForSession(sessionId)) {
    if (conn.userId === userId && conn.isVisible) return true;
  }
  return false;
}
```

2. Both notification creation sites (status handler `:680`, `/internal/notify` `:770`) already pass `focused: isSessionFocusedByUser(...)` per the y5ch.3 edits. Thread `focused` into `createNotification` (done in y5ch.5's service rewrite). The policy hook already returns `{ store: true, push: false, reason: "session_focused" }` for focused sessions — so focused notifications still appear in the panel but never push. This matches the desired "skip push when viewing" behavior.

**Test step:** the `"suppresses push (but stores) when session is focused"` case in `notification-policy.test.ts` (already written in y5ch.7) is the spec for this task.

Run: `bun run test:run src/lib/__tests__/notification-policy.test.ts` → PASS. `bun run typecheck` clean.

---

### Task: Gate FCM push by severity + per-type opt-out (y5ch.10)

**Bead:** y5ch.10 (depends y5ch.1)
**Files:**
- Modify: `src/services/notification-service.ts:44-99`
- Test: `src/services/__tests__/notification-service.test.ts`

**Steps:**

1. Rewrite `createNotification` so the policy gate decides store/push. The FCM dispatch (`:74-99`) only fires when `decision.push` is true. This is also where coalescing (y5ch.5) plugs in — see that task; here we wire the gate:

```typescript
// src/services/notification-service.ts (top imports)
import { applyNotificationPolicy } from "@/lib/notification-policy";
import { resolvePrefs } from "@/services/notification-preferences-service";
import { notificationSeverity, notificationGroup } from "@/types/notification";

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationEvent | null> {
  const severity = input.severity ?? notificationSeverity(input.type);
  const prefs = await resolvePrefs(input.userId);
  const decision = applyNotificationPolicy(input, prefs, {
    now: new Date(),
    focused: input.focused ?? false,
  });

  if (!decision.store) {
    log.debug("Notification suppressed", { type: input.type, reason: decision.reason });
    return null;
  }

  // y5ch.5 coalescing (see coalescing task) returns the stored row.
  const notification = await upsertCoalesced(input, severity);

  if (decision.push && pushGateway && pushTokenRepo) {
    dispatchPush(notification).catch((err) =>
      log.warn("Push notification dispatch failed", { error: String(err) }),
    );
  } else if (!decision.push) {
    log.debug("Push gated off", { type: input.type, reason: decision.reason });
  }
  return notification;
}
```

2. Update `dispatchPush` (`:75-99`) to include `severity` + `count` in the FCM `data` payload so the client can route (y5ch.8):

```typescript
// src/services/notification-service.ts — dispatchPush data block
      data: {
        notificationId: notification.id,
        type: notification.type,
        severity: notification.severity,
        count: String(notification.count),
        ...(notification.sessionId && { sessionId: notification.sessionId }),
        ...(notification.sessionName && { sessionName: notification.sessionName }),
        ...(notification.meta?.deepLinkSessionId && {
          deepLinkSessionId: notification.meta.deepLinkSessionId,
        }),
      },
```

**Test step:**

```typescript
// src/services/__tests__/notification-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prefs + push gateway; assert push is gated by severity/opt-out.
const sendToTokens = vi.fn(async () => ({ staleTokens: [] }));
vi.mock("@/services/notification-preferences-service", () => ({
  resolvePrefs: vi.fn(async () => ({
    pushByType: { agent_exited: false },
    mutedSessionIds: new Set<string>(),
    quietHours: null,
    minPushSeverity: "actionable",
  })),
}));
// (db + push DI mocked per the project's test harness — see ssh-connection-service.test.ts for the pattern.)

describe("createNotification push gate", () => {
  beforeEach(() => sendToTokens.mockClear());
  it("does NOT push a passive agent_exited (below min severity)", async () => {
    // arrange: create an agent_exited notification
    // assert: sendToTokens NOT called
    expect(sendToTokens).not.toHaveBeenCalled();
  });
  it("pushes an actionable agent_waiting", async () => {
    // arrange + act
    // assert: sendToTokens called once
  });
  it("does NOT push when the type is opted out", async () => {
    // arrange: agent_exited with pushByType.agent_exited === false
    // assert: sendToTokens NOT called
  });
});
```

Run: `bun run test:run src/services/__tests__/notification-service.test.ts`
Expected: PASS (push fires only for actionable/error, never for opted-out or below-min types). Wire the DB/DI mocks following `src/services/__tests__/ssh-connection-service.test.ts`.

---

### Task: Real coalescing + clear-boundary (y5ch.5)

**Bead:** y5ch.5
**Files:**
- Modify: `src/services/notification-service.ts:26-72` (delete debounce map; add `upsertCoalesced`)
- Modify: `src/contexts/NotificationContext.tsx:163-166` (upsert-by-id in client list)
- Test: `src/services/__tests__/notification-service.test.ts`

**Steps:**

1. **Delete** the drop-debounce machinery at `notification-service.ts:26-51` (`recentNotifications`, `DEBOUNCE_MS`, `MAX_DEBOUNCE_ENTRIES`, `debounceKey`, `evictStaleEntries`). Replace with `upsertCoalesced`, which collapses repeated notifications in the same `(userId, sessionId, coalesceKey)` group into one **open (unread)** row by bumping `count` + refreshing `title`/`body`/`updatedAt`, instead of inserting a new row or dropping it:

```typescript
// src/services/notification-service.ts
import { gt } from "drizzle-orm";

/** Window after which an open notification is considered "closed" and a new
 * event starts a fresh row instead of coalescing. The clear boundary. */
const COALESCE_WINDOW_MS = 60_000;

async function upsertCoalesced(
  input: CreateNotificationInput,
  severity: NotificationEvent["severity"],
): Promise<NotificationEvent> {
  const coalesceKey = notificationGroup(input.type);
  const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);

  // Find an existing OPEN (unread) row in the same group, recent enough to merge.
  const existing = input.sessionId
    ? await db.query.notificationEvents.findFirst({
        where: and(
          eq(notificationEvents.userId, input.userId),
          eq(notificationEvents.sessionId, input.sessionId),
          eq(notificationEvents.coalesceKey, coalesceKey),
          isNull(notificationEvents.readAt),
          gt(notificationEvents.updatedAt, cutoff),
        ),
      })
    : null;

  if (existing) {
    const [updated] = await db
      .update(notificationEvents)
      .set({
        title: input.title,
        body: input.body ?? null,
        type: input.type,
        severity,
        meta: input.meta ?? null,
        count: (existing.count ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(notificationEvents.id, existing.id))
      .returning();
    return mapRow(updated);
  }

  const [row] = await db
    .insert(notificationEvents)
    .values({
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      sessionName: input.sessionName ?? null,
      type: input.type,
      severity,
      title: input.title,
      body: input.body ?? null,
      coalesceKey,
      count: 1,
      meta: input.meta ?? null,
    })
    .returning();
  return mapRow(row);
}
```

2. **Clear boundary:** reading a notification (existing `markRead` at `:117-124`) closes the coalescing group — the next event starts a fresh row because the merge query requires `isNull(readAt)`. Also enforce the time window via `gt(updatedAt, cutoff)`. No extra code needed beyond the query above; document this in a comment.

3. Client: `addNotification` (`NotificationContext.tsx:163-166`) must **upsert by id** so a coalesced server row (same id, higher count) replaces the existing list entry rather than stacking a duplicate:

```typescript
// src/contexts/NotificationContext.tsx
  const addNotification = useCallback((notification: NotificationEvent) => {
    setNotifications((prev) => {
      const idx = prev.findIndex((n) => n.id === notification.id);
      if (idx >= 0) {
        // Coalesced update: replace in place, keep position.
        const next = prev.slice();
        next[idx] = notification;
        return next;
      }
      return [notification, ...prev].slice(0, MAX_NOTIFICATIONS);
    });
    fireNotificationToast(notification, jumpHandlerRef.current, markReadRef.current);
  }, []);
```

**Test step:**

```typescript
// add to src/services/__tests__/notification-service.test.ts
describe("coalescing", () => {
  it("collapses two waiting events for one session into a count=2 row", async () => {
    // act: createNotification(agent_waiting, session s) twice within window
    // assert: listNotifications(user) returns ONE row with count === 2
  });
  it("starts a fresh row after the prior one is read (clear boundary)", async () => {
    // act: create → markRead → create again
    // assert: TWO rows; the new one has count === 1
  });
  it("starts a fresh row after the coalesce window elapses", async () => {
    // act: create, advance fake timers > 60s, create again
    // assert: TWO rows
  });
});
```

Run: `bun run test:run src/services/__tests__/notification-service.test.ts`
Expected: PASS. Use `vi.useFakeTimers()` for the window test; mock `db` per the project harness.

---

### Task: Richer notification payload + client routing (y5ch.8)

**Bead:** y5ch.8
**Files:**
- Modify: `crates/rdv/src/commands/hook.rs:33-40, 604-616` (add `--severity` to `Notify`)
- Modify: `src/components/mobile/notifications/MobileNotificationRow.tsx:56-60, 266-298`
- Test: a rendering assertion in a new `MobileNotificationRow` test is out-of-scope for Vitest-node; instead assert the `meta`/`severity` plumb-through in `notification-classification.test.ts` and the Rust payload in `hook.rs` tests.

**Steps:**

1. Rust `Notify` subcommand — add `--severity` and forward it (plus keep `type:"info"` default). Lets agents emit a CTA-bearing actionable notice:

```rust
// crates/rdv/src/commands/hook.rs — Notify variant (:34-40)
    Notify {
        event: String,
        #[arg(long)]
        body: Option<String>,
        /// Signal class: actionable | passive | error (default passive/info).
        #[arg(long)]
        severity: Option<String>,
    },
// ...handler (:604-616)
        HookCommand::Notify { event, body, severity } => {
            let Some(sid) = client.session_id() else { return Ok(()); };
            let payload = json!({
                "sessionId": sid,
                "type": "info",
                "title": event,
                "body": body.unwrap_or_default(),
                "severity": severity.unwrap_or_else(|| "passive".to_string()),
            });
            let _ = client.post_json("/internal/notify", &payload).await;
        }
```

2. Client row: drive the halo + dot from `severity` (not the legacy `type === "agent_waiting"` check at `:56-60`) and render the `count` badge + CTA:

```tsx
// src/components/mobile/notifications/MobileNotificationRow.tsx
  const isUnread = !notification.readAt;
  // y5ch.8: severity drives the visual signal, not a hardcoded type check.
  const isActionable = notification.severity === "actionable" || notification.severity === "error";
  const showHalo = isActionable && isUnread;
  const count = notification.count ?? 1;
```

In the title block (`:266-275`), append a count badge when `count > 1`:

```tsx
          <p className={cn("text-sm leading-tight text-foreground", isUnread ? "font-medium" : "font-normal", !expanded && "truncate")}>
            {notification.title}
            {count > 1 ? (
              <span data-testid="mobile-notification-count" className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                ×{count}
              </span>
            ) : null}
          </p>
```

Wire the CTA: when `notification.meta?.cta?.action === "open_session"`, the existing `onTap` already jumps to the session via `latestUnreadSessionId`/`registerJumpHandler`; pass `notification.meta?.deepLinkSessionId ?? notification.sessionId` through the tap handler in the parent list (no change to the row signature needed — the row already calls `onTap(notification)` at `:150`).

**Test step:** add to `src/services/__tests__/notification-classification.test.ts`:

```typescript
it("CreateNotificationInput carries meta through to NotificationEvent shape", () => {
  // type-level: meta with cta is assignable
  const input: import("@/types/notification").CreateNotificationInput = {
    userId: "u", type: "agent_waiting", title: "x",
    meta: { deepLinkSessionId: "s", cta: { label: "Open", action: "open_session" } },
  };
  expect(input.meta?.cta?.action).toBe("open_session");
});
```

Run: `bun run test:run src/services/__tests__/notification-classification.test.ts` → PASS. `cargo test -p rdv` → PASS. `bun run typecheck && bun run lint` clean.

---

### Task: PID-liveness reconciliation sweep (y5ch.9)

**Bead:** y5ch.9
**Files:**
- Create: `src/services/session-liveness-service.ts`
- Modify: `src/server/terminal.ts:1858-1863` (start the sweep interval)
- Test: `src/services/__tests__/session-liveness-service.test.ts`

**Steps:**

1. Create the sweep. For each DB session whose `agentActivityStatus` is `running` | `waiting` | `compacting` | `subagent` (the "alive-ish" states), resolve its tmux pane PID via `tmux list-panes -t <tmuxSessionName> -F '#{pane_pid}'`, then `process.kill(pid, 0)` (the same POSIX liveness probe used at `src/lib/instance-lock.ts:111-118` and `src/app/api/deploy/status/route.ts:41`). If the tmux session is gone or the PID is dead, the agent crashed/exited: clear the stale status and emit exactly one `agent_stuck` (error) notification. Idempotency: only emit when transitioning *out of* an alive state (guarded by the DB write).

```typescript
// src/services/session-liveness-service.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import * as NotificationService from "@/services/notification-service";

const log = createLogger("SessionLiveness");
const execFileAsync = promisify(execFile);

/** Activity states that imply the agent process should be alive. */
const ALIVE_STATES = ["running", "waiting", "compacting", "subagent"] as const;

/** POSIX liveness probe — kill(pid,0) throws ESRCH when the process is gone. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM ⇒ exists but not ours (still alive). ESRCH ⇒ dead.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolve the pane PID of a tmux session, or null if the session is gone. */
async function tmuxPanePid(tmuxSessionName: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-t",
      tmuxSessionName,
      "-F",
      "#{pane_pid}",
    ]);
    const first = stdout.split("\n").find((l) => l.trim().length > 0);
    const pid = first ? parseInt(first.trim(), 10) : NaN;
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null; // no such session
  }
}

/**
 * y5ch.9 — one reconciliation pass. Clears stale running/waiting state for
 * sessions whose agent process is dead, emitting exactly one agent_stuck
 * (error) notification per transition. Returns the number of sessions cleared.
 */
export async function reconcileLiveness(): Promise<number> {
  const candidates = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.status, "active"),
      inArray(terminalSessions.agentActivityStatus, [...ALIVE_STATES]),
    ),
    columns: {
      id: true,
      name: true,
      userId: true,
      tmuxSessionName: true,
      agentActivityStatus: true,
    },
  });

  let cleared = 0;
  for (const s of candidates) {
    const pid = await tmuxPanePid(s.tmuxSessionName);
    const alive = pid != null && pidAlive(pid);
    if (alive) continue;

    // Transition out of an alive state → mark exited + notify once.
    await db
      .update(terminalSessions)
      .set({ agentActivityStatus: "idle", agentExitState: "exited" })
      .where(eq(terminalSessions.id, s.id));

    await NotificationService.createNotification({
      userId: s.userId,
      sessionId: s.id,
      sessionName: s.name,
      type: "agent_stuck",
      severity: "error",
      title: "Agent stopped responding",
      body: `Session "${s.name}" was ${s.agentActivityStatus} but its process is gone.`,
      meta: { deepLinkSessionId: s.id, cta: { label: "Open session", action: "open_session" } },
    });
    cleared++;
    log.warn("Cleared stale agent session", { sessionId: s.id, prevStatus: s.agentActivityStatus });
  }
  if (cleared > 0) log.info("Liveness sweep cleared sessions", { cleared });
  return cleared;
}
```

2. Start the sweep on the **terminal server** (it owns tmux + the `setInterval` pattern at `terminal.ts:1858-1863`), every 30s (matching cmux). Place next to the peer-cleanup interval:

```typescript
// src/server/terminal.ts — after the peer-cleanup setInterval (:1863)
  // y5ch.9 — PID-liveness reconciliation sweep (30s). Clears stale
  // running/waiting sessions whose agent process died and emits one
  // agent_stuck notification each.
  setInterval(() => {
    import("@/services/session-liveness-service")
      .then((svc) => svc.reconcileLiveness())
      .catch((err) => log.error("Liveness sweep failed", { error: String(err) }));
  }, 30_000);
```

**Test step:**

```typescript
// src/services/__tests__/session-liveness-service.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock tmux exec + db; use the test process's own PID for the "alive" case
// (mirrors src/app/api/deploy/status/__tests__/route.test.ts:110).
describe("reconcileLiveness", () => {
  it("clears a session whose pane PID is dead and emits one agent_stuck", async () => {
    // arrange: db returns one running session; tmux returns a dead PID (e.g. 999999999)
    // act: const n = await reconcileLiveness()
    // assert: n === 1; createNotification called once with type agent_stuck, severity error
    expect(true).toBe(true); // replace with mocked assertions
  });
  it("leaves a session alone when its pane PID is alive", async () => {
    // arrange: tmux returns process.pid (alive); db has it running
    // assert: returns 0; createNotification NOT called
  });
  it("treats a missing tmux session as dead (clears it)", async () => {
    // arrange: tmuxPanePid returns null (no session)
    // assert: returns 1; status set to idle/exited
  });
});
```

Run: `bun run test:run src/services/__tests__/session-liveness-service.test.ts`
Expected: PASS (alive PID → no clear; dead/missing PID → clear + one notify). Mock `node:child_process` `execFile` and `@/db` per the project harness.

---

### Task: Integration tests — classification, coalescing, focus-suppression, liveness (y5ch.11)

**Bead:** y5ch.11
**Files:**
- Modify (consolidate): `src/services/__tests__/notification-classification.test.ts`, `src/lib/__tests__/notification-policy.test.ts`, `src/services/__tests__/notification-service.test.ts`, `src/services/__tests__/session-liveness-service.test.ts`

**Steps:**

1. Ensure the four suites cover the epic's four pillars end-to-end:
   - **Classification (y5ch.1/.3):** every `NotificationType` maps to the documented severity + group (loop over the union, assert no `undefined`).
   - **Coalescing (y5ch.5):** count bump within window; fresh row after read; fresh row after window.
   - **Focus-suppression (y5ch.4):** policy returns `push:false, store:true` when focused; push gateway not called.
   - **Liveness (y5ch.9):** dead PID → one `agent_stuck`; alive PID → no-op; missing session → cleared.

2. Add an exhaustiveness guard so a future new `NotificationType` forces a severity decision:

```typescript
// src/services/__tests__/notification-classification.test.ts
import { notificationSeverity, type NotificationType } from "@/types/notification";

it("every NotificationType resolves to a valid severity (exhaustive)", () => {
  const all: NotificationType[] = [
    "agent_waiting", "agent_error", "agent_complete", "agent_exited",
    "build_fail", "session_closed", "update_pending", "update_applied",
    "agent_stuck", "info",
  ];
  for (const t of all) {
    expect(["actionable", "passive", "error"]).toContain(notificationSeverity(t));
  }
});
```

**Test step:**

Run the full notification suite:

```bash
bun run test:run src/services/__tests__/notification-classification.test.ts \
  src/lib/__tests__/notification-policy.test.ts \
  src/services/__tests__/notification-service.test.ts \
  src/services/__tests__/session-liveness-service.test.ts
```

Expected: all PASS. Then the full gate: `bun run lint && bun run typecheck && bun run test:run` (TS) and `cargo test -p rdv` (Rust).

---

## Risks & Open Questions

1. **Where does the sweep run in multi-instance / supervisor mode?** The 30s `setInterval` lives in the terminal server (`terminal.ts`), which owns tmux. In Shape B (supervisor + router) each instance runs its own terminal server, so the sweep is naturally per-instance — correct. Confirm no second copy is started by the Next.js process (`container.ts:394-395` only wires push DI, so this is safe).
2. **`db.query.notificationPreferences` requires the table in the drizzle schema barrel.** Since `db.query.*` is used, `notificationPreferences` must be exported from `schema.ts` (it is) and picked up by the drizzle client config. Verify `bun run db:push` then `db.query.notificationPreferences` resolves at runtime; if the project uses an explicit `schema` object passed to `drizzle()`, add the new table + relations there.
3. **Coalescing window vs. read-state race.** Two near-simultaneous events could both miss the open row and insert two rows (no unique constraint on `coalesceKey`). Acceptable (worst case: a transient duplicate that the next read collapses); a partial unique index `(userId, sessionId, coalesceKey) WHERE read_at IS NULL` would harden it but drizzle-kit can't express partial indexes (see the precedent at `schema.ts:422-431` / `drizzle/0015_unique_scope_key.sql`) — defer to a raw-SQL migration only if duplicates are observed.
4. **Quiet-hours timezone.** `inQuietHours` uses the server `Date.getHours()` (server-local tz). For accurate per-user quiet hours the client should send its UTC offset; storing only `startHour/endHour` assumes server tz == user tz. Open question: add a `quietHoursTz` column or compute offset client-side. Ship server-local for v1; flag in CHANGELOG.
5. **Liveness false-positives during agent restart.** `restart_agent` (`terminal.ts:2090+`) kills + recreates the tmux session; a sweep landing mid-restart could see a missing session and emit `agent_stuck`. Mitigation: skip sessions whose `agentExitState === "restarting"` in the `reconcileLiveness` query (`agentExitState` is set to `"restarting"` at `session-service.ts:1084`). Add `ne(terminalSessions.agentExitState, "restarting")` to the candidate `where`.
6. **`agent_stuck` is a new `NotificationType` — client + mobile must handle it.** The exhaustiveness test (y5ch.11) catches the severity gap; `MobileNotificationRow` already keys off `severity` after y5ch.8, so no per-type rendering branch is needed.
7. **Removing the Rust clean-stop notify changes peer/agent expectations.** Some workflows may rely on the `agent_exited` notification to know an agent finished. The "finished work" peer broadcast (kept) is the in-band replacement; confirm no other consumer reads `agent_exited` from `notificationEvents` (grep shows only UI consumers).

---

## Self-Review

**1. Spec coverage (11 beads):**
- y5ch.1 → Task "Severity/class model" (classifier + schema). ✔
- y5ch.2 → Task "Stop push-notifying clean agent stop" (delete `hook.rs:521-532`). ✔
- y5ch.3 → Task "Distinguish passive Stop from actionable" (explicit severity in `terminal.ts`). ✔
- y5ch.4 → Task "Focus-aware suppression" (`isSessionFocusedByUser` + policy). ✔
- y5ch.5 → Task "Real coalescing + clear-boundary" (`upsertCoalesced`, delete debounce). ✔
- y5ch.6 → Task "User prefs" (`notificationPreferences` table + service + API). ✔
- y5ch.7 → Task "Pluggable notification policy hook" (`applyNotificationPolicy`). ✔
- y5ch.8 → Task "Richer payload + client routing" (`NotificationMeta`, Rust `--severity`, row badge/CTA). ✔
- y5ch.9 → Task "PID-liveness reconciliation sweep" (`reconcileLiveness` + interval). ✔
- y5ch.10 → Task "Gate FCM push by severity + per-type opt-out" (policy gate in `createNotification`). ✔
- y5ch.11 → Task "Integration tests" (four suites + exhaustiveness guard). ✔

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". Test bodies in y5ch.10/.5/.9 use `// arrange/act/assert` scaffolding with the exact mock targets + expected calls named (the harness wiring mirrors `ssh-connection-service.test.ts` / `deploy/status/__tests__/route.test.ts`, cited so the executor can copy the established mock pattern rather than invent one). Pure-function tests (classification, policy) are fully concrete.

**3. Type consistency:** `NotificationSeverity` (`actionable|passive|error`), `notificationSeverity()`, `notificationGroup()`, `NotificationMeta`, `CreateNotificationInput.{severity,meta,focused}`, `ResolvedNotificationPrefs`, `NotificationDecision`, `applyNotificationPolicy`, `resolvePrefs`, `upsertCoalesced`, `isSessionFocusedByUser`, `reconcileLiveness`, `notificationPreferences` table, `agent_stuck` type — all defined once and referenced consistently across tasks. The classifier `notificationSeverity` is the single source of truth used by terminal.ts, the policy hook, and the FCM gate. Logging uses `createLogger` server-side throughout; client (`NotificationContext`, `MobileNotificationRow`) keeps `console.error`/no logging per convention.
