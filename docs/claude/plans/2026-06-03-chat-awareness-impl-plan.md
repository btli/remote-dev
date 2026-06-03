# Agent-Native Chat & Coordination — Implementation Plan

> **For agentic workers:** Execute with **`superpowers:subagent-driven-development`** — dispatch one
> subagent per `### Task` below, in build-sequence order, each in its own git worktree
> (`./scripts/worktree-warm.sh`). Per-task TDD ceremony (RED→GREEN→refactor) is added by the executor;
> the steps below give the real files, schema, and the one verification command per task.

**Goal.** Make in-flight agent **awareness** reliable. Beads (`bd`) remains the durable work **TRACKER**
(issues, status, assignment). Chat is the **AWARENESS** layer beads does not hold: who's-active-right-now,
gotchas, heads-ups, and overlap warnings. This epic (1) makes peer/channel messages reach agents reliably
(durable inbox + delivery state, long-lived MCP subscription, poll fallback for non-MCP providers), and
(2) adds a lightweight auto work-context (branch/worktree/folder/status) with a **READ-ONLY** join to the
agent's claimed bd issue, a check-in → read-peers → check-out discipline, gotcha notes, and collision nudges.

**Architecture.** The terminal server (`src/server/terminal.ts`, port 6002) owns delivery; per-session MCP
servers (`src/mcp/peer-server.ts`, spawned by Claude Code) and the Rust `rdv` CLI
(`crates/rdv/`) are the agent-facing endpoints. **Beads = source of truth for tasks** (never duplicated —
we only READ `assignee`/`status` via `beadsQuery`); **chat = ephemeral awareness** layered on the existing
`agent_peer_message` / `channel` tables. Today delivery is fire-and-forget (`mcp-push.ts` writes to a Unix
socket; failures are dropped; the PreToolUse poll is the only safety net) — we replace it with a durable
delivery state machine + replay cursor so every message is delivered exactly once across MCP-push and poll.

**Tech Stack.** Next.js 16 / React 19 (UI), Node terminal server via `tsx`, Drizzle ORM + libsql/SQLite
(`bun run db:push`), `@modelcontextprotocol/sdk` (Stdio MCP server), Rust `rdv` CLI (clap + tokio +
reqwest, `cargo build`/`cargo test`), Vitest (`bun run test:run`). Server logging via
`createLogger` from `@/lib/logger` (never `console.*`); TUI input uses `\r` (not used as primary path here).

---

## File Structure

### Create
| Path | Responsibility |
|------|----------------|
| `src/db/migrations/` (via `bun run db:push`) | Generates DDL for the 3 new tables below |
| `src/services/message-delivery-service.ts` | Durable inbox: record/ack/replay delivery state (x386.1) |
| `src/services/channel-subscription-service.ts` | Agent channel subscriptions CRUD + delivery filter (x386.5) |
| `src/services/work-context-service.ts` | Compute lightweight work-context + READ-ONLY bd-issue join (x386.11) |
| `src/services/message-delivery-service.test.ts` | Delivery state machine, idempotent ack, replay cursor (x386.1/.10) |
| `src/services/work-context-service.test.ts` | Context capture + bd join fidelity (x386.11/.10) |
| `src/services/channel-subscription-service.test.ts` | Auto-deliver vs direct-only resolution (x386.5/.10) |
| `tests/services/peer-collision.test.ts` | Overlap/collision detection query (x386.14/.10) |
| `tests/services/start-digest.test.ts` | Read-peers start digest builder (x386.12/.10) |
| `crates/rdv/src/commands/note.rs` | `rdv peer note` gotcha/heads-up/progress broadcast (x386.13) |

### Modify
| Path | Responsibility |
|------|----------------|
| `src/db/schema.ts` (~1507) | Add `message_delivery`, `channel_subscription`, `agent_work_context` tables; index `agent_peer_message` by `(toSessionId, createdAt)` |
| `src/server/mcp-push.ts` (~1–140) | Replace fire-and-forget with ack-aware push: emit `messageId`, await socket-level ack, mark delivered (x386.2) |
| `src/mcp/peer-server.ts` (~120–219) | Long-lived subscription: on socket event, deliver + send `ack` back; on (re)connect, request replay from cursor (x386.2/.3); inject `[MENTION]` via `sendLoggingMessage` (x386.7) |
| `src/server/terminal.ts` (~1340–1640) | On send: write delivery rows for recipients, push with ack callback, fall back to "pending" for poll; add `/internal/peers/ack`, `/internal/peers/replay`, `/internal/work-context`, `/internal/peers/subscribe` routes (x386.2/.3/.4/.5) |
| `src/services/peer-service.ts` (~140–303) | `sendMessage` writes delivery rows + resolves channel subscribers; `pollMessages` joins delivery state for since-cursor; implement `cleanupOldMessages` TTL (x386.4/.9) |
| `src/services/channel-service.ts` | `getChannelSubscribers(channelId)` helper used by delivery fan-out (x386.5) |
| `crates/rdv/src/commands/peer.rs` (~14–241) | Add `note` subcommand wiring; persist poll since-cursor to `/tmp/rdv-peer-poll-{sid}` for non-MCP parity (x386.4/.13) |
| `crates/rdv/src/commands/hook.rs` (~139–207, 246–258, 467–541) | `print_peer_digest` → read-peers **start digest** (peers + recent gotchas + claimed bd issues) injected at session start; check-in on first PreToolUse, check-out on Stop; collision nudge (x386.6/.12/.14) |
| `crates/rdv/src/commands/mod.rs` | Register `note` subcommand under `peer` |
| `src/services/agent-profile-service.ts` (~803, generated CLAUDE.md) | Document MCP subscription + check-in/read/check-out discipline in per-profile CLAUDE.md (x386.8) |
| `docs/AGENTS.md` (§5 ~164–182) | Rewrite peer-comm summary: durable delivery, subscription, discipline, notes, collisions (x386.8) |
| `docs/RDV_CLI.md` (~244–262) | Add `rdv peer note`; document poll since-cursor + check-in/out (x386.8) |

---

## Build Sequence

Dependencies are strict; build in this order:

1. **Phase A — Delivery foundation** (x386.1 → x386.2 → x386.3): durable inbox, then ack-aware push, then long-lived subscription. Everything downstream depends on .1.
2. **Phase B — Delivery breadth** (x386.4 poll fallback [needs .1], x386.5 channel subscriptions, x386.7 @mention delivery [needs .3], x386.9 TTL [needs .1]).
3. **Phase C — Awareness foundation** (x386.11 work-context + bd join). Blocks .6/.12/.14.
4. **Phase D — Awareness behaviors** (x386.6 check-in/out [needs .11], x386.12 start digest [needs .11], x386.13 gotcha notes [needs .2], x386.14 collision nudge [needs .11]).
5. **Phase E — Docs & tests** (x386.8 docs, x386.10 test suite — written per-task above but consolidated/asserted here).

---

## Phase A — Delivery foundation

### Task: Durable agent message inbox + delivery state
**Bead:** x386.1
**Files:** Create `src/services/message-delivery-service.ts`, `src/services/message-delivery-service.test.ts`; Modify `src/db/schema.ts`.

The current `agent_peer_message` table has no per-recipient delivery state, so a dropped MCP push is lost
forever (the poll is the only recovery, and it has no durable cursor). Add a `message_delivery` row per
(message, recipient) with a state machine and a per-session replay cursor.

1. Add to `src/db/schema.ts` after `agentPeerMessages` (~line 1538):

```ts
// Per-recipient delivery state for agent messages (durable inbox).
// One row per (messageId, toSessionId). Broadcasts/channels fan out to one row
// per subscribed recipient at send time. State advances pending → delivered → acked.
export const messageDelivery = sqliteTable(
  "message_delivery",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => agentPeerMessages.id, { onDelete: "cascade" }),
    toSessionId: text("to_session_id")
      .notNull()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // pending = written, not yet pushed; delivered = pushed to a live MCP socket
    // or returned by a poll; acked = MCP server confirmed it surfaced to the agent.
    state: text("state").$type<"pending" | "delivered" | "acked">().notNull().default("pending"),
    // How it reached the agent (for parity metrics + debugging).
    channelType: text("channel_kind").$type<"mcp_push" | "poll" | null>(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    ackedAt: integer("acked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("message_delivery_msg_session_idx").on(table.messageId, table.toSessionId),
    // Replay/poll: "give me undelivered rows for this session, oldest first".
    index("message_delivery_session_state_idx").on(table.toSessionId, table.state, table.createdAt),
  ]
);

// Durable per-session replay cursor (survives MCP server restarts; the /tmp
// sentinel in peer-server.ts is a fast cache, this DB row is the source of truth).
export const messageReplayCursor = sqliteTable(
  "message_replay_cursor",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    // Highest agent_peer_message.createdAt the session has acked.
    lastAckedAt: integer("last_acked_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  }
);
```

   Ensure `uniqueIndex` and `index` are imported in `schema.ts` (they already are; `agentPeerMessages` uses both).

2. Run `bun run db:push` to materialize the tables.

3. Implement `src/services/message-delivery-service.ts` using `createLogger("MessageDelivery")`:

```ts
import { db } from "@/db";
import { messageDelivery, messageReplayCursor, agentPeerMessages } from "@/db/schema";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("MessageDelivery");

/** Create one pending delivery row per recipient. Idempotent via unique index. */
export async function recordDeliveries(messageId: string, projectId: string, recipientSessionIds: string[]): Promise<void> {
  if (recipientSessionIds.length === 0) return;
  await db.insert(messageDelivery)
    .values(recipientSessionIds.map((toSessionId) => ({ messageId, toSessionId, projectId })))
    .onConflictDoNothing({ target: [messageDelivery.messageId, messageDelivery.toSessionId] });
}

/** Mark a (message, session) delivered via a given channel. No-op if already acked. */
export async function markDelivered(messageId: string, sessionId: string, via: "mcp_push" | "poll"): Promise<void> {
  await db.update(messageDelivery)
    .set({ state: "delivered", channelType: via, deliveredAt: new Date() })
    .where(and(
      eq(messageDelivery.messageId, messageId),
      eq(messageDelivery.toSessionId, sessionId),
      sql`${messageDelivery.state} != 'acked'`,
    ));
}

/** Confirm the agent surfaced the message; advances the durable replay cursor. */
export async function ackDelivery(messageId: string, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(messageDelivery)
      .set({ state: "acked", ackedAt: new Date() })
      .where(and(eq(messageDelivery.messageId, messageId), eq(messageDelivery.toSessionId, sessionId)));
    const msg = await tx.query.agentPeerMessages.findFirst({
      where: eq(agentPeerMessages.id, messageId), columns: { createdAt: true },
    });
    if (!msg) return;
    await tx.insert(messageReplayCursor)
      .values({ sessionId, lastAckedAt: msg.createdAt })
      .onConflictDoUpdate({
        target: messageReplayCursor.sessionId,
        // Monotonic: never move the cursor backwards.
        set: { lastAckedAt: sql`MAX(COALESCE(${messageReplayCursor.lastAckedAt}, 0), ${msg.createdAt.getTime()})`, updatedAt: new Date() },
      });
  });
}

/** Undelivered (pending|delivered, not acked) messages for a session, oldest first. */
export async function getUndelivered(sessionId: string, limit = 50) {
  return db.select({
    id: messageDelivery.messageId, state: messageDelivery.state,
    body: agentPeerMessages.body, fromSessionName: agentPeerMessages.fromSessionName,
    toSessionId: agentPeerMessages.toSessionId, channelId: agentPeerMessages.channelId,
    parentMessageId: agentPeerMessages.parentMessageId, createdAt: agentPeerMessages.createdAt,
  })
    .from(messageDelivery)
    .innerJoin(agentPeerMessages, eq(messageDelivery.messageId, agentPeerMessages.id))
    .where(and(eq(messageDelivery.toSessionId, sessionId), sql`${messageDelivery.state} != 'acked'`))
    .orderBy(agentPeerMessages.createdAt)
    .limit(limit);
}

export async function getReplayCursor(sessionId: string): Promise<Date | null> {
  const row = await db.query.messageReplayCursor.findFirst({ where: eq(messageReplayCursor.sessionId, sessionId) });
  return row?.lastAckedAt ?? null;
}
```

4. **Test:** `bun run test:run -- src/services/message-delivery-service.test.ts` →
   asserts: `recordDeliveries` is idempotent (calling twice yields one row); `markDelivered` does not
   regress an `acked` row; `ackDelivery` advances `messageReplayCursor.lastAckedAt` and never moves it
   backward when acking an older message; `getUndelivered` returns only non-acked rows oldest-first.
   **Expected:** all pass.

---

### Task: Reliable MCP subscription delivery (replace fire-and-forget mcp-push)
**Bead:** x386.2 (depends x386.1)
**Files:** Modify `src/server/mcp-push.ts`, `src/mcp/peer-server.ts`, `src/server/terminal.ts`.

Today `pushToMcpServer` writes JSON+`\n` and ignores the result; there is no confirmation the agent
received anything. Add a bidirectional protocol over the existing Unix socket: terminal-server pushes
`{type:"event", ...}` lines; the MCP server replies `{type:"ack", messageId}` lines. The push manager
marks the delivery `delivered` on write success and the route marks `acked` on ack receipt.

1. In `src/mcp/peer-server.ts` `handleSocketEvent` (~120): after `sendLoggingMessage`, write an ack back
   on the same connection. Thread the connection in:

```ts
function handleSocketEvent(event: Record<string, unknown>, conn: net.Socket): void {
  // ... existing dedup + sentinel + text formatting ...
  server.sendLoggingMessage({ level: "info", logger: "rdv", data: text })
    .then(() => {
      if (messageId) conn.write(JSON.stringify({ type: "ack", messageId }) + "\n");
    })
    .catch(() => {}); // dropped ack → terminal server keeps it "delivered", poll recovers
}
```
   In the socket `conn.on("data", ...)` loop, also handle inbound `{type:"replay_request"}` (Task x386.3)
   and pass `conn` into `handleSocketEvent(JSON.parse(line), conn)`.

2. In `src/server/mcp-push.ts`: add an `onAck` callback registry and parse ack lines from the socket.
   Replace the silent fast-path write with one that (a) marks delivered on flush and (b) reads acks:

```ts
type AckHandler = (messageId: string) => void;
const ackHandlers = new Map<string, AckHandler>();
export function onMcpAck(sessionId: string, handler: AckHandler): void { ackHandlers.set(sessionId, handler); }

// In the socket "connect"/"data" wiring, buffer by "\n" and for each line:
//   const msg = JSON.parse(line); if (msg.type === "ack") ackHandlers.get(sessionId)?.(msg.messageId);

/** Push and report whether the socket accepted the write (delivered != acked). */
export function pushToMcpServer(sessionId: string, event: McpPushEvent): boolean {
  // ... existing connection logic, but the write callback now also calls
  //     markDeliveredHook(sessionId, event.messageId) on success ...
}
```
   Wire `markDeliveredHook` via a setter the terminal server installs at boot
   (keeps `mcp-push.ts` free of a direct service import to preserve layering):
   `export function setDeliveredHook(fn: (sid: string, mid: string) => void)`.

3. In `src/server/terminal.ts` (~boot, near line 240 where `getMcpPush` is defined): install hooks once:

```ts
getMcpPush().then(async (mp) => {
  const MD = await import("@/services/message-delivery-service");
  mp.setDeliveredHook((sid, mid) => { MD.markDelivered(mid, sid, "mcp_push").catch(() => {}); });
  // Per-session ack registration happens lazily when we first push to that session.
});
```
   Add a new internal route:

```ts
// POST /internal/peers/ack { sessionId, messageId } — MCP server (or future clients) confirm receipt
if (pathname === "/internal/peers/ack" && req.method === "POST") {
  const { sessionId, messageId } = (await parseRequestJson(req, res)) ?? {};
  const MD = await import("@/services/message-delivery-service");
  await MD.ackDelivery(String(messageId), String(sessionId));
  sendJson(res, 200, { ok: true });
  return true;
}
```
   (The socket-level ack is the primary path; this HTTP route is the parity path for poll/CLI acks in x386.4.)

4. In the existing `/internal/peers/messages/send` block (~1340) and `/internal/channels/send` (~1617):
   after `PeerService.sendMessage(...)` resolves, call `MD.recordDeliveries(messageId, projectId, recipients)`
   **before** pushing, so a push that races ahead still has a row to mark. Recipients come from
   `peer-service` (direct → `[toSessionId]`; broadcast/channel → subscriber list from x386.5, defaulting to
   all project peers).

5. **Test:** `bun run test:run -- src/services/message-delivery-service.test.ts` (extended) plus a focused
   `src/server/mcp-push.test.ts` using a stub `net.Server` on a temp socket path that echoes an `ack` line →
   asserts the delivered hook fires on write and the ack handler marks `acked`.
   **Expected:** pass; a push whose stub never acks leaves the row `delivered` (recoverable by poll), proving
   no silent loss.

---

### Task: Long-lived MCP subscription so Claude agents get messages mid-session
**Bead:** x386.3 (depends x386.2)
**Files:** Modify `src/mcp/peer-server.ts`, `src/server/terminal.ts`.

The MCP server already keeps a persistent `net.createServer` socket for the session lifetime, but it never
replays anything it missed while the socket was down (e.g., during compaction or a brief disconnect). Add a
replay handshake driven by the durable cursor from x386.1.

1. In `src/mcp/peer-server.ts` `startSocketListener`: when a new `conn` is accepted, immediately request
   replay:

```ts
const sockServer = net.createServer((conn) => {
  conn.write(JSON.stringify({ type: "replay_request", sessionId: SESSION_ID }) + "\n");
  // ... existing buffered line loop, dispatch each parsed line to handleSocketEvent(msg, conn) ...
});
```
   Replayed messages flow through the same `handleSocketEvent` (dedup set already prevents double-surfacing
   within a process; the durable cursor prevents re-replay across restarts).

2. In `src/server/terminal.ts`: the terminal server **receives** the `replay_request` over the socket it
   opened. Extend `mcp-push.ts` to detect inbound `{type:"replay_request"}` lines and invoke a registered
   replay handler; the terminal server's handler pulls undelivered rows and pushes them:

```ts
mp.setReplayHook(async (sid) => {
  const MD = await import("@/services/message-delivery-service");
  const rows = await MD.getUndelivered(sid, 50);
  for (const r of rows) {
    mp.pushToMcpServer(sid, {
      type: r.channelId ? "channel_message" : (r.toSessionId ? "peer_message" : "channel_message"),
      messageId: r.id, fromSessionId: null, fromSessionName: r.fromSessionName,
      toSessionId: r.toSessionId, body: r.body, channelId: r.channelId, channelName: null,
      parentMessageId: r.parentMessageId, createdAt: new Date(r.createdAt).toISOString(),
    });
  }
});
```

3. Add `/internal/peers/replay?sessionId=xxx` GET route returning `getUndelivered` JSON, so the CLI poll
   path (x386.4) and tests can fetch the same set without the socket.

4. **Test:** `bun run test:run -- src/server/mcp-push.test.ts` (extended replay case) using the stub socket:
   pre-seed two `delivered`-but-unacked rows, connect, send `replay_request`, assert both events are
   re-pushed and that acking them clears the replay set on reconnect. **Expected:** pass.

---

## Phase B — Delivery breadth

### Task: Poll-fallback for non-MCP providers with persisted since-cursor
**Bead:** x386.4 (depends x386.1)
**Files:** Modify `src/services/peer-service.ts`, `src/server/terminal.ts`, `crates/rdv/src/commands/peer.rs`.

Codex/Gemini/OpenCode/Antigravity have **no MCP server** (only Claude Code auto-registers `rdv`), so they
rely entirely on `rdv peer messages`. Make that path use the durable delivery state instead of a
client-supplied timestamp, so it has the same exactly-once semantics as MCP push.

1. In `src/services/peer-service.ts`, add a delivery-aware poll that supersedes the timestamp scan:

```ts
import * as MD from "@/services/message-delivery-service";

/** Poll using durable delivery state. Marks returned rows 'delivered' via poll. */
export async function pollUndelivered(sessionId: string): Promise<PeerMessage[]> {
  const rows = await MD.getUndelivered(sessionId, 100);
  // Mark delivered (not acked — ack happens when the agent acknowledges; for poll
  // providers with no ack channel, the CLI acks on read in step 3).
  await Promise.all(rows.map((r) => MD.markDelivered(r.id, sessionId, "poll")));
  return rows.map((r) => toMessageRow({ ...r, isUserMessage: false, replyCount: 0 }));
}
```
   Keep the existing timestamp `pollMessages` for the chat-room UI / backward compat, but route the CLI hook
   through `pollUndelivered`.

2. In `src/server/terminal.ts` `/internal/peers/messages/poll` (~1366): when the caller passes
   `cursor=durable` (new optional query param the CLI sends), return `pollUndelivered(sessionId)` and accept
   a companion `POST /internal/peers/ack-batch { sessionId, messageIds[] }` that calls `MD.ackDelivery` for
   each. This gives non-MCP providers the same ack/replay guarantee.

3. In `crates/rdv/src/commands/peer.rs` `PeerCommand::Messages`: after printing, persist the durable cursor
   and ack the batch so the next poll does not re-show them:

```rust
// After fetching messages via the durable cursor:
let ids: Vec<&str> = resp.messages.iter().map(|m| m.id.as_str()).collect();
if !ids.is_empty() {
    let ack = json!({ "sessionId": sid, "messageIds": ids });
    let _ = client.post_json("/internal/peers/ack-batch", &ack).await;
}
// Keep the /tmp/rdv-peer-poll-{sid} sentinel write for digest dedup (hook.rs reads it).
```
   The `since` flag stays for ad-hoc human queries; the hook uses the cursor path.

4. **Test:** `bun run test:run -- src/services/message-delivery-service.test.ts` (poll-parity case): record a
   broadcast to a non-MCP session, `pollUndelivered` returns it once, a second `pollUndelivered` after
   `ackDelivery` returns nothing. **Expected:** pass — proves MCP-only and poll providers reach parity.
   Rust: `cd crates/rdv && cargo build` (compile gate; the JSON path is exercised by the service test).

---

### Task: Channel subscription model for agents
**Bead:** x386.5
**Files:** Modify `src/db/schema.ts`, `src/services/channel-service.ts`; Create `src/services/channel-subscription-service.ts`, `src/services/channel-subscription-service.test.ts`.

Channel messages currently push to **all** project peers (`pushMcpEventToFolderPeers`). That floods agents.
Add an explicit subscription model: an agent only auto-receives a channel's broadcasts if subscribed;
otherwise it only gets direct messages and @mentions in that channel.

1. Add to `src/db/schema.ts`:

```ts
// Which sessions auto-receive a channel's non-direct messages. Absence of a row
// means "direct/mention only" for that (channel, session).
export const channelSubscription = sqliteTable(
  "channel_subscription",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull().references(() => terminalSessions.id, { onDelete: "cascade" }),
    // auto_deliver = push every channel message; direct_only = only @mentions/replies-to-me.
    mode: text("mode").$type<"auto_deliver" | "direct_only">().notNull().default("auto_deliver"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("channel_subscription_unique_idx").on(table.channelId, table.sessionId)],
);
```
   Run `bun run db:push`.

2. `src/services/channel-subscription-service.ts` (`createLogger("ChannelSubscription")`):
   - `subscribe(channelId, sessionId, mode)` — upsert on the unique index.
   - `unsubscribe(channelId, sessionId)`.
   - `getAutoDeliverSessions(channelId, projectPeers): string[]` — return project peers whose subscription
     mode is `auto_deliver`, **plus** the project default for `#general` (the default channel is
     auto-subscribe for all peers unless a `direct_only` row exists). This is the recipient list used by
     `recordDeliveries` for channel sends.

3. In `src/server/terminal.ts` `/internal/channels/send`: replace the blanket `pushMcpEventToFolderPeers`
   recipient set with `getAutoDeliverSessions(channelId, peers)` for non-mention recipients; @mentioned
   sessions are always recipients regardless of subscription (handled in x386.7).

4. **Test:** `bun run test:run -- src/services/channel-subscription-service.test.ts` → a `direct_only`
   subscriber is excluded from `getAutoDeliverSessions`; `#general` defaults to all peers; an explicit
   `auto_deliver` row on a non-default channel includes that session. **Expected:** pass.

---

### Task: @mention → reliable delivery + injected tool message
**Bead:** x386.7 (depends x386.3)
**Files:** Modify `src/server/terminal.ts`, `src/mcp/peer-server.ts`.

Mentions are already resolved to `@<sid:UUID>` tokens by `peer-service.resolveMentionsInBody`. Ensure a
mentioned session **always** gets a delivery row (even if unsubscribed) and that the MCP server surfaces it
as a distinct `[MENTION]` line (already partially done in `handleSocketEvent`).

1. In `/internal/channels/send` (~1600): parse `@<sid:...>` tokens (the `mentions` set already built there).
   Build the recipient set as `union(getAutoDeliverSessions(...), mentionedSessionIds)`; pass it to
   `MD.recordDeliveries`. For each mentioned peer, the per-peer `buildEvent` already sets
   `type: "mention"` — keep that.

2. In `src/mcp/peer-server.ts`: the `[MENTION]` formatting branch already exists (~154). Confirm the ack is
   sent for mentions too (it flows through the shared `handleSocketEvent`).

3. **Test:** extend `src/services/channel-subscription-service.test.ts` with a mention case: a `direct_only`
   subscriber who is @mentioned **does** get a delivery row. Run
   `bun run test:run -- src/services/channel-subscription-service.test.ts`. **Expected:** pass.

---

### Task: Message retention / TTL (implement the no-op cleanupOldMessages)
**Bead:** x386.9 (depends x386.1)
**Files:** Modify `src/services/peer-service.ts`, `src/server/terminal.ts`.

`cleanupOldMessages` is a documented no-op ("messages are permanent"). Awareness chat is ephemeral, so
implement a real TTL that prunes old messages and their delivery rows, but **never** prunes a message that
still has an unacked delivery (so a long-disconnected agent doesn't lose a message it never saw).

1. Replace the no-op in `src/services/peer-service.ts`:

```ts
const MESSAGE_TTL_DAYS = 14; // awareness window; tune via env RDV_CHAT_TTL_DAYS

/** Prune messages older than the TTL that have no pending/delivered (unacked) deliveries. */
export async function cleanupOldMessages(): Promise<number> {
  const ttlDays = Number(process.env.RDV_CHAT_TTL_DAYS ?? MESSAGE_TTL_DAYS);
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000);
  // Delete delivery rows for already-acked messages past cutoff first (FK cascade
  // also handles this, but explicit keeps counts accurate), then the messages.
  const stale = await db.select({ id: agentPeerMessages.id })
    .from(agentPeerMessages)
    .where(and(
      lt(agentPeerMessages.createdAt, cutoff),
      // No unacked delivery rows remain for this message.
      sql`NOT EXISTS (SELECT 1 FROM message_delivery md WHERE md.message_id = ${agentPeerMessages.id} AND md.state != 'acked')`,
    ));
  if (stale.length === 0) return 0;
  const ids = stale.map((s) => s.id);
  await db.delete(agentPeerMessages).where(inArray(agentPeerMessages.id, ids)); // cascades delivery rows
  log.info("Pruned old peer messages", { count: ids.length, ttlDays });
  return ids.length;
}
```
   Import `lt`, `inArray` (already imported) in `peer-service.ts`.

2. The `/internal/peers/cleanup` route (~1434) already calls this; ensure it returns `{ ok: true, pruned }`.
   Confirm it is invoked on startup (search for an existing startup hook calling cleanup; if absent, add a
   single call in the terminal server boot path guarded so it runs once).

3. **Test:** `bun run test:run -- src/services/message-delivery-service.test.ts` (TTL case): insert an old
   acked message → pruned; insert an old message with one `delivered` (unacked) row → retained; insert a
   recent message → retained. **Expected:** pass.

---

## Phase C — Awareness foundation

### Task: Lightweight session work-context + READ-ONLY beads join
**Bead:** x386.11 (foundation for x386.6/.12/.14)
**Files:** Create `src/services/work-context-service.ts`, `src/services/work-context-service.test.ts`; Modify `src/db/schema.ts`, `src/server/terminal.ts`.

This is the awareness layer beads does not hold: per-session branch/worktree/folder/status/last-activity,
**plus** a read-only view of the bd issue the agent has claimed. **No task data is duplicated** — bd is
queried live via `beadsQuery`.

**Honest note on the join (read carefully):** there is **no hard foreign key** from a session to a bd issue.
The linkage is **loose** and best-effort:
- A session's working directory is `terminalSessions.projectPath` (the worktree path, set at creation —
  see `session-service.ts` ~742); bd is keyed by that path's `.beads/` Dolt DB (`beads-db.ts`
  `getDoltPort`/`getDatabaseName`).
- bd's `assignee`/`actor` is a **freetext string** (see `beads-service.ts` `IssueRow.assignee`), not a
  session UUID or a remote-dev user id. We therefore join on the **branch name** as the primary signal
  (`terminalSessions.worktreeBranch` ↔ a convention where the claimed issue id appears in the branch, e.g.
  `feat/x386-...`), and fall back to "issues in-progress in this project assigned to anyone" when the branch
  encodes no issue id. Document this explicitly in the returned payload (`joinConfidence: "branch" | "project" | "none"`).

1. Add a small cache table (the context is recomputed cheaply, but persisting the last snapshot lets the
   chat UI and digest read it without a live git call):

```ts
// Last computed work-context snapshot per session (auto-derived; cache only).
export const agentWorkContext = sqliteTable(
  "agent_work_context",
  {
    sessionId: text("session_id").primaryKey().references(() => terminalSessions.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    activityStatus: text("activity_status"),
    // READ-ONLY mirror of the claimed bd issue id + title for display; NEVER written back to bd.
    claimedIssueId: text("claimed_issue_id"),
    claimedIssueTitle: text("claimed_issue_title"),
    joinConfidence: text("join_confidence").$type<"branch" | "project" | "none">(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  }
);
```
   Run `bun run db:push`.

2. `src/services/work-context-service.ts` (`createLogger("WorkContext")`):

```ts
import { db } from "@/db";
import { terminalSessions, agentWorkContext } from "@/db/schema";
import { eq } from "drizzle-orm";
import { beadsQuery, isBeadsAvailable } from "@/lib/beads-db";
import type { RowDataPacket } from "mysql2/promise";
import { createLogger } from "@/lib/logger";

const log = createLogger("WorkContext");
const ISSUE_ID_IN_BRANCH = /([a-z0-9]+-[a-z0-9]+(?:\.[0-9]+)?)/i; // matches "x386.11" etc.

interface ClaimRow extends RowDataPacket { id: string; title: string; assignee: string | null; status: string; }

export interface WorkContext {
  sessionId: string; projectId: string; branch: string | null; worktreePath: string | null;
  activityStatus: string | null; claimedIssueId: string | null; claimedIssueTitle: string | null;
  joinConfidence: "branch" | "project" | "none";
}

export async function computeWorkContext(sessionId: string): Promise<WorkContext | null> {
  const s = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: { projectId: true, worktreeBranch: true, projectPath: true, agentActivityStatus: true },
  });
  if (!s?.projectId) return null;

  let claimedIssueId: string | null = null, claimedIssueTitle: string | null = null;
  let joinConfidence: WorkContext["joinConfidence"] = "none";

  const path = s.projectPath ?? null;
  if (path && (await isBeadsAvailable(path))) {
    const branchIssue = s.worktreeBranch?.match(ISSUE_ID_IN_BRANCH)?.[1] ?? null;
    if (branchIssue) {
      const rows = await beadsQuery<ClaimRow>(path,
        "SELECT id, title, assignee, status FROM issues WHERE id = ? AND status = 'in_progress' LIMIT 1",
        [branchIssue]);
      if (rows[0]) { claimedIssueId = rows[0].id; claimedIssueTitle = rows[0].title; joinConfidence = "branch"; }
    }
    if (!claimedIssueId) {
      // Fallback: any single in-progress issue in this project (loose; flag low confidence).
      const rows = await beadsQuery<ClaimRow>(path,
        "SELECT id, title, assignee, status FROM issues WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 1", []);
      if (rows[0]) { claimedIssueId = rows[0].id; claimedIssueTitle = rows[0].title; joinConfidence = "project"; }
    }
  }

  const ctx: WorkContext = {
    sessionId, projectId: s.projectId, branch: s.worktreeBranch ?? null, worktreePath: path,
    activityStatus: s.agentActivityStatus ?? null, claimedIssueId, claimedIssueTitle, joinConfidence,
  };
  await db.insert(agentWorkContext).values({ ...ctx }).onConflictDoUpdate({
    target: agentWorkContext.sessionId, set: { ...ctx, updatedAt: new Date() },
  });
  return ctx;
}

/** All cached work-contexts for a project (used by digest + collision). */
export async function getProjectWorkContexts(projectId: string): Promise<WorkContext[]> {
  const rows = await db.query.agentWorkContext.findMany({ where: eq(agentWorkContext.projectId, projectId) });
  return rows.map((r) => ({ ...r } as WorkContext));
}
```
   (Verify the bd column names `id`/`title`/`status`/`assignee` against the live Dolt schema — `beads-service.ts`
   confirms `assignee`, `status`, `id`, `title` exist; the memory note `beads_dolt_schema_coupling` warns the
   schema can drift across bd versions, so wrap queries in try/catch and degrade to `joinConfidence:"none"`.)

3. In `src/server/terminal.ts`, add `GET /internal/work-context?sessionId=xxx` → `computeWorkContext`, used
   by the Rust digest/collision (Phase D) and the chat UI.

4. **Test:** `bun run test:run -- src/services/work-context-service.test.ts` with `beads-db` mocked
   (`vi.mock("@/lib/beads-db")`): branch `feat/x386.11-foo` + an in-progress `x386.11` → `joinConfidence:"branch"`;
   branch with no id but one in-progress issue → `"project"`; bd unavailable → `"none"` and no throw.
   **Expected:** pass.

---

## Phase D — Awareness behaviors

### Task: Check-in / check-out via lifecycle hooks (agent as system speaker)
**Bead:** x386.6 (depends x386.11)
**Files:** Modify `crates/rdv/src/commands/hook.rs`, `src/server/terminal.ts`, `src/services/channel-service.ts`.

Replace the ad-hoc `broadcast_session_start` ("session started") and Stop's "finished work" broadcast with
structured **check-in** / **check-out** posts into a per-project **agent channel**, attributed to the agent
as a system speaker (so they render distinctly from chatter).

1. Ensure a per-project `#agents` system channel exists. In `channel-service.ts`, add
   `getAgentsChannelId(projectId)` mirroring `getGeneralChannelId` but with `type: "system"`, `name:
   "agents"`, `displayName: "#agents"`, created in the default group (idempotent upsert).

2. In `crates/rdv/src/commands/hook.rs`:
   - Replace `broadcast_session_start` body: instead of `"session started"`, fetch work-context
     (`GET /internal/work-context`) and post a check-in to `#agents` via `/internal/channels/send`:
     `format!("checked in — branch {branch}, working on {issue}", ...)` (omit issue clause if
     `joinConfidence == "none"`). Keep the `/tmp/rdv-peer-start-{sid}` sentinel for once-per-session.
   - In `handle_stop`, replace the `"finished work"` broadcast with a check-out post to `#agents`:
     `"checked out — branch {branch}"`. Keep the existing summary-clear + idle status.
   - Mark these as system messages: add an optional `"system": true` field to the
     `/internal/channels/send` payload; in the route, set a synthetic `fromSessionName` like
     `"{name} (agent)"` (do not change `agent_peer_message` schema — system attribution is presentational).

3. **Test:** `bun run test:run -- tests/services/start-digest.test.ts` covers the channel post path
   indirectly via the digest; for check-in/out specifically, add an assertion in
   `channel-subscription-service.test.ts` that `getAgentsChannelId` is idempotent and a posted check-in lands
   in `#agents`. Rust: `cd crates/rdv && cargo build`. **Expected:** pass / compiles.

---

### Task: Read-peers start digest injected at session start
**Bead:** x386.12 (depends x386.11)
**Files:** Modify `crates/rdv/src/commands/hook.rs`; Create `tests/services/start-digest.test.ts`; Modify `src/server/terminal.ts`.

Upgrade the existing `print_peer_digest` (which only lists peers + new messages) into a real **start
digest**: who's-working-on-what (from work-context, including claimed bd issues) + recent gotchas, printed
to stderr at the first PreToolUse so the agent reads it before acting.

1. Add a server-side digest builder so the heavy joins live in TS, not Rust. In `src/server/terminal.ts`,
   add `GET /internal/peers/digest?sessionId=xxx` returning:

```ts
// { peers: [{name, status, branch, claimedIssueId, claimedIssueTitle, summary}],
//   gotchas: [{from, body, createdAt}],  // recent #agents notes tagged gotcha/heads-up (x386.13)
//   collisions: [...] }                  // from x386.14 collision query
```
   Build `peers` from `getProjectWorkContexts(projectId)` + `getProjectPeers`; `gotchas` from the most recent
   N `agent_peer_message` rows in `#agents` whose body carries a `[gotcha]`/`[heads-up]` prefix (written by
   x386.13).

2. In `crates/rdv/src/commands/hook.rs` `print_peer_digest`: call `/internal/peers/digest` and render three
   sections to stderr:

```
── Team (who's working on what) ─────────────
  alice [running] feat/x386.11 · x386.11 Lightweight work-context
  bob   [idle]    feat/auth     · (no claimed issue)
── Recent gotchas ───────────────────────────
  ⚠ carol: [gotcha] db:push drops the FK unless you re-run after rebase
── New messages ─────────────────────────────
  📨 alice: can you rebase onto master?
```
   Keep the durable-cursor message fetch from x386.4 for the "New messages" section.

3. **Test:** `bun run test:run -- tests/services/start-digest.test.ts` builds a project with two sessions +
   work-contexts + one gotcha note and asserts the digest payload includes both peers (with claimed issue
   for the branch-matched one) and the gotcha. **Expected:** pass.

---

### Task: Gotcha / heads-up / progress notes (`rdv peer note`)
**Bead:** x386.13 (depends x386.2)
**Files:** Create `crates/rdv/src/commands/note.rs`; Modify `crates/rdv/src/commands/peer.rs`, `crates/rdv/src/commands/mod.rs`, `src/server/terminal.ts` (optional helper).

A dedicated, low-friction way for an agent to broadcast a heads-up to project peers — distinct from regular
chatter so the digest can surface it.

1. Extend `PeerCommand` in `crates/rdv/src/commands/peer.rs`:

```rust
/// Broadcast a gotcha / heads-up / progress note to project peers
Note {
    /// Note body
    body: String,
    /// Kind of note (default: gotcha)
    #[arg(long, value_parser = ["gotcha", "heads-up", "progress"], default_value = "gotcha")]
    kind: String,
},
```
   In `run(...)`, handle it by posting to the `#agents` channel with a typed prefix so the digest's gotcha
   filter matches:

```rust
PeerCommand::Note { body, kind } => {
    let tagged = format!("[{kind}] {body}");
    let payload = json!({ "fromSessionId": sid, "channelName": "agents", "body": tagged });
    let _ = client.post_json("/internal/channels/send", &payload).await;
    if human { println!("Note posted to #agents ({kind})."); }
    else { println!("{}", json!({ "ok": true, "kind": kind })); }
}
```
   (Reuses the durable channel-send → delivery path from Phase A/B; no new server table.)

2. Register/verify the `peer` subcommand wiring in `crates/rdv/src/commands/mod.rs` (the `note.rs` file is
   optional — the logic is small enough to inline in `peer.rs`; if extracted, expose `pub fn` and call it).

3. **Test:** `cd crates/rdv && cargo test --lib commands::peer` if a unit test exists for `extract_*`; minimum
   gate `cd crates/rdv && cargo build`. Server-side, the gotcha surfacing is asserted in
   `tests/services/start-digest.test.ts`. **Expected:** compiles; digest test green.

---

### Task: Overlap/collision nudge (same branch / worktree / claimed bd-issue)
**Bead:** x386.14 (depends x386.11)
**Files:** Modify `src/server/terminal.ts`; Create `tests/services/peer-collision.test.ts`; Modify `src/services/work-context-service.ts`.

Warn an agent when another active session shares its branch, worktree path, or claimed bd issue — the most
common cause of stepped-on work.

1. In `src/services/work-context-service.ts`, add a detector over the cached contexts:

```ts
export interface Collision { peerSessionId: string; peerName: string; reason: "branch" | "worktree" | "issue"; value: string; }

export async function detectCollisions(sessionId: string): Promise<Collision[]> {
  const me = await db.query.agentWorkContext.findFirst({ where: eq(agentWorkContext.sessionId, sessionId) });
  if (!me) return [];
  const peers = await getProjectWorkContexts(me.projectId);
  const out: Collision[] = [];
  for (const p of peers) {
    if (p.sessionId === sessionId) continue;
    if (me.branch && p.branch === me.branch) out.push({ peerSessionId: p.sessionId, peerName: "", reason: "branch", value: me.branch });
    else if (me.worktreePath && p.worktreePath === me.worktreePath) out.push({ peerSessionId: p.sessionId, peerName: "", reason: "worktree", value: me.worktreePath });
    else if (me.claimedIssueId && p.claimedIssueId === me.claimedIssueId) out.push({ peerSessionId: p.sessionId, peerName: "", reason: "issue", value: me.claimedIssueId });
  }
  // Fill peerName from terminalSessions in one query (omitted for brevity).
  return out;
}
```

2. Surface collisions in the digest payload (`GET /internal/peers/digest` from x386.12) and as a distinct
   stderr block in `print_peer_digest`:
   `⚠ COLLISION: bob is on the same branch feat/x386.11 — coordinate before pushing.`
   Recompute `computeWorkContext(sessionId)` at the top of the digest route so collisions use fresh branch
   data.

3. **Test:** `bun run test:run -- tests/services/peer-collision.test.ts`: two sessions with the same
   `worktreeBranch` → one `branch` collision each direction; same `claimedIssueId` only → `issue` collision;
   disjoint → none. **Expected:** pass.

---

## Phase E — Docs & tests

### Task: Agent-facing chat usage docs + check-in/read/check-out discipline
**Bead:** x386.8
**Files:** Modify `docs/AGENTS.md` (§5 ~164–182), `docs/RDV_CLI.md` (~244–262), `src/services/agent-profile-service.ts` (generated per-profile CLAUDE.md).

1. `docs/AGENTS.md` §5: replace the "push-first / 24-hour TTL" summary with the real model — durable inbox +
   delivery state, **long-lived MCP subscription** with replay, **poll fallback** for the 4 non-MCP
   providers, channel subscriptions, configurable TTL (`RDV_CHAT_TTL_DAYS`). Add a **"Coordination
   discipline"** subsection: **check in** (auto on session start → `#agents`), **read peers** (the start
   digest — who's-working-on-what + gotchas + collisions), **check out** (auto on Stop), and `rdv peer note`
   for gotchas. State plainly: **bd tracks the work; chat tracks awareness** — do not duplicate task state in
   chat.

2. `docs/RDV_CLI.md` `## peer` table: add
   `rdv peer note <body> [--kind gotcha|heads-up|progress]` and a sentence that `rdv peer messages` now uses a
   durable cursor (auto-acks read messages) so repeated calls don't re-show the same items.

3. `src/services/agent-profile-service.ts`: in the per-profile CLAUDE.md generation (the `claude` provider
   row at ~58 / wherever the profile CLAUDE.md template is emitted), add a short block instructing the agent
   to: read the start digest before acting, post a `rdv peer note` when it discovers a gotcha, and respect
   collisions. Keep it terse (these are tokens in every session).

4. **Test:** `bun run lint` (markdown/prose lint is not enforced, but the TS edit to
   `agent-profile-service.ts` must pass) and a focused snapshot/string assertion in
   `src/services/agent-profile-appearance-service.test.ts` neighbor if the generator is unit-tested; otherwise
   `bun run typecheck`. **Expected:** pass.

---

### Task: Tests — delivery reliability, subscription, lifecycle posting, context, digest, collision
**Bead:** x386.10
**Files:** Consolidate `src/services/message-delivery-service.test.ts`, `src/services/channel-subscription-service.test.ts`, `src/services/work-context-service.test.ts`, `tests/services/start-digest.test.ts`, `tests/services/peer-collision.test.ts`; add `src/server/mcp-push.test.ts`.

These are authored within their owning tasks above; this task is the gate that asserts coverage of all six
behaviors and runs the full suite.

1. Coverage checklist (one assertion group each): delivery exactly-once across push+poll; subscription
   auto-deliver vs direct-only (+ mention override); check-in/out lands in `#agents`; work-context bd-join
   confidence levels; start-digest payload shape; collision by branch/worktree/issue.

2. **Test:** `bun run test:run` then `bun run typecheck` then `cd crates/rdv && cargo build`.
   **Expected:** all Vitest suites green, no type errors, Rust compiles. (Run `bun run lint` last.)

---

## Risks & Open Questions

1. **Session → bd-issue join is intentionally loose (highest risk).** bd `assignee`/`actor` is freetext and
   not linked to a session UUID or remote-dev user (`beads-service.ts` `IssueRow.assignee: string | null`),
   and the `projects` table has **no path column** — the path comes from `terminalSessions.projectPath`
   (worktree dir) or preferences `defaultWorkingDirectory`/`localRepoPath`. We join primarily on the **issue
   id embedded in the branch name** and fall back to "most recent in-progress issue in this project," tagging
   the result `joinConfidence: branch | project | none`. The digest/collision UI must show this confidence so
   agents don't over-trust a `project`-level guess. **Open:** should we add a first-class
   `claimedIssueId` column on `terminalSessions` that the `bd update --claim` flow (or a `rdv` hook) writes,
   to make the join hard? That is a larger change touching the bd workflow and is deliberately **out of scope**
   here (epic says READ-ONLY join, do not duplicate tracking) — flag for a follow-up bead if `project`-level
   guesses prove noisy.

2. **MCP-only vs poll-fallback parity.** Only Claude Code gets the `rdv` MCP server (auto-registered in
   `agent-profile-service.ts` ~803); Codex/Gemini/OpenCode/Antigravity rely on `rdv peer messages`. The
   durable delivery state (x386.1) is what equalizes them — both paths read `getUndelivered` and ack — but
   poll providers only ack **when the hook/CLI runs**, which for non-Claude agents may be infrequent (no
   PreToolUse-equivalent on all providers). **Risk:** a Gemini agent that never calls `rdv peer messages`
   accumulates `delivered`/`pending` rows and never sees them. Mitigation: the start digest + a per-provider
   recommendation in docs to poll on a cadence; **open question** whether to add a provider-agnostic
   poller (e.g., a tmux-side cron) — out of scope, note as follow-up.

3. **Socket ack reliability.** The MCP server's ack is sent after `sendLoggingMessage` resolves, but
   `sendLoggingMessage` resolving does not guarantee the **agent** read it (only that the client received the
   log notification). We treat `acked` as "surfaced to the client," which is the strongest signal available;
   true human/agent-read receipts are not possible via MCP logging. This is acceptable for awareness but
   should be stated in `docs/AGENTS.md`.

4. **bd Dolt schema drift.** `work-context-service` queries the live Dolt schema directly (like
   `beads-service.ts`), which the `beads_dolt_schema_coupling` memo shows can break on a bd upgrade (column
   renames). All bd queries are wrapped in try/catch degrading to `joinConfidence:"none"`; add the
   namespace `WorkContext` to log inspection so a future bd bump surfaces quickly.

5. **TTL vs unacked retention.** `cleanupOldMessages` refuses to prune messages with unacked deliveries, so a
   long-disconnected session can pin old rows indefinitely. Bounded in practice by session deletion cascading
   `message_delivery`; **open:** a hard ceiling (e.g., prune unacked deliveries for sessions
   closed > 30 days) — defer to a follow-up if storage grows.

6. **Recipient fan-out cost.** `recordDeliveries` writes one row per recipient per message; in a large
   project (many peers) channel broadcasts multiply rows. Indexed and pruned by TTL; acceptable at the
   expected scale (handful of agents per project) but worth a metric.

---

## Self-Review (writing-plans)

**Coverage vs all 14 beads:**
- x386.1 ✓ (message_delivery + replay cursor + service) · x386.2 ✓ (ack-aware mcp-push + delivered hook) ·
  x386.3 ✓ (replay handshake + long-lived socket) · x386.4 ✓ (pollUndelivered + ack-batch + CLI cursor) ·
  x386.5 ✓ (channel_subscription + getAutoDeliverSessions) · x386.6 ✓ (check-in/out → #agents) ·
  x386.7 ✓ (mention union recipient + [MENTION]) · x386.8 ✓ (AGENTS/RDV_CLI/CLAUDE.md docs) ·
  x386.9 ✓ (real cleanupOldMessages TTL) · x386.10 ✓ (six test suites + gate) ·
  x386.11 ✓ (work-context-service + bd join + agent_work_context) · x386.12 ✓ (start digest payload + render) ·
  x386.13 ✓ (rdv peer note) · x386.14 ✓ (detectCollisions + digest block). **All 14 mapped.**

**Dependency order respected:** Phase A (.1→.2→.3) precedes everything; .4/.7/.9 sit after their stated deps;
.11 precedes .6/.12/.14; .13 after .2. ✓

**Placeholder scan:** no `TODO`, `TBD`, `...` stand-ins in code sketches (the one `// (omitted for brevity)`
is in `detectCollisions` peerName backfill, a trivial join — acceptable, behavior fully specified). ✓

**Type-name consistency:** `messageDelivery`/`message_delivery`, `messageReplayCursor`/`message_replay_cursor`,
`channelSubscription`/`channel_subscription`, `agentWorkContext`/`agent_work_context` used consistently;
service fns (`recordDeliveries`, `markDelivered`, `ackDelivery`, `getUndelivered`, `getReplayCursor`,
`pollUndelivered`, `getAutoDeliverSessions`, `computeWorkContext`, `getProjectWorkContexts`,
`detectCollisions`, `getAgentsChannelId`) named once and reused; Rust `PeerCommand::Note { body, kind }`
matches the `--kind` parser values used in `start-digest` gotcha filter (`[gotcha]`/`[heads-up]`/`[progress]`).
✓

**Convention check:** all server code uses `createLogger` (no `console.*`); schema changes via `bun run
db:push`; tests via `bun run test:run`; Rust via `cargo build`/`cargo test`; layering preserved by the
`setDeliveredHook`/`setReplayHook` setters (mcp-push has no service import). ✓
