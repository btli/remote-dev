import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { resolve as pathResolve } from "node:path";
import { promisify } from "node:util";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
// [oyej] Agent-run scheduler (REAL agent launches; epic remote-dev-oyej).
import { agentSchedulerOrchestrator } from "../services/agent-scheduler-orchestrator.js";
import { getSchedulerHealth } from "./scheduler-health.js";
import { validateWsToken, getAuthSecret, CONTROL_SESSION_SENTINEL } from "../lib/ws-token.js";
import { createLogger } from "../lib/logger.js";
import { WS_PATH_PREFIX } from "../lib/base-path.js";
import {
  PROXY_WS_PATH_PATTERN,
  handleProxyWsUpgrade,
} from "./proxy-ws-bridge.js";
// [hgwo] provider type for the durable agent-session-id capture endpoint.
import type { AgentProviderType } from "../types/session.js";

const log = createLogger("Terminal");
const agentLog = createLogger("AgentExit");
const agentStatusLog = createLogger("AgentStatus");

/** In-memory store for proxy state reported by agent sessions (apiKey never broadcast to WS). */
const proxyStateStore = new Map<string, { baseUrl: string; keyPrefix: string; apiKey: string }>();
const notifyLog = createLogger("Notify");
const internalLog = createLogger("InternalAPI");
const ptyLog = createLogger("PtyControl");
const peerLog = createLogger("PeerAPI");
const usageLog = createLogger("UsageLimit");

/** Retry an async operation up to maxRetries times with exponential backoff (for SQLITE_BUSY) */
async function retryOnBusy<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !String(err).includes("SQLITE_BUSY")) throw err;
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
  }
}

// Re-export for backwards compatibility with API routes
export { generateWsToken } from "../lib/ws-token.js";

/**
 * Filter out internal/private environment variables from frameworks.
 * These should not leak into child terminal sessions.
 */
function getCleanEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Filter out Next.js internal variables
    if (key.startsWith("__NEXT_PRIVATE_")) continue;
    if (key.startsWith("__NEXT_ACTION_")) continue;
    // Filter out other framework internals
    if (key.startsWith("__VITE_")) continue;
    if (key.startsWith("__TURBOPACK_")) continue;
    env[key] = value;
  }
  // Ensure locale vars are always present for proper UTF-8 handling in PTY.
  // Without these, node-pty uses the C locale and multi-byte characters
  // (Nerd Font glyphs, Unicode) render as '_'.
  if (!env.LANG) env.LANG = "en_US.UTF-8";
  if (!env.LC_CTYPE) env.LC_CTYPE = "en_US.UTF-8";
  if (!env.TERM) env.TERM = "xterm-256color";
  return env;
}

/**
 * Validate a tmux session name to prevent command injection.
 * Must match the rdv-{uuid} format used by the domain layer (TmuxSessionName).
 */
function validateSessionName(name: string): boolean {
  return /^rdv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

/**
 * [remote-dev-yk42] Decide whether a WS token may attach to a requested tmux
 * session, given the DB session row that owns that tmux name.
 *
 * The session WS token is HMAC-bound to exactly one `{ sessionId, userId }`
 * (see ws-token.ts). The `?tmuxSession` query override is FORMAT-validated by
 * `validateSessionName`, but format alone does not prove ownership: a user
 * holding a valid token for their own session could otherwise point
 * `?tmuxSession` at another user's `rdv-<uuid>` and attach to it. This is the
 * defense-in-depth check that re-binds the requested tmux session to the
 * token's USER at connect time.
 *
 * Authorization is decided by USER-LEVEL ownership:
 *   - **No row** (`null`/`undefined`) → ALLOW. There is no existing session to
 *     hijack: this is the session-CREATION path. The terminal server derives
 *     `rdv-${token.sessionId}` and CREATES the tmux session + its DB row on this
 *     connect, so no row exists yet at check time. The HMAC token already proves
 *     the caller, and for the no-`?tmuxSession`-override case the derived name is
 *     `rdv-${token.sessionId}` (bound to the token). Rejecting null would block
 *     every brand-new session (and the supervisor-router E2E smoke, which mints
 *     a token for a fresh `randomUUID()` sessionId with no pre-existing row).
 *   - **Row owned by the same user** (`row.userId === token.userId`) → ALLOW.
 *     We use user-level ownership, NOT `row.id === token.sessionId`: a legitimate
 *     control-mode token can attach to ANOTHER of the SAME user's own sessions,
 *     so pinning to the token's own sessionId would over-reject. The user owns
 *     every `rdv-<uuid>` whose row carries their userId — attaching to one is not
 *     a privilege escalation.
 *   - **Row owned by a DIFFERENT user** (`row.userId !== token.userId`) → REJECT.
 *     This is the actual remote-dev-yk42 attack (attaching to another user's live
 *     tmux session) and stays blocked.
 *
 * (DB-error fail-closed is handled by the connect-time caller, which rejects
 * BEFORE invoking this predicate; a null here only ever means "no such row".)
 *
 * Pure + side-effect free so it can be unit-tested without a DB.
 */
export function isTmuxSessionAuthorized(
  row: { id: string; userId: string } | null | undefined,
  token: { sessionId: string; userId: string },
): boolean {
  // No existing row = creation path: nothing to hijack, the token authorizes
  // the caller and the derived tmux name is bound to the token's sessionId.
  if (!row) return true;
  // An existing row may only be attached by its OWNING user.
  return row.userId === token.userId;
}

/**
 * Validate a working directory for a new terminal session.
 *
 * Canonicalizes the path (neutralizing .., ., duplicate slashes) and verifies
 * the directory exists before passing it to `tmux new-session -c`. A missing or
 * invalid path falls back to the shell's default start directory (with a
 * warning) rather than aborting session creation.
 *
 * We intentionally do NOT restrict to $HOME: instance/container workspaces
 * routinely live outside the server process's HOME (which may also be unset),
 * and a terminal already grants full shell access, so a cwd allowlist would add
 * no security — only the silent "starts in home" breakage this avoids. The
 * existence check is best-effort (the dir could change before tmux uses it);
 * worst case tmux falls back to its default dir, the same as today.
 */
function validatePath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be an absolute path
  if (!path.startsWith("/")) {
    log.warn("Ignoring non-absolute working directory", { path });
    return undefined;
  }

  // Canonicalize (collapses .., ., duplicate slashes) — neutralizes traversal.
  const resolved = pathResolve(path);

  // statSync follows symlinks, so a symlink to a directory is accepted (desired
  // for worktree/workspace layouts). Missing or non-directory → fall back.
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      log.warn("Working directory is not a directory; using default start dir", { path: resolved });
      return undefined;
    }
  } catch {
    log.warn("Working directory does not exist; using default start dir", { path: resolved });
    return undefined;
  }

  return resolved;
}

interface TerminalConnection {
  connectionId: string;
  // [remote-dev-d5ci] null for control-mode connections (no PTY/tmux attach).
  pty: IPty | null;
  ws: WebSocket;
  sessionId: string;
  tmuxSessionName: string;
  isAttached: boolean;
  lastCols: number;
  lastRows: number;
  pendingResize: { cols: number; rows: number } | null;
  resizeTimeout: ReturnType<typeof setTimeout> | null;
  // Terminal type for agent exit detection
  terminalType: "shell" | "agent" | "file" | string;
  // User ID for session service calls
  userId: string;
  // Last-focus bookkeeping for primary-connection election (focus-based promotion).
  lastFocusAt: number;
  isVisible: boolean;
  // [remote-dev-d5ci] Lightweight control connection: registered in the
  // `connections` map only so broadcasts reach it (sidebar live updates without
  // an attached terminal). It has NO PTY, is NOT in sessionConnections /
  // sessionPrimaryConnection, and triggers no attach/detach/suspend side effects.
  isControl?: boolean;
}

// CONTROL_SESSION_SENTINEL (the reserved control-mode sessionId) is imported
// from ws-token so the token minter (API route) and this acceptor agree.

// All active connections, keyed by connectionId (UUID)
const connections = new Map<string, TerminalConnection>();

// Session -> connection IDs for multi-client support
const sessionConnections = new Map<string, Set<string>>();

// Which connection controls tmux resize per session (most-recently-focused wins)
const sessionPrimaryConnection = new Map<string, string>();

// Last time the primary changed for a session — used as a 1s cooldown to prevent
// ping-pong between two side-by-side windows.
const sessionLastPromotionAt = new Map<string, number>();
const PROMOTION_COOLDOWN_MS = 1000;

/** Get all active connections for a session */
function getConnectionsForSession(sessionId: string): TerminalConnection[] {
  const connIds = sessionConnections.get(sessionId);
  if (!connIds) return [];
  const result: TerminalConnection[] = [];
  for (const id of connIds) {
    const conn = connections.get(id);
    if (conn) result.push(conn);
  }
  return result;
}

/**
 * [y5ch.4] True when `userId` has a currently-visible (focused) WebSocket
 * connection attached to `sessionId`. Drives push suppression: if the user is
 * already looking at the session, an FCM push for it is noise (the in-app row
 * is still stored). `isVisible` is maintained by the client_focus/client_blur
 * messages below.
 */
function isSessionFocusedByUser(userId: string, sessionId: string): boolean {
  for (const conn of getConnectionsForSession(sessionId)) {
    if (conn.userId === userId && conn.isVisible) return true;
  }
  return false;
}

/** Get any single active connection for a session (for internal API lookups) */
function getAnyConnectionForSession(sessionId: string): TerminalConnection | undefined {
  const connIds = sessionConnections.get(sessionId);
  if (!connIds) return undefined;
  const firstId = connIds.values().next().value;
  if (!firstId) return undefined;
  return connections.get(firstId);
}

// Per-session status indicators (key -> StatusIndicator)
type StatusIndicator = { value: string; icon?: string; color?: string; updatedAt: string };
const sessionStatusIndicators = new Map<string, Map<string, StatusIndicator>>();

// Per-session progress bars
type SessionProgress = { value: number; label?: string; updatedAt: string };
const sessionProgressBars = new Map<string, SessionProgress>();

// Claude Code session ID -> rdv session ID mapping
const claudeSessionMap = new Map<string, string>();

// Promisified execFile for async tmux commands
const execFileAsync = promisify(execFile);

/** Map of human-readable key names to tmux key names */
const TMUX_KEY_MAP: Record<string, string> = {
  "Enter": "Enter",
  "Return": "Enter",
  "C-c": "C-c",
  "Ctrl-C": "C-c",
  "C-d": "C-d",
  "Ctrl-D": "C-d",
  "C-z": "C-z",
  "Ctrl-Z": "C-z",
  "C-l": "C-l",
  "Ctrl-L": "C-l",
  "Tab": "Tab",
  "Escape": "Escape",
  "Esc": "Escape",
  "Up": "Up",
  "Down": "Down",
  "Left": "Left",
  "Right": "Right",
  "PageUp": "PPage",
  "PageDown": "NPage",
  "Home": "Home",
  "End": "End",
  "Backspace": "BSpace",
  "Space": "Space",
};

/** Build an agent_exited event payload */
function agentExitedEvent(sessionId: string, exitCode: number | null): Record<string, unknown> {
  return { type: "agent_exited", sessionId, exitCode, exitedAt: new Date().toISOString() };
}

/** Broadcast a JSON message to all connected WebSocket clients */
function broadcastToClients(data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const [, conn] of connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

/** Broadcast a JSON message only to WebSocket clients belonging to a specific user */
function broadcastToUser(userId: string, data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const [, conn] of connections) {
    if (conn.userId === userId && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

// [n6uc] Push freshly-aggregated session metadata (branch/dirty/PR/ports/
// attention) to the owning user's clients so tree rows update live without
// per-row polling. Fire-and-forget; failures are non-critical (the client TTL
// poll still refreshes). Imported lazily to avoid pulling the DB-heavy service
// into the terminal server's hot module graph at startup.
async function broadcastSessionMetadata(
  sessionId: string,
  userId: string,
): Promise<void> {
  try {
    const { getSessionMetadata } = await import(
      "@/services/session-metadata-service"
    );
    const meta = await getSessionMetadata(sessionId, userId);
    if (meta) broadcastToUser(userId, { type: "session_metadata", metadata: meta });
  } catch (err) {
    log.warn("session_metadata broadcast failed", {
      error: String(err),
      sessionId,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude usage-limit detection [remote-dev-3b3l]
//
// Reactive detection is server-side this wave: when an agent session goes idle
// we scan its scrollback for the limit phrase (reusing the single TS parser),
// record the observation via the use-case, broadcast a `profile_limit_changed`
// event (Wave D's ProfileContext consumes it), and fire the relaunch use-case.
// A manual/programmatic seam (`POST /internal/usage-limit`) shares the same
// track+broadcast+relaunch path (the Phase-2 poller / rdv hook will use it).
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal session shape the limit helpers need (a terminal_session row). */
interface LimitSessionRow {
  id: string;
  userId: string;
  projectId: string | null;
  profileId: string | null;
  agentProvider: string | null;
  tmuxSessionName: string;
  name: string | null;
}

/**
 * Project a domain LimitState into the WS `profile_limit_changed` payload.
 * Pulls the 5h / 7d window percentages + reset times out of the windows array.
 */
function limitStateToBroadcast(
  state: import("@/domain/value-objects/LimitState").LimitState
): {
  profileId: string;
  limitStatus: import("@/types/claude-limits").ClaudeLimitStatus;
  resetAt5h: string | null;
  resetAt7d: string | null;
  window5hPct: number | null;
  window7dPct: number | null;
} {
  let window5hPct: number | null = null;
  let window7dPct: number | null = null;
  let resetAt5h: string | null = null;
  let resetAt7d: string | null = null;
  for (const window of state.getWindows()) {
    const reset = window.getResetAt();
    if (window.getDuration() === "5h") {
      window5hPct = window.getUtilizationPct();
      resetAt5h = reset ? reset.toISOString() : null;
    } else if (window.getDuration() === "7d") {
      window7dPct = window.getUtilizationPct();
      resetAt7d = reset ? reset.toISOString() : null;
    }
  }
  return {
    profileId: state.getProfileId(),
    limitStatus: state.isLimited() ? "limited" : "available",
    resetAt5h,
    resetAt7d,
    window5hPct,
    window7dPct,
  };
}

/**
 * Broadcast a usage-limit state change to the OWNING user's UI clients only
 * (Wave D consumes it). Scoped to the owner so another user's profileId, reset
 * times, and usage percentages don't leak to every connected client.
 */
function broadcastProfileLimitChanged(
  ownerUserId: string,
  state: import("@/domain/value-objects/LimitState").LimitState
): void {
  broadcastToUser(ownerUserId, {
    type: "profile_limit_changed",
    ...limitStateToBroadcast(state),
  });
}

/**
 * Record a usage-limit observation, broadcast the new state, and (when limited
 * and a project is known) fire the relaunch use-case. Shared by the idle scan
 * and the `/internal/usage-limit` endpoint. Best-effort: logs + swallows.
 */
async function trackAndBroadcastLimit(input: {
  profileId: string;
  userId: string;
  source: import("@/types/claude-limits").UsageDetectionSource;
  isLimited: boolean;
  resetAt5h?: Date | null;
  resetAt7d?: Date | null;
  window5hPct?: number | null;
  window7dPct?: number | null;
  observedAt?: Date;
  // Relaunch context — only fires when limited AND projectId is present.
  projectId?: string | null;
  sessionId?: string;
  sessionName?: string | null;
  agentProvider?: string | null;
}): Promise<void> {
  try {
    const { trackUsageLimitUseCase } = await import("@/infrastructure/container");
    const { state, wasNewlyLimited, wrote } = await trackUsageLimitUseCase.execute({
      profileId: input.profileId,
      userId: input.userId,
      source: input.source,
      isLimited: input.isLimited,
      resetAt5h: input.resetAt5h ?? undefined,
      resetAt7d: input.resetAt7d ?? undefined,
      window5hPct: input.window5hPct ?? undefined,
      window7dPct: input.window7dPct ?? undefined,
      observedAt: input.observedAt,
    });

    // The staleness guard may have dropped this write because a strictly-newer
    // observation already won. If so, do NOT broadcast (the DB doesn't hold
    // this state) and do NOT relaunch (a stale reading must not act).
    if (!wrote) return;

    // Broadcast the new state to the owner's clients (the UI reflects every
    // persisted observation).
    broadcastProfileLimitChanged(input.userId, state);

    // Relaunch handling fires only on a NEW limit (off→on transition), so a
    // repeat "still limited" observation doesn't double-relaunch — and only
    // when we know which project + session to act on. Fire-and-forget. The
    // use-case computes `wasNewlyLimited` from the prior stored state, which
    // centralizes the dedup for every path that funnels through here.
    if (wasNewlyLimited && input.projectId && input.sessionId) {
      const { handleSessionLimit } = await import(
        "@/infrastructure/usage-limit/relaunch-orchestration"
      );
      void handleSessionLimit({
        sessionId: input.sessionId,
        userId: input.userId,
        projectId: input.projectId,
        currentProfileId: input.profileId,
        agentProvider: input.agentProvider ?? "claude",
        sessionName: input.sessionName ?? undefined,
      });
    }
  } catch (err) {
    usageLog.error("Failed to track/broadcast usage limit", {
      profileId: input.profileId,
      source: input.source,
      error: String(err),
    });
  }
}

/**
 * Scan a session's recent scrollback for a Claude usage-limit signal when it
 * goes idle. Only runs for Claude agent sessions that have a profile (a limit
 * has to attribute to a profile). Skips the scan when the repo already shows
 * the profile limited + unexpired (cheap read) so we don't re-fire on every
 * idle transition while waiting for a reset. Best-effort throughout — never
 * throws into the status handler.
 */
async function scanSessionScrollbackForLimit(
  session: LimitSessionRow
): Promise<void> {
  if (!session.profileId) return;
  // Reactive detection only recognizes the subscription "usage limit reached"
  // phrase; non-Claude providers never print it.
  if (session.agentProvider !== "claude") return;

  try {
    // Cheap performance guard (NOT the relaunch dedup — that now lives in the
    // use-case via `wasNewlyLimited`): if the profile is already recorded
    // limited and not yet past its reset, there's nothing new to detect, so
    // skip the expensive scrollback capture + parse on this idle transition.
    const { usageLimitStateRepository } = await import(
      "@/infrastructure/container"
    );
    const existing = await usageLimitStateRepository.findByProfileId(
      session.profileId
    );
    const now = new Date();
    if (existing && existing.isLimited() && !existing.isAvailableNow(now)) {
      return;
    }

    const TmuxService = await import("@/services/tmux-service");
    let output: string;
    try {
      output = await TmuxService.captureOutput(session.tmuxSessionName, 150);
    } catch (err) {
      // Session may have already gone away (idle → closed race); not an error.
      usageLog.debug("Scrollback capture skipped", {
        sessionId: session.id,
        error: String(err),
      });
      return;
    }

    const { ReactiveOutputDetector } = await import(
      "@/infrastructure/usage-limit/ReactiveOutputDetector"
    );
    const parsed = ReactiveOutputDetector.parse(output);
    if (!parsed.isLimited) return;

    usageLog.info("Reactive usage-limit detected on idle", {
      sessionId: session.id,
      profileId: session.profileId,
      hasReset: parsed.resetAt5h !== null || parsed.resetAt7d !== null,
    });

    await trackAndBroadcastLimit({
      profileId: session.profileId,
      userId: session.userId,
      source: "reactive",
      isLimited: true,
      resetAt5h: parsed.resetAt5h ?? undefined,
      resetAt7d: parsed.resetAt7d ?? undefined,
      observedAt: now,
      projectId: session.projectId,
      sessionId: session.id,
      sessionName: session.name,
      agentProvider: session.agentProvider,
    });
  } catch (err) {
    usageLog.error("Scrollback limit scan failed", {
      sessionId: session.id,
      error: String(err),
    });
  }
}

// Cached module references for MCP push (avoids repeated dynamic import overhead)
let _mcpPush: typeof import("@/server/mcp-push") | null = null;

async function getMcpPush() {
  return (_mcpPush ??= await import("@/server/mcp-push"));
}

// [x386.2] Sessions whose per-socket ack handler is already registered. The
// handler advances delivery → acked when the MCP server confirms it surfaced a
// message. Registered lazily the first time we push to a session.
const ackHandlerRegistered = new Set<string>();

/** Ensure the ack handler is installed for a session (idempotent). */
function ensureMcpAckHandler(sessionId: string): void {
  if (ackHandlerRegistered.has(sessionId)) return;
  ackHandlerRegistered.add(sessionId);
  getMcpPush()
    .then(async (mp) => {
      const MD = await import("@/services/message-delivery-service");
      mp.onMcpAck(sessionId, (messageId) => {
        MD.ackDelivery(messageId, sessionId).catch((err) =>
          peerLog.debug("ackDelivery hook failed", { sessionId, error: String(err) }),
        );
      });
    })
    .catch(() => ackHandlerRegistered.delete(sessionId));
}

/**
 * [x386.2] Record durable delivery rows for a message, register ack handlers,
 * then push to each recipient's MCP socket. Recipients that are not connected
 * keep a `pending`/`delivered` row that the poll fallback recovers. `selfSid`
 * is excluded.
 */
async function deliverToRecipients(
  messageId: string,
  projectId: string,
  recipientSessionIds: string[],
  buildEvent: (recipientSessionId: string) => import("@/server/mcp-push").McpPushEvent,
  selfSid: string,
): Promise<void> {
  const recipients = recipientSessionIds.filter((id) => id && id !== selfSid);
  if (recipients.length === 0) return;
  const MD = await import("@/services/message-delivery-service");
  // Write delivery rows BEFORE pushing so a push that races ahead still has a
  // row to mark `delivered`.
  await MD.recordDeliveries(messageId, projectId, recipients);
  const { pushToMcpServer } = await getMcpPush();
  for (const sid of recipients) {
    ensureMcpAckHandler(sid);
    pushToMcpServer(sid, buildEvent(sid));
  }
}


/** Whether a terminal type has agent-like behavior (exit handling, restart). */
function isAgentTerminalType(type: string): boolean {
  return type === "agent" || type === "loop";
}

/** Get the current active and agent session counts for drain status reporting. */
function getSessionCounts(): { activeSessions: number; activeAgentSessions: number } {
  // Count unique sessions, not individual connections
  let activeAgentSessions = 0;
  for (const [sessionId] of sessionConnections) {
    const conn = getAnyConnectionForSession(sessionId);
    if (conn && isAgentTerminalType(conn.terminalType)) {
      activeAgentSessions++;
    }
  }
  return { activeSessions: sessionConnections.size, activeAgentSessions };
}

/** Broadcast a JSON message to clients connected to a specific session */
function broadcastToSession(sessionId: string, data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const conn of getConnectionsForSession(sessionId)) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

/** Run `tmux resize-window` for the given session asynchronously. */
function runTmuxResize(tmuxSessionName: string, cols: number, rows: number): void {
  execFile(
    "tmux",
    ["resize-window", "-t", tmuxSessionName, "-x", String(cols), "-y", String(rows)],
    (err) => {
      if (err) {
        log.warn("tmux resize-window failed", { error: String(err), tmuxSessionName, cols, rows });
      }
    },
  );
}

/** Notify each connection in the session whether it is the current primary. */
function broadcastPrimaryChanged(sessionId: string): void {
  const primaryId = sessionPrimaryConnection.get(sessionId);
  for (const conn of getConnectionsForSession(sessionId)) {
    if (conn.ws.readyState !== WebSocket.OPEN) continue;
    try {
      conn.ws.send(JSON.stringify({
        type: "primary_changed",
        isPrimary: conn.connectionId === primaryId,
      }));
    } catch (err) {
      log.warn("Failed to send primary_changed", { error: String(err), connectionId: conn.connectionId });
    }
  }
}

/**
 * Promote `connectionId` to be the session's primary (tmux-resize controller).
 * Honors a per-session cooldown unless `force` is true.
 */
function tryPromoteToPrimary(sessionId: string, connectionId: string, force: boolean): void {
  const currentPrimary = sessionPrimaryConnection.get(sessionId);
  if (currentPrimary === connectionId) return;

  const now = Date.now();
  const lastPromo = sessionLastPromotionAt.get(sessionId) ?? 0;
  const msSincePrev = now - lastPromo;
  if (!force && msSincePrev < PROMOTION_COOLDOWN_MS) {
    log.debug("promotion denied (cooldown)", { connectionId, sessionId, msSincePrev });
    return;
  }

  sessionPrimaryConnection.set(sessionId, connectionId);
  sessionLastPromotionAt.set(sessionId, now);

  const conn = connections.get(connectionId);
  if (conn?.lastCols && conn?.lastRows) {
    runTmuxResize(conn.tmuxSessionName, conn.lastCols, conn.lastRows);
  }

  log.debug("promoted connection to primary", { connectionId, sessionId, force });
  broadcastPrimaryChanged(sessionId);
}

/**
 * Select the best replacement primary from a session's remaining connections:
 * prefer visible connections, break ties by most recent `lastFocusAt`.
 */
function pickNextPrimary(sessionId: string): string | null {
  const conns = getConnectionsForSession(sessionId);
  if (conns.length === 0) return null;
  const visible = conns.filter((c) => c.isVisible);
  const pool = visible.length > 0 ? visible : conns;
  let best = pool[0];
  for (const c of pool) {
    if (c.lastFocusAt > best.lastFocusAt) best = c;
  }
  return best.connectionId;
}

/**
 * Destroy a PTY and release its file descriptors.
 * Uses the runtime's destroy() method which closes the socket/FDs,
 * falling back to kill() (SIGHUP only) if destroy() is unavailable.
 */
function destroyPty(ptyProcess: IPty): void {
  const withDestroy = ptyProcess as IPty & { destroy?: () => void };
  if (typeof withDestroy.destroy === "function") {
    withDestroy.destroy();
  } else {
    ptyProcess.kill();
  }
}

/**
 * Destroy a PTY, ignoring errors if it's already dead.
 * No-op for null (control-mode connections have no PTY — remote-dev-d5ci).
 */
function safeDestroyPty(ptyProcess: IPty | null): void {
  if (!ptyProcess) return;
  try { destroyPty(ptyProcess); } catch { /* PTY may already be dead */ }
}

/**
 * Safely cleanup a single connection. Guards against double-cleanup from
 * concurrent events (PTY exit, WebSocket close, WebSocket error).
 */
function cleanupConnection(connectionId: string): void {
  const conn = connections.get(connectionId);
  if (!conn) return;

  // Remove from connections map first to prevent concurrent cleanup
  connections.delete(connectionId);

  // [remote-dev-d5ci] Control connections only live in the `connections` map (for
  // broadcasts). They have no PTY and no session-level state, so skip ALL
  // per-session teardown — a control disconnect must NOT mark anything suspended
  // or hand off primary.
  if (conn.isControl) {
    return;
  }

  // Remove from session connections and update session-level state
  const connSet = sessionConnections.get(conn.sessionId);
  if (connSet) {
    connSet.delete(connectionId);
  }

  const isLastConnection = !connSet || connSet.size === 0;
  if (isLastConnection) {
    // Last connection closed — clean up all session-level state
    sessionConnections.delete(conn.sessionId);
    sessionPrimaryConnection.delete(conn.sessionId);
    sessionLastPromotionAt.delete(conn.sessionId);
    // [remote-dev-f9y9] Keep status indicators + progress in memory across a
    // transient WS disconnect (tmux/agent still alive) so a reconnecting client
    // recovers them via the attach-time replay below — they have no DB fallback.
    // Only drop them when the session itself has ended (tmux gone).
    if (!tmuxSessionExists(conn.tmuxSessionName)) {
      sessionStatusIndicators.delete(conn.sessionId);
      sessionProgressBars.delete(conn.sessionId);
    }
    for (const [claudeId, rdvId] of claudeSessionMap) {
      if (rdvId === conn.sessionId) {
        claudeSessionMap.delete(claudeId);
      }
    }
    // Clean up MCP socket cache entry if the MCP server has exited.
    // Don't destroy live sockets — the MCP server outlives browser connections.
    getMcpPush().then(async ({ closeMcpSocket, getMcpSocketPath }) => {
      const { accessSync } = await import("node:fs");
      try { accessSync(getMcpSocketPath(conn.sessionId)); } catch {
        closeMcpSocket(conn.sessionId);
      }
    }).catch(() => {});
  } else if (sessionPrimaryConnection.get(conn.sessionId) === connectionId) {
    // Primary disconnected — pick the most-recently-focused (preferring visible)
    // remaining connection and apply its size to tmux.
    const nextPrimary = pickNextPrimary(conn.sessionId);
    if (nextPrimary) {
      sessionPrimaryConnection.set(conn.sessionId, nextPrimary);
      sessionLastPromotionAt.set(conn.sessionId, Date.now());
      const nextConn = connections.get(nextPrimary);
      if (nextConn?.lastCols && nextConn?.lastRows) {
        runTmuxResize(nextConn.tmuxSessionName, nextConn.lastCols, nextConn.lastRows);
      }
      log.debug("primary handoff on disconnect", { from: connectionId, to: nextPrimary, sessionId: conn.sessionId });
      broadcastPrimaryChanged(conn.sessionId);
    }
  }

  // Per-connection cleanup
  if (conn.resizeTimeout) clearTimeout(conn.resizeTimeout);
  safeDestroyPty(conn.pty);
}

/**
 * Check if tmux is installed
 */
function checkTmuxInstalled(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists
 */
function tmuxSessionExists(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session with optimal settings
 * @param historyLimit - Scrollback buffer size (default: 50000 lines)
 */
function createTmuxSession(
  sessionName: string,
  cols: number,
  rows: number,
  cwd?: string,
  historyLimit: number = 50000
): void {
  const args = ["new-session", "-d", "-s", sessionName, "-x", String(cols), "-y", String(rows)];
  if (cwd) {
    args.push("-c", cwd);
  }
  execFileSync("tmux", args, { stdio: "pipe" });

  // Enable mouse mode for scrolling in alternate screen apps (vim, less, claude code, etc.)
  // Use Shift+click to bypass and select text with xterm.js
  execFileSync("tmux", ["set-option", "-t", sessionName, "mouse", "on"], { stdio: "pipe" });

  // Set scrollback buffer (history-limit) for performance tuning
  // Lower values reduce memory usage for long-running sessions
  execFileSync("tmux", ["set-option", "-t", sessionName, "history-limit", String(historyLimit)], { stdio: "pipe" });

  // Prevent tmux from resizing window to smallest attached client
  // This fixes the issue where switching tabs causes resize
  execFileSync("tmux", ["set-option", "-t", sessionName, "aggressive-resize", "off"], { stdio: "pipe" });

  // Disable tmux status bar — it consumes 1 row and causes the bottom line
  // of terminal content to be clipped. Session info is already shown in the app UI.
  execFileSync("tmux", ["set-option", "-t", sessionName, "status", "off"], { stdio: "pipe" });
}

/**
 * Attach to a tmux session using a PTY wrapper.
 * SECURITY: Spawns tmux directly without shell interpolation to prevent command injection.
 */
function attachToTmuxSession(
  sessionName: string,
  cols: number,
  rows: number
): IPty {
  // Re-apply idempotently so sessions created before these options existed
  // (pre-471f226) get fixed on attach — the status bar otherwise clips the
  // last row of app content. Failures are non-fatal.
  for (const option of ["status", "aggressive-resize"] as const) {
    try {
      execFileSync("tmux", ["set-option", "-t", sessionName, option, "off"], { stdio: "pipe" });
    } catch (err) {
      log.warn("Failed to disable tmux option on attach", { error: String(err), sessionName, option });
    }
  }

  // SECURITY: Spawn tmux directly with array arguments - no shell interpolation
  // Use clean environment to prevent framework internal vars from leaking
  const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", sessionName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: getCleanEnvironment(),
  });

  return ptyProcess;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = "";
  await new Promise<void>((resolve) => {
    req.on("data", (chunk) => (body += chunk));
    req.on("end", resolve);
  });
  return body;
}

function isLocalhostRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  // Unix domain socket connections have no remoteAddress — they are inherently local
  if (!addr) return true;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

async function parseRequestJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  const body = await readRequestBody(req);
  try {
    return JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return null;
  }
}

async function handleInternalApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  if (pathname === "/health" && req.method === "GET") {
    const health = getSchedulerHealth();
    sendJson(res, health.code, health.body);
    return true;
  }

  // --- Localhost restriction for ALL internal endpoints ---
  if (pathname.startsWith("/internal/")) {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
  }

  // Session drain notification for auto-update system
  // Called by AutoUpdateOrchestrator: POST /internal/drain
  if (pathname === "/internal/drain" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { countdownSeconds, version } = payload;

    internalLog.info("Drain notification received", { countdownSeconds, version });
    broadcastToClients({
      type: "update_pending",
      countdownSeconds: countdownSeconds ?? 0,
      version: version ?? "unknown",
    });

    sendJson(res, 200, getSessionCounts());
    return true;
  }

  // Session drain status query (no broadcast)
  // Called by AutoUpdateOrchestrator: POST /internal/drain-status
  if (pathname === "/internal/drain-status" && req.method === "POST") {
    sendJson(res, 200, getSessionCounts());
    return true;
  }

  // Handle agent exit notification from tmux hook
  // Called when agent process exits: POST /internal/agent-exit?sessionId=xxx&exitCode=0
  if (pathname === "/internal/agent-exit" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const exitCode = query.exitCode ? parseInt(query.exitCode as string, 10) : null;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    agentLog.info("Session exited", { sessionId, exitCode: exitCode ?? "unknown" });

    // Notify all connected clients for this session
    const clientCount = getConnectionsForSession(sessionId).length;
    if (clientCount > 0) {
      broadcastToSession(sessionId, agentExitedEvent(sessionId, exitCode));
      agentLog.debug("Notified clients", { sessionId, clientCount });
    } else {
      agentLog.debug("No active WebSocket connections", { sessionId });
    }

    // [n6uc] Refresh tree metadata after exit (dev servers may have stopped →
    // ports/dirty change). Fire-and-forget, scoped to the session's owner.
    void (async () => {
      try {
        const { db } = await import("@/db");
        const { terminalSessions } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const row = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, sessionId),
          columns: { userId: true },
        });
        if (row?.userId) await broadcastSessionMetadata(sessionId, row.userId);
      } catch (err) {
        agentLog.warn("session_metadata refresh failed", {
          error: String(err),
          sessionId,
        });
      }
    })();

    sendJson(res, 200, { success: true, sessionId, exitCode });
    return true;
  }

  // Handle agent activity status from Claude Code hooks
  // Called by hooks: POST /internal/agent-status?sessionId=xxx&status=running|waiting
  //   [&source=subagent-stop]
  if (pathname === "/internal/agent-status" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const status = query.status as string;
    // [remote-dev-1aa5c] Source tag. The SubagentStop hook posts "running" when a
    // Task subagent finishes, but the parent turn may already have ended (a clean
    // Stop wrote "idle"/"ended"). A subagent-stop "running" must NOT resurrect a
    // turn that already ended — a legitimately new turn re-asserts running via
    // PreToolUse immediately.
    const source = (query.source as string | undefined) ?? null;

    if (!sessionId || !status) {
      sendJson(res, 400, { error: "Missing sessionId or status parameter" });
      return true;
    }

    // [remote-dev-1aa5b] Server-arrival epoch ms — the monotonic ordering key.
    // Captured at request arrival so a slow/late hook write carries an older
    // timestamp than a newer one and the WHERE guard below rejects it.
    const statusAt = Date.now();

    // [remote-dev-1aa5a] AWAIT the DB persist BEFORE broadcasting. The old
    // fire-and-forget order let a focus-triggered refreshSessions read the DB
    // mid-flight and roll the live cache back to a stale "running". On persist
    // failure we still broadcast (best-effort liveness) and log the error.
    let persistOk = false;
    try {
      const [{ db }, { terminalSessions }, { eq, and, sql }] = await Promise.all([
        import("@/db"),
        import("@/db/schema"),
        import("drizzle-orm"),
      ]);
      // Monotonic WHERE guard: only write when this arrival is newer-or-equal
      // than the persisted one (or none recorded yet). A subagent-stop "running"
      // additionally refuses to overwrite a terminal 'idle'/'ended' status.
      // This atomic SQL mirrors the (unit-tested) predicate in
      // `@/server/agent-status-ordering` (shouldApplyStatusWrite) — keep them in
      // lockstep.
      const guards = [
        eq(terminalSessions.id, sessionId),
        sql`(${terminalSessions.agentActivityStatusAt} IS NULL OR ${terminalSessions.agentActivityStatusAt} <= ${statusAt})`,
      ];
      if (source === "subagent-stop" && status === "running") {
        guards.push(sql`(${terminalSessions.agentActivityStatus} IS NULL OR ${terminalSessions.agentActivityStatus} NOT IN ('idle', 'ended'))`);
      }
      await retryOnBusy(() =>
        db
          .update(terminalSessions)
          .set({ agentActivityStatus: status, agentActivityStatusAt: statusAt })
          .where(and(...guards))
      );
      persistOk = true;
    } catch (err) {
      agentStatusLog.error("Failed to persist activity status", { error: String(err), sessionId, status });
    }

    // Broadcast to all clients so any connected client can update the sidebar
    // indicator. Carries statusAt so the client cache can apply monotonic
    // ordering too; clients ignore the broadcast's ordering only when missing
    // (older servers). Always broadcast — even if persist failed — so live
    // viewers still see the transition.
    broadcastToClients({ type: "agent_activity_status", sessionId, status, statusAt });
    if (!persistOk) {
      agentStatusLog.warn("Broadcast activity status without persistence", { sessionId, status });
    }

    // [n6uc] Refresh live tree metadata (dirty/ports/attention) on every status
    // transition, scoped to the session's owner. Fire-and-forget.
    void (async () => {
      try {
        const { db } = await import("@/db");
        const { terminalSessions } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const row = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, sessionId),
          columns: { userId: true },
        });
        if (row?.userId) await broadcastSessionMetadata(sessionId, row.userId);
      } catch (err) {
        agentStatusLog.warn("session_metadata refresh failed", {
          error: String(err),
          sessionId,
        });
      }
    })();

    // [remote-dev-3b3l] Reactive usage-limit scan on idle/ended. When a Claude
    // agent session with a profile goes quiet, scan its recent scrollback for
    // the "usage limit reached" phrase; on a hit, record + broadcast + relaunch.
    // Fire-and-forget; `scanSessionScrollbackForLimit` self-guards on
    // provider/profile/already-limited and never throws.
    if (status === "idle" || status === "ended") {
      void (async () => {
        try {
          const { db } = await import("@/db");
          const { terminalSessions } = await import("@/db/schema");
          const { eq } = await import("drizzle-orm");
          const row = await db.query.terminalSessions.findFirst({
            where: eq(terminalSessions.id, sessionId),
            columns: {
              id: true,
              userId: true,
              projectId: true,
              profileId: true,
              agentProvider: true,
              tmuxSessionName: true,
              name: true,
            },
          });
          if (row) await scanSessionScrollbackForLimit(row);
        } catch (err) {
          usageLog.warn("Idle usage-limit scan setup failed", {
            error: String(err),
            sessionId,
          });
        }
      })();
    }

    // [y5ch.3] Create an in-app notification only for waiting/error statuses
    // (idle/ended/running/compacting/subagent never reach this branch — a clean
    // stop is passive and produces no notification). Severity is explicit:
    // waiting → actionable, error → error. Focus-awareness (y5ch.4) and
    // coalescing/push-gating (y5ch.5/.10) are handled by createNotification.
    if (status === "waiting" || status === "error") {
      Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm"), import("@/services/notification-service")])
        .then(async ([{ db }, { terminalSessions }, { eq }, NotificationService]) => {
          // Look up session for name and userId
          const session = await db.query.terminalSessions.findFirst({
            where: eq(terminalSessions.id, sessionId),
            columns: { name: true, userId: true },
          });
          if (!session) return;
          const isWaiting = status === "waiting";
          const notification = await NotificationService.createNotification({
            userId: session.userId,
            sessionId,
            sessionName: session.name,
            type: isWaiting ? "agent_waiting" : "agent_error",
            severity: isWaiting ? "actionable" : "error",
            title: isWaiting ? "Agent waiting for input" : "Agent encountered an error",
            body: `Session "${session.name}" needs attention`,
            meta: { deepLinkSessionId: sessionId, cta: { label: "Open session", action: "open_session" } },
            focused: isSessionFocusedByUser(session.userId, sessionId),
          });
          if (!notification) return; // coalesced or suppressed
          // Broadcast notification to clients for real-time update
          broadcastToClients({
            type: "notification",
            notification: {
              ...notification,
              createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : notification.createdAt,
              updatedAt: notification.updatedAt instanceof Date ? notification.updatedAt.toISOString() : notification.updatedAt,
              readAt: notification.readAt instanceof Date ? notification.readAt.toISOString() : notification.readAt,
            },
          });
        })
        .catch((err) => agentStatusLog.error("Failed to create notification", { error: String(err) }));
    }

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /internal/usage-limit — record a Claude usage-limit observation.
  // [remote-dev-3b3l] The manual/programmatic seam the Phase-2 poller / rdv
  // hook (and the manual "mark limited" UI) will use. Body:
  //   { sessionId?, profileId?, isLimited, resetAt5h?, resetAt7d?,
  //     window5hPct?, window7dPct?, source? }
  // Resolves profileId/userId/projectId from the session row when sessionId is
  // given, else from profileId + its owning profile. Records via the use-case,
  // broadcasts `profile_limit_changed`, and (when limited + a session/project
  // is known) fires the relaunch use-case.
  if (pathname === "/internal/usage-limit" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true; // invalid JSON already responded

    const sessionId = payload.sessionId as string | undefined;
    const bodyProfileId = payload.profileId as string | undefined;
    const isLimited = payload.isLimited === true;
    const source =
      (payload.source as import("@/types/claude-limits").UsageDetectionSource | undefined) ??
      "manual";

    // A reset can arrive as an ISO string or an epoch number; coerce to
    // Date | null. Anthropic's reset headers are epoch SECONDS (the reactive
    // detector multiplies them by 1000), so disambiguate by magnitude: a value
    // below 1e12 is treated as seconds, otherwise as milliseconds.
    const toDate = (v: unknown): Date | null => {
      if (v == null) return null;
      if (typeof v === "number") {
        return new Date(v < 1e12 ? v * 1000 : v);
      }
      if (typeof v === "string") {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      return null;
    };
    const toPct = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    try {
      // Resolve the (profileId, userId, projectId, …) tuple.
      let profileId: string | undefined = bodyProfileId;
      let userId: string | undefined;
      let projectId: string | null = null;
      let sessionName: string | null = null;
      let agentProvider: string | null = null;

      const { db } = await import("@/db");

      if (sessionId) {
        const { terminalSessions } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const row = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, sessionId),
          columns: {
            userId: true,
            profileId: true,
            projectId: true,
            agentProvider: true,
            name: true,
          },
        });
        if (!row) {
          sendJson(res, 404, { error: "Session not found" });
          return true;
        }
        userId = row.userId;
        profileId = profileId ?? row.profileId ?? undefined;
        projectId = row.projectId ?? null;
        sessionName = row.name ?? null;
        agentProvider = row.agentProvider ?? null;
      } else if (profileId) {
        // No session — resolve the owner from the profile itself.
        const { agentProfiles } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const profile = await db.query.agentProfiles.findFirst({
          where: eq(agentProfiles.id, profileId),
          columns: { userId: true },
        });
        if (!profile) {
          sendJson(res, 404, { error: "Profile not found" });
          return true;
        }
        userId = profile.userId;
      }

      if (!profileId || !userId) {
        sendJson(res, 400, {
          error: "Could not resolve a profileId + userId (pass sessionId or profileId)",
        });
        return true;
      }

      await trackAndBroadcastLimit({
        profileId,
        userId,
        source,
        isLimited,
        resetAt5h: toDate(payload.resetAt5h),
        resetAt7d: toDate(payload.resetAt7d),
        window5hPct: toPct(payload.window5hPct),
        window7dPct: toPct(payload.window7dPct),
        observedAt: new Date(),
        projectId,
        sessionId,
        sessionName,
        agentProvider,
      });

      sendJson(res, 200, { ok: true });
    } catch (err) {
      usageLog.error("usage-limit endpoint failed", { error: String(err) });
      sendJson(res, 500, { error: "Failed to record usage limit" });
    }
    return true;
  }

  // POST /internal/proxy-state — report active API endpoint from agent session
  // Called by PreToolUse hook: { sessionId, baseUrl, keyPrefix, apiKey }
  if (pathname === "/internal/proxy-state" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { sessionId, baseUrl, keyPrefix, apiKey } = payload;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    // Store full state in memory for prefill (apiKey never broadcast to WS clients)
    proxyStateStore.set(sessionId as string, {
      baseUrl: (baseUrl as string) || "",
      keyPrefix: (keyPrefix as string) || "",
      apiKey: (apiKey as string) || "",
    });

    // Broadcast to UI clients for real-time endpoint display (no apiKey!)
    broadcastToClients({
      type: "proxy_state",
      sessionId,
      baseUrl: baseUrl || null,
      keyPrefix: keyPrefix || null,
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  // GET /internal/proxy-state/key?sessionId=xxx — retrieve stored API key for prefill
  if (pathname === "/internal/proxy-state/key" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }
    const state = proxyStateStore.get(sessionId);
    sendJson(res, 200, {
      apiKey: state?.apiKey || null,
      baseUrl: state?.baseUrl || null,
      keyPrefix: state?.keyPrefix || null,
    });
    return true;
  }

  // POST /internal/notify — create a notification from rdv CLI hooks
  if (pathname === "/internal/notify" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true; // invalid JSON already responded
    // [y5ch.3/.8] accept optional severity + meta from the CLI payload.
    const { sessionId, type, title, body: notifBody, severity, meta } = payload;
    if (!sessionId || !type || !title) {
      sendJson(res, 400, { error: "Missing sessionId, type, or title" });
      return true;
    }

    Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm"), import("@/services/notification-service")])
      .then(async ([{ db }, { terminalSessions }, { eq }, NotificationService]) => {
        const session = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, sessionId as string),
          columns: { name: true, userId: true },
        });
        if (!session) return;
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
        broadcastToClients({
          type: "notification",
          notification: {
            ...notification,
            createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : notification.createdAt,
            updatedAt: notification.updatedAt instanceof Date ? notification.updatedAt.toISOString() : notification.updatedAt,
            readAt: notification.readAt instanceof Date ? notification.readAt.toISOString() : notification.readAt,
          },
        });
      })
      .catch((err) => notifyLog.error("Failed to create notification", { error: String(err) }));

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /internal/notification-dismissed — broadcast that notifications were read/deleted
  if (pathname === "/internal/notification-dismissed" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { ids, all, userId } = payload;
    if (!userId) {
      sendJson(res, 400, { error: "Missing userId" });
      return true;
    }
    broadcastToUser(userId as string, {
      type: "notification_dismissed",
      ids: ids ?? [],
      all: all ?? false,
    });
    sendJson(res, 200, { success: true });
    return true;
  }

  // Sidebar data changed — broadcast to the user's UI clients so they refetch sessions/folders
  // Called by Next.js API routes after session/folder mutations
  if (req.method === "POST" && pathname === "/internal/sidebar-changed") {
    try {
      const body = await readRequestBody(req);
      const { userId } = JSON.parse(body);
      if (userId) {
        broadcastToUser(userId as string, { type: "sidebar_changed" });
      } else {
        broadcastToClients({ type: "sidebar_changed" });
      }
    } catch {
      broadcastToClients({ type: "sidebar_changed" });
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Handle beads issue updates — broadcast to UI clients
  // Called by hooks: POST /internal/beads-updated
  if (req.method === "POST" && pathname === "/internal/beads-updated") {
    try {
      const body = await readRequestBody(req);
      const { projectPath } = JSON.parse(body);
      broadcastToClients({ type: "beads_issues_updated", projectPath });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      internalLog.error("Beads update broadcast error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to broadcast beads update" });
    }
    return true;
  }

  // Handle browser frame broadcast for browser pane sessions
  // POST /internal/browser-frame { sessionId, data } - broadcasts base64 screenshot to session client
  if (pathname === "/internal/browser-frame" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const { sessionId, data } = JSON.parse(body) as { sessionId: string; data: string };
      broadcastToSession(sessionId, {
        type: "browser_frame",
        sessionId,
        data,
      });
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return true;
  }

  // --- cmux parity: PTY control, screen capture, session metadata endpoints ---

  // POST /internal/pty-write — write text directly to a session's PTY
  if (pathname === "/internal/pty-write" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, text } = payload as { sessionId: string; text: string };
      if (!sessionId || text == null) {
        sendJson(res, 400, { error: "Missing sessionId or text" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn?.pty) {
        sendJson(res, 404, { error: "No active PTY session found" });
        return true;
      }
      conn.pty.write(text);
      ptyLog.debug("PTY write", { sessionId, connectionId: conn.connectionId, length: text.length });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("PTY write error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to write to PTY" });
    }
    return true;
  }

  // POST /internal/pty-key — send a named keystroke to a session via tmux send-keys
  if (pathname === "/internal/pty-key" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key } = payload as { sessionId: string; key: string };
      if (!sessionId || !key) {
        sendJson(res, 400, { error: "Missing sessionId or key" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn) {
        sendJson(res, 404, { error: "No active PTY session found" });
        return true;
      }
      const tmuxName = conn.tmuxSessionName;
      const mappedKey = TMUX_KEY_MAP[key];

      if (mappedKey) {
        await execFileAsync("tmux", ["send-keys", "-t", tmuxName, mappedKey]);
      } else if (key.length === 1) {
        await execFileAsync("tmux", ["send-keys", "-t", tmuxName, "-l", key]);
      } else {
        sendJson(res, 400, { error: `Unknown key: ${key}` });
        return true;
      }

      ptyLog.debug("PTY key sent", { sessionId, key, mappedKey: mappedKey || key });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("PTY key error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to send key" });
    }
    return true;
  }

  // GET /internal/screen?sessionId=xxx — capture terminal screen content
  if (pathname === "/internal/screen" && req.method === "GET") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const sessionId = query.sessionId as string;
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane", "-t", conn.tmuxSessionName, "-p", "-J",
      ]);
      sendJson(res, 200, {
        sessionId,
        content: stdout,
        capturedAt: new Date().toISOString(),
      });
    } catch (error) {
      ptyLog.error("Screen capture error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to capture screen" });
    }
    return true;
  }

  // POST /internal/session-status — set a per-session status indicator
  if (pathname === "/internal/session-status" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key: statusKey, value, icon, color } = payload as {
        sessionId: string; key: string; value: string; icon?: string; color?: string;
      };
      if (!sessionId || !statusKey || value === undefined) {
        sendJson(res, 400, { error: "Missing sessionId, key, or value" });
        return true;
      }
      const indicator: StatusIndicator = {
        value,
        icon,
        color,
        updatedAt: new Date().toISOString(),
      };
      let indicators = sessionStatusIndicators.get(sessionId);
      if (!indicators) {
        indicators = new Map<string, StatusIndicator>();
        sessionStatusIndicators.set(sessionId, indicators);
      }
      indicators.set(statusKey, indicator);
      broadcastToClients({
        type: "session_status_update",
        sessionId,
        key: statusKey,
        indicator,
      });
      ptyLog.debug("Session status set", { sessionId, key: statusKey, value });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session status error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to set session status" });
    }
    return true;
  }

  // DELETE /internal/session-status — clear a per-session status indicator
  if (pathname === "/internal/session-status" && req.method === "DELETE") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key: statusKey } = payload as { sessionId: string; key: string };
      if (!sessionId || !statusKey) {
        sendJson(res, 400, { error: "Missing sessionId or key" });
        return true;
      }
      const indicators = sessionStatusIndicators.get(sessionId);
      if (indicators) {
        indicators.delete(statusKey);
        if (indicators.size === 0) {
          sessionStatusIndicators.delete(sessionId);
        }
      }
      broadcastToClients({
        type: "session_status_cleared",
        sessionId,
        key: statusKey,
      });
      ptyLog.debug("Session status cleared", { sessionId, key: statusKey });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session status clear error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to clear session status" });
    }
    return true;
  }

  // POST /internal/session-progress — set per-session progress
  if (pathname === "/internal/session-progress" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, value, label } = payload as {
        sessionId: string; value: number; label?: string;
      };
      if (!sessionId || value === undefined) {
        sendJson(res, 400, { error: "Missing sessionId or value" });
        return true;
      }
      const clampedValue = Math.max(0.0, Math.min(1.0, Number(value)));
      const progress: SessionProgress = {
        value: clampedValue,
        label,
        updatedAt: new Date().toISOString(),
      };
      sessionProgressBars.set(sessionId, progress);
      broadcastToClients({
        type: "session_progress_update",
        sessionId,
        value: clampedValue,
        label,
      });
      ptyLog.debug("Session progress set", { sessionId, value: clampedValue, label });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session progress error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to set session progress" });
    }
    return true;
  }

  // DELETE /internal/session-progress — clear per-session progress
  if (pathname === "/internal/session-progress" && req.method === "DELETE") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId } = payload as { sessionId: string };
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId" });
        return true;
      }
      sessionProgressBars.delete(sessionId);
      broadcastToClients({
        type: "session_progress_cleared",
        sessionId,
      });
      ptyLog.debug("Session progress cleared", { sessionId });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session progress clear error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to clear session progress" });
    }
    return true;
  }

  // POST /internal/session-log — structured per-session log entry
  if (pathname === "/internal/session-log" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, message, level, source } = payload as {
        sessionId: string; message: string; level?: string; source?: string;
      };
      if (!sessionId || !message) {
        sendJson(res, 400, { error: "Missing sessionId or message" });
        return true;
      }
      const sessionLog = createLogger(source || "SessionLog");
      const logData = { sessionId };
      switch (level) {
        case "error":
          sessionLog.error(message, logData);
          break;
        case "warn":
          sessionLog.warn(message, logData);
          break;
        case "debug":
          sessionLog.debug(message, logData);
          break;
        case "trace":
          sessionLog.trace(message, logData);
          break;
        default:
          sessionLog.info(message, logData);
          break;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session log error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to write session log" });
    }
    return true;
  }

  // POST /internal/claude-session-map — map Claude Code session ID to rdv session ID
  if (pathname === "/internal/claude-session-map" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { claudeSessionId, rdvSessionId } = payload as {
        claudeSessionId: string; rdvSessionId: string;
      };
      if (!claudeSessionId || !rdvSessionId) {
        sendJson(res, 400, { error: "Missing claudeSessionId or rdvSessionId" });
        return true;
      }
      claudeSessionMap.set(claudeSessionId, rdvSessionId);
      ptyLog.debug("Claude session mapped", { claudeSessionId, rdvSessionId });
      // [hgwo] Durably persist Claude's native session id to the DB (the
      // in-memory map above is lost on terminal-server restart). This enables
      // `claude --resume <id>` relaunch after process/server/pod death.
      try {
        const [{ db }, { terminalSessions }, { eq }] = await Promise.all([
          import("@/db"), import("@/db/schema"), import("drizzle-orm"),
        ]);
        const sess = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, rdvSessionId),
          columns: { userId: true },
        });
        if (sess) {
          const { persistAgentSessionId } = await import("@/services/agent-session-id-service");
          await persistAgentSessionId(rdvSessionId, sess.userId, "claude", claudeSessionId);
        }
      } catch (persistErr) {
        ptyLog.warn("Failed to durably persist claude session id", {
          rdvSessionId, error: String(persistErr),
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Claude session map error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to map Claude session" });
    }
    return true;
  }

  // GET /internal/claude-session-map?claudeSessionId=xxx — look up rdv session ID
  if (pathname === "/internal/claude-session-map" && req.method === "GET") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    const claudeSessionId = query.claudeSessionId as string;
    if (!claudeSessionId) {
      sendJson(res, 400, { error: "Missing claudeSessionId" });
      return true;
    }
    const rdvSessionId = claudeSessionMap.get(claudeSessionId);
    if (!rdvSessionId) {
      sendJson(res, 404, { error: "Claude session mapping not found" });
      return true;
    }
    sendJson(res, 200, { rdvSessionId });
    return true;
  }

  // [hgwo] POST /internal/agent-session-id — durably record a provider's native
  // session id so the agent's CONVERSATION can be resumed after process death,
  // terminal-server restart, or pod restart. Generic across all 5 providers
  // (Claude also pushes via the claude-session-map handler above; Codex/Gemini/
  // OpenCode have no hook and fall back to disk discovery at relaunch).
  if (pathname === "/internal/agent-session-id" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, provider, nativeSessionId } = payload as {
        sessionId?: string; provider?: string; nativeSessionId?: string;
      };
      if (!sessionId || !provider || !nativeSessionId) {
        sendJson(res, 400, { error: "Missing sessionId, provider, or nativeSessionId" });
        return true;
      }
      const [{ db }, { terminalSessions }, { eq }] = await Promise.all([
        import("@/db"), import("@/db/schema"), import("drizzle-orm"),
      ]);
      const sess = await db.query.terminalSessions.findFirst({
        where: eq(terminalSessions.id, sessionId),
        columns: { userId: true },
      });
      if (!sess) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      const { persistAgentSessionId } = await import("@/services/agent-session-id-service");
      await persistAgentSessionId(
        sessionId, sess.userId, provider as AgentProviderType, nativeSessionId,
      );
      // Broadcast the enriched map so connected clients update their local copy.
      try {
        const { getSession } = await import("@/services/session-service");
        const updated = await getSession(sessionId, sess.userId);
        const agentSessionId = updated?.typeMetadata?.agentSessionId as
          | Record<string, string>
          | undefined;
        broadcastToUser(sess.userId, {
          type: "session_renamed",
          sessionId,
          name: updated?.name ?? "",
          agentSessionId,
        });
      } catch (broadcastErr) {
        internalLog.warn("Failed to broadcast agent session id", {
          sessionId, error: String(broadcastErr),
        });
      }
      sendJson(res, 200, { applied: true });
    } catch (error) {
      internalLog.error("agent-session-id error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to persist agent session id" });
    }
    return true;
  }

  // ═══ Agent title endpoint ════════════════════════════════════════════

  // POST /internal/agent-title/set?sessionId=xxx&title=yyy — set agent session title (kebab-case)
  if (pathname === "/internal/agent-title/set" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const title = query.title as string;

    if (!sessionId || !title) {
      sendJson(res, 400, { error: "Missing sessionId or title parameter" });
      return true;
    }

    // Validate kebab-case: lowercase letters, digits, and hyphens, 3-5 hyphen-separated words
    const kebabWords = title.split("-");
    if (
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(title) ||
      kebabWords.length < 3 ||
      kebabWords.length > 5
    ) {
      sendJson(res, 400, {
        error: "Title must be kebab-case (lowercase letters, digits, and hyphens) with 3-5 words",
      });
      return true;
    }

    try {
      const [{ db }, { terminalSessions }, { eq }, { safeJsonParse }] = await Promise.all([
        import("@/db"),
        import("@/db/schema"),
        import("drizzle-orm"),
        import("@/lib/utils"),
      ]);

      const session = await db.query.terminalSessions.findFirst({
        where: eq(terminalSessions.id, sessionId),
        columns: { id: true, name: true, userId: true, typeMetadata: true },
      });

      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }

      const meta = safeJsonParse<Record<string, unknown>>(session.typeMetadata, {});

      // Append current name to titleHistory before overwriting (capped at 10)
      const history = Array.isArray(meta.titleHistory) ? [...meta.titleHistory] : [];
      if (session.name) {
        history.push(session.name);
      }
      meta.titleHistory = history.slice(-10);
      meta.titleLocked = true;

      await db
        .update(terminalSessions)
        .set({
          name: title,
          typeMetadata: JSON.stringify(meta),
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, sessionId));

      broadcastToUser(session.userId, {
        type: "session_renamed",
        sessionId,
        name: title,
      });

      agentStatusLog.info("Agent session title set manually", { sessionId, title });
      sendJson(res, 200, { applied: true, title });
    } catch (err) {
      agentStatusLog.error("Failed to set agent title", { error: String(err), sessionId });
      sendJson(res, 500, { error: "Failed to set title" });
    }
    return true;
  }

  // ═══ Peer communication endpoints ═════════════════════════════════════════

  // GET /internal/peers/list?sessionId=xxx
  if (pathname === "/internal/peers/list" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      const peers = await PeerService.getPeers(sessionId, (id) => sessionConnections.has(id));
      sendJson(res, 200, { peers });
    } catch (err) {
      peerLog.error("Failed to list peers", { error: String(err) });
      sendJson(res, 500, { error: "Failed to list peers" });
    }
    return true;
  }

  // POST /internal/peers/messages/send { fromSessionId, toSessionId?, body }
  if (pathname === "/internal/peers/messages/send" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, toSessionId, body: msgBody } = payload;
    if (!fromSessionId || !msgBody) {
      sendJson(res, 400, { error: "Missing fromSessionId or body" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      const result = await PeerService.sendMessage({
        fromSessionId: fromSessionId as string,
        toSessionId: toSessionId as string | undefined,
        body: msgBody as string,
      });

      broadcastToUser(result.userId, {
        type: "peer_message_created",
        projectId: result.projectId,
        channelId: result.channelId ?? null,
        message: {
          id: result.messageId,
          fromSessionId,
          fromSessionName: result.senderName,
          toSessionId: toSessionId ?? null,
          body: result.resolvedBody,
          isUserMessage: false,
          channelId: result.channelId ?? null,
          parentMessageId: null,
          replyCount: 0,
          createdAt: result.createdAt,
        },
      });

      // [x386.2] Record durable deliveries + push (ack-aware). Direct → the one
      // recipient; broadcast → all project peers. Each gets a delivery row so a
      // dropped push is recovered by the poll fallback.
      const senderSid = String(fromSessionId);
      const mcpEvent: import("@/server/mcp-push").McpPushEvent = {
        type: "peer_message",
        messageId: result.messageId,
        fromSessionId: senderSid,
        fromSessionName: result.senderName,
        toSessionId: toSessionId ? String(toSessionId) : null,
        body: result.resolvedBody,
        channelId: result.channelId ?? null,
        channelName: null,
        parentMessageId: null,
        createdAt: result.createdAt,
      };
      if (toSessionId) {
        deliverToRecipients(result.messageId, result.projectId, [String(toSessionId)], () => mcpEvent, senderSid).catch(
          (err) => peerLog.error("Failed to deliver direct peer message", { error: String(err) }),
        );
      } else {
        const PeerSvc = await import("@/services/peer-service");
        const peers = await PeerSvc.getProjectPeers(result.projectId);
        deliverToRecipients(
          result.messageId,
          result.projectId,
          peers.map((p) => p.sessionId),
          () => mcpEvent,
          senderSid,
        ).catch((err) => peerLog.error("Failed to deliver broadcast peer message", { error: String(err) }));
      }

      sendJson(res, 200, { messageId: result.messageId, resolvedBody: result.resolvedBody });
    } catch (err) {
      peerLog.error("Failed to send peer message", { error: String(err) });
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /internal/peers/messages/poll?sessionId=xxx&since=<isoTimestamp>
  if (pathname === "/internal/peers/messages/poll" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    const since = query.since as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      // [x386.4] When the caller opts into the durable cursor (cursor=durable),
      // use the delivery-state poll (exactly-once parity with MCP push) and
      // mark returned rows `delivered` via poll. Otherwise keep the legacy
      // timestamp scan for the chat-room UI / backward compat.
      const PeerService = await import("@/services/peer-service");
      if (query.cursor === "durable") {
        const messages = await PeerService.pollUndelivered(sessionId);
        sendJson(res, 200, { messages });
        return true;
      }
      const sinceDate = since ? new Date(since) : new Date(0);
      const messages = await PeerService.pollMessages(sessionId, sinceDate);
      sendJson(res, 200, { messages });
    } catch (err) {
      peerLog.error("Failed to poll peer messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to poll messages" });
    }
    return true;
  }

  // [x386.2] POST /internal/peers/ack { sessionId, messageId } — confirm receipt
  // (parity path for poll/CLI acks; the socket-level ack is the primary path).
  if (pathname === "/internal/peers/ack" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { sessionId, messageId } = payload;
    if (!sessionId || !messageId) {
      sendJson(res, 400, { error: "Missing sessionId or messageId" });
      return true;
    }
    try {
      const MD = await import("@/services/message-delivery-service");
      await MD.ackDelivery(String(messageId), String(sessionId));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      peerLog.error("Failed to ack delivery", { error: String(err) });
      sendJson(res, 500, { error: "Failed to ack" });
    }
    return true;
  }

  // [x386.4] POST /internal/peers/ack-batch { sessionId, messageIds[] } — the
  // non-MCP poll path acks everything it just surfaced so it isn't re-shown.
  if (pathname === "/internal/peers/ack-batch" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { sessionId, messageIds } = payload;
    if (!sessionId || !Array.isArray(messageIds)) {
      sendJson(res, 400, { error: "Missing sessionId or messageIds" });
      return true;
    }
    try {
      const MD = await import("@/services/message-delivery-service");
      await MD.ackDeliveries(messageIds.map(String), String(sessionId));
      sendJson(res, 200, { ok: true, acked: messageIds.length });
    } catch (err) {
      peerLog.error("Failed to ack delivery batch", { error: String(err) });
      sendJson(res, 500, { error: "Failed to ack batch" });
    }
    return true;
  }

  // [x386.3] GET /internal/peers/replay?sessionId=xxx — the undelivered set for
  // a session (same rows the socket replay handshake pushes). Used by tests and
  // the CLI poll path without the socket.
  if (pathname === "/internal/peers/replay" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }
    try {
      const MD = await import("@/services/message-delivery-service");
      const rows = await MD.getUndelivered(sessionId, 50);
      sendJson(res, 200, { messages: rows });
    } catch (err) {
      peerLog.error("Failed to fetch replay set", { error: String(err) });
      sendJson(res, 500, { error: "Failed to fetch replay set" });
    }
    return true;
  }

  // [x386.11] GET /internal/work-context?sessionId=xxx — lightweight work
  // context (branch/worktree/status) + READ-ONLY bd-issue join. Used by the
  // Rust digest/collision + the chat UI.
  if (pathname === "/internal/work-context" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }
    try {
      const WC = await import("@/services/work-context-service");
      const ctx = await WC.computeWorkContext(sessionId);
      sendJson(res, 200, { context: ctx });
    } catch (err) {
      peerLog.error("Failed to compute work context", { error: String(err) });
      sendJson(res, 500, { error: "Failed to compute work context" });
    }
    return true;
  }

  // [x386.12/.14] GET /internal/peers/digest?sessionId=xxx — start digest:
  // who's-working-on-what (work-context + claimed bd issues) + recent gotchas +
  // collisions. The heavy joins live in TS; the Rust hook just renders this.
  if (pathname === "/internal/peers/digest" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }
    try {
      const WC = await import("@/services/work-context-service");
      const digest = await WC.buildStartDigest(sessionId);
      sendJson(res, 200, digest);
    } catch (err) {
      peerLog.error("Failed to build peer digest", { error: String(err) });
      sendJson(res, 500, { error: "Failed to build digest" });
    }
    return true;
  }

  // POST /internal/peers/summary { sessionId, summary }
  if (pathname === "/internal/peers/summary" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { sessionId, summary } = payload;
    if (!sessionId || typeof summary !== "string") {
      sendJson(res, 400, { error: "Missing sessionId or summary" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      await PeerService.setSummary(sessionId as string, summary);
      broadcastToClients({ type: "peer_summary_updated", sessionId, summary });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      peerLog.error("Failed to set peer summary", { error: String(err) });
      sendJson(res, 500, { error: "Failed to set summary" });
    }
    return true;
  }

  // POST /internal/peers/broadcast { userId, folderId, message }
  // Used by Next.js API routes to broadcast peer messages to WebSocket clients
  if (pathname === "/internal/peers/broadcast" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { userId, folderId, message } = payload;
    if (!userId || !folderId || !message) {
      sendJson(res, 400, { error: "Missing userId, folderId, or message" });
      return true;
    }

    const eventType = (payload.type as string) || "peer_message_created";
    broadcastToUser(userId as string, {
      type: eventType,
      folderId,
      channelId: payload.channelId ?? null,
      parentMessageId: payload.parentMessageId ?? null,
      message,
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /internal/peers/cleanup
  if (pathname === "/internal/peers/cleanup" && req.method === "POST") {
    try {
      const PeerService = await import("@/services/peer-service");
      await PeerService.cleanupOldMessages();
      sendJson(res, 200, { ok: true });
    } catch (err) {
      peerLog.error("Failed to cleanup peer messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to cleanup" });
    }
    return true;
  }

  // ═══ Channel endpoints ════════════════════════════════════════════════════

  /** Look up a session's projectId (surfaced as folderId for compat) and userId by session ID. */
  async function getSessionFolderContext(sessionId: string): Promise<{ folderId: string; userId: string } | null> {
    const { terminalSessions } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const session = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
      columns: { projectId: true, userId: true },
    });
    if (!session?.projectId || !session.userId) return null;
    return { folderId: session.projectId, userId: session.userId };
  }

  /** Resolve a channel name to its ID within a project. */
  async function resolveChannelName(folderId: string, channelName: string): Promise<string | undefined> {
    const { channels: channelsTable } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const ch = await db.query.channels.findFirst({
      where: and(eq(channelsTable.projectId, folderId), eq(channelsTable.name, channelName)),
      columns: { id: true },
    });
    return ch?.id;
  }

  // GET /internal/channels/list?sessionId=xxx
  if (pathname === "/internal/channels/list" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(sessionId);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const ChannelService = await import("@/services/channel-service");
      const groups = await ChannelService.listChannelGroups(ctx.folderId, ctx.userId);
      sendJson(res, 200, { groups });
    } catch (err) {
      peerLog.error("Failed to list channels", { error: String(err) });
      sendJson(res, 500, { error: "Failed to list channels" });
    }
    return true;
  }

  // POST /internal/channels/create { fromSessionId, name, topic?, displayName? }
  if (pathname === "/internal/channels/create" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, name, topic, displayName } = payload;
    if (!fromSessionId || !name) {
      sendJson(res, 400, { error: "Missing fromSessionId or name" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(fromSessionId as string);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const ChannelService = await import("@/services/channel-service");
      const channel = await ChannelService.createChannel({
        projectId: ctx.folderId,
        name: name as string,
        displayName: displayName as string | undefined,
        topic: topic as string | undefined,
        createdBySessionId: fromSessionId as string,
      });

      broadcastToUser(ctx.userId, {
        type: "channel_created",
        folderId: ctx.folderId,
        channel,
      });

      sendJson(res, 201, { channel });
    } catch (err) {
      peerLog.error("Failed to create channel", { error: String(err) });
      sendJson(res, 400, { error: String(err) });
    }
    return true;
  }

  // POST /internal/channels/send { fromSessionId, channelId?, channelName?, body, parentMessageId? }
  if (pathname === "/internal/channels/send" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, channelId, channelName, body: msgBody, parentMessageId } = payload;
    if (!fromSessionId || !msgBody) {
      sendJson(res, 400, { error: "Missing fromSessionId or body" });
      return true;
    }

    try {
      let resolvedChannelId = channelId as string | undefined;

      // Resolve channel name to ID if needed
      if (!resolvedChannelId && channelName) {
        const ctx = await getSessionFolderContext(fromSessionId as string);
        if (ctx) {
          // [x386.6/.13] The per-project #agents system channel is auto-created
          // on demand (check-in/out + `rdv peer note` target it).
          if (channelName === "agents") {
            const ChannelService = await import("@/services/channel-service");
            resolvedChannelId = await ChannelService.getAgentsChannelId(ctx.folderId);
          } else {
            resolvedChannelId = await resolveChannelName(ctx.folderId, channelName as string);
          }
        }
        if (!resolvedChannelId) {
          sendJson(res, 404, { error: `Channel '${channelName}' not found` });
          return true;
        }
      }

      const PeerService = await import("@/services/peer-service");
      const result = await PeerService.sendMessage({
        fromSessionId: fromSessionId as string,
        body: msgBody as string,
        channelId: resolvedChannelId,
        parentMessageId: parentMessageId as string | undefined,
      });

      const eventType = parentMessageId ? "thread_reply_created" : "channel_message_created";
      const effectiveChannelId = result.channelId ?? resolvedChannelId ?? null;
      broadcastToUser(result.userId, {
        type: eventType,
        projectId: result.projectId,
        channelId: effectiveChannelId,
        parentMessageId: parentMessageId ?? null,
        message: {
          id: result.messageId,
          fromSessionId,
          fromSessionName: result.senderName,
          toSessionId: null,
          body: result.resolvedBody,
          isUserMessage: false,
          channelId: effectiveChannelId,
          parentMessageId: parentMessageId ?? null,
          replyCount: 0,
          createdAt: result.createdAt,
        },
      });

      // Push to MCP server sockets for channel messages (fire-and-forget)
      const mentionRe = /@<sid:([0-9a-f-]{36})>/g;
      const mentions = new Set<string>();
      let mentionMatch: RegExpExecArray | null;
      while ((mentionMatch = mentionRe.exec(result.resolvedBody)) !== null) {
        mentions.add(mentionMatch[1]);
      }
      const chSenderSid = String(fromSessionId);
      // Resolve channel name for the push event — may be null if sent by channelId only
      let resolvedChannelName = channelName ? String(channelName) : null;
      if (!resolvedChannelName && effectiveChannelId) {
        try {
          const { channels: channelsTable } = await import("@/db/schema");
          const { eq } = await import("drizzle-orm");
          const { db } = await import("@/db");
          const ch = await db.query.channels.findFirst({
            where: eq(channelsTable.id, effectiveChannelId),
            columns: { name: true },
          });
          if (ch) resolvedChannelName = ch.name;
        } catch { /* non-critical, name will be null in push */ }
      }
      // [x386.5/.7] Recipient set = channel auto-deliver subscribers ∪ @mentioned
      // sessions (mentions always delivered, even if unsubscribed). Each gets a
      // durable delivery row; non-subscribers get only their mentions.
      void (async () => {
        try {
          const PeerSvc = await import("@/services/peer-service");
          const ChanSubs = await import("@/services/channel-subscription-service");
          const peers = await PeerSvc.getProjectPeers(result.projectId);
          const peerIds = peers.map((p) => p.sessionId);
          const autoDeliver = effectiveChannelId
            ? await ChanSubs.getAutoDeliverSessions(effectiveChannelId, peerIds)
            : peerIds;
          const recipientSet = new Set<string>(autoDeliver);
          for (const m of mentions) recipientSet.add(m);
          await deliverToRecipients(
            result.messageId,
            result.projectId,
            [...recipientSet],
            (peerId) => ({
              type: mentions.has(peerId) ? "mention" : "channel_message",
              messageId: result.messageId,
              fromSessionId: chSenderSid,
              fromSessionName: result.senderName,
              toSessionId: null,
              body: result.resolvedBody,
              channelId: effectiveChannelId,
              channelName: resolvedChannelName,
              parentMessageId: parentMessageId ? String(parentMessageId) : null,
              createdAt: result.createdAt,
            }),
            chSenderSid,
          );
        } catch (err) {
          peerLog.error("Failed to deliver channel message", { error: String(err) });
        }
      })();

      sendJson(res, 200, { messageId: result.messageId, resolvedBody: result.resolvedBody });
    } catch (err) {
      peerLog.error("Failed to send channel message", { error: String(err) });
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /internal/channels/messages?sessionId=xxx&channelName=yyy&limit=20
  if (pathname === "/internal/channels/messages" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    const channelName = query.channelName as string;
    const limit = Math.min(Math.max(1, parseInt(query.limit as string || "20", 10) || 20), 50);

    if (!sessionId || !channelName) {
      sendJson(res, 400, { error: "Missing sessionId or channelName" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(sessionId);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const channelDbId = await resolveChannelName(ctx.folderId, channelName);
      if (!channelDbId) {
        sendJson(res, 404, { error: `Channel '${channelName}' not found` });
        return true;
      }

      const PeerService = await import("@/services/peer-service");
      const messages = await PeerService.listChannelMessages(channelDbId, { limit });
      sendJson(res, 200, { channelId: channelDbId, messages });
    } catch (err) {
      peerLog.error("Failed to read channel messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to read channel messages" });
    }
    return true;
  }

  // --- end cmux parity endpoints ---

  // --- LiteLLM proxy endpoints ---

  // POST /internal/litellm/start — start the LiteLLM proxy process
  if (pathname === "/internal/litellm/start" && req.method === "POST") {
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const userId = payload.userId as string;
      const LiteLLMService = await import("@/services/litellm-service");
      await LiteLLMService.start(userId);
      const { litellmProcessManager } = await import("@/services/litellm-process-manager");
      sendJson(res, 200, litellmProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to start LiteLLM", { error: String(err) });
      sendJson(res, 500, { error: "Failed to start LiteLLM" });
    }
    return true;
  }

  // POST /internal/litellm/stop — stop the LiteLLM proxy process
  if (pathname === "/internal/litellm/stop" && req.method === "POST") {
    try {
      const { litellmProcessManager } = await import("@/services/litellm-process-manager");
      await litellmProcessManager.stop();
      sendJson(res, 200, { success: true });
    } catch (err) {
      internalLog.error("Failed to stop LiteLLM", { error: String(err) });
      sendJson(res, 500, { error: "Failed to stop LiteLLM" });
    }
    return true;
  }

  // POST /internal/litellm/restart — restart the LiteLLM proxy process
  if (pathname === "/internal/litellm/restart" && req.method === "POST") {
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const userId = payload.userId as string;
      const LiteLLMService = await import("@/services/litellm-service");
      await LiteLLMService.restart(userId);
      const { litellmProcessManager } = await import("@/services/litellm-process-manager");
      sendJson(res, 200, litellmProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to restart LiteLLM", { error: String(err) });
      sendJson(res, 500, { error: "Failed to restart LiteLLM" });
    }
    return true;
  }

  // GET /internal/litellm/status — get the LiteLLM proxy status
  if (pathname === "/internal/litellm/status" && req.method === "GET") {
    try {
      const { litellmProcessManager } = await import("@/services/litellm-process-manager");
      sendJson(res, 200, litellmProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to get LiteLLM status", { error: String(err) });
      sendJson(res, 500, { error: "Failed to get LiteLLM status" });
    }
    return true;
  }

  // --- end LiteLLM endpoints ---

  // [oyej] Agent-run scheduler internal control endpoint (sibling of the
  // keystroke scheduler below). Same Bearer AUTH_SECRET gate.
  if (pathname?.startsWith("/internal/agent-scheduler/")) {
    const agentAuth = req.headers.authorization;
    if (agentAuth !== `Bearer ${getAuthSecret()}`) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    const agentBody = req.method === "POST" ? await readRequestBody(req) : "";
    const agentAction = pathname.replace("/internal/agent-scheduler/", "");
    try {
      const parsed = agentBody ? JSON.parse(agentBody) : {};
      switch (agentAction) {
        case "add":
          await agentSchedulerOrchestrator.addJob(parsed.scheduleId);
          sendJson(res, 200, { success: true });
          break;
        case "update":
          await agentSchedulerOrchestrator.updateJob(parsed.scheduleId);
          sendJson(res, 200, { success: true });
          break;
        case "remove":
          agentSchedulerOrchestrator.removeJob(parsed.scheduleId);
          sendJson(res, 200, { success: true });
          break;
        case "status":
          sendJson(res, 200, {
            running: agentSchedulerOrchestrator.isStarted(),
            jobCount: agentSchedulerOrchestrator.getJobCount(),
          });
          break;
        default:
          sendJson(res, 404, { error: "Unknown action" });
      }
    } catch (error) {
      internalLog.error("Agent scheduler error", { error: String(error) });
      sendJson(res, 500, { error: "Internal error" });
    }
    return true;
  }

  if (!pathname?.startsWith("/internal/scheduler/")) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${getAuthSecret()}`) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }

  const body = req.method === "POST" ? await readRequestBody(req) : "";
  const action = pathname.replace("/internal/scheduler/", "");

  try {
    const parsed = body ? JSON.parse(body) : {};

    switch (action) {
      case "add":
        await schedulerOrchestrator.addJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "update":
        await schedulerOrchestrator.updateJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "remove":
        schedulerOrchestrator.removeJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "pause":
        schedulerOrchestrator.pauseJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "resume":
        schedulerOrchestrator.resumeJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "remove-session":
        schedulerOrchestrator.removeSessionJobs(parsed.sessionId);
        sendJson(res, 200, { success: true });
        break;
      case "status":
        sendJson(res, 200, {
          running: schedulerOrchestrator.isStarted(),
          jobCount: schedulerOrchestrator.getJobCount(),
          jobs: schedulerOrchestrator.getStatus(),
        });
        break;
      default:
        sendJson(res, 404, { error: "Unknown action" });
    }
  } catch (error) {
    internalLog.error("Scheduler error", { error: String(error) });
    sendJson(res, 500, { error: "Internal error" });
  }
  return true;
}

interface ServerOptions {
  port?: number;
  socket?: string;
}

export function createTerminalServer(options: ServerOptions = { port: 6002 }) {
  // Check tmux is installed at startup
  if (!checkTmuxInstalled()) {
    log.error("tmux is not installed. Please install with: brew install tmux");
    log.error("Terminal persistence will not work without tmux.");
    // Continue anyway for development, but log the warning
  } else {
    log.info("tmux detected - session persistence enabled");
  }

  // Create HTTP server to handle both WebSocket upgrades and internal API
  const server = createServer(async (req, res) => {
    // Try to handle as internal API request
    const handled = await handleInternalApi(req, res);
    if (!handled) {
      // Not an API request - return 404 for regular HTTP
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("WebSocket endpoint only");
    }
  });

  // WebSocket upgrades only on the prefixed path (`WS_PATH_PREFIX`, e.g.
  // `/alpha/ws` when RDV_BASE_PATH=/alpha, or `/ws` when unset). `noServer`
  // mode lets us gate the upgrade manually before the WebSocket handshake
  // completes — any other path returns a plain HTTP 404.
  //
  // The match is strict-boundary: a path equal to WS_PATH_PREFIX, or starting
  // with WS_PATH_PREFIX + "/". A naive `startsWith` would also match
  // `/alpha/ws-evil`, which we explicitly reject.
  const wss = new WebSocketServer({ noServer: true });

  // Second `noServer` WebSocketServer for the in-pod PORT PROXY (HMR/live-reload,
  // B3). Upgrades for `<basePath>/proxy/<port>/…` (forwarded UNCHANGED by the
  // k3s router) are handshaked here and bridged to `ws://127.0.0.1:<port>` — they
  // are deliberately kept OUT of the terminal-session `wss` (a different auth +
  // payload contract). See `src/server/proxy-ws-bridge.ts`.
  const proxyWss = new WebSocketServer({ noServer: true });
  proxyWss.on("connection", (ws, req) => {
    handleProxyWsUpgrade(ws, req);
  });

  server.on("upgrade", (req, socket, head) => {
    const pathOnly = (req.url || "").split("?", 1)[0] ?? "";

    // Port-proxy WS first: `<basePath>/proxy/<port>/…` → bridge to loopback.
    // Checked before the terminal `/ws` allow-gate so these never fall into the
    // terminal-session handler (and are not rejected by the 404 below).
    if (PROXY_WS_PATH_PATTERN.test(pathOnly)) {
      proxyWss.handleUpgrade(req, socket, head, (ws) => {
        proxyWss.emit("connection", ws, req);
      });
      return;
    }

    const allowed =
      pathOnly === WS_PATH_PREFIX || pathOnly.startsWith(WS_PATH_PREFIX + "/");
    if (!allowed) {
      log.debug("Rejected WebSocket upgrade", { path: pathOnly, expected: WS_PATH_PREFIX });
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // Listen on socket or port
  if (options.socket) {
    server.listen(options.socket, () => {
      log.info("Terminal server running", { transport: "unix", socket: options.socket, websocket: `unix:${options.socket}`, internalApi: `unix:${options.socket}/internal/scheduler/*` });
    });
  } else {
    const port = options.port || 6002;
    server.listen(port, () => {
      log.info("Terminal server running", { transport: "http", port, websocket: `ws://localhost:${port}`, internalApi: `http://localhost:${port}/internal/scheduler/*` });
    });
  }

  // [x386.2/.3] Install the durable-delivery hooks into the MCP push manager
  // once at boot. mcp-push.ts holds no service import (layering boundary); the
  // terminal server is the only place that knows both the socket layer and the
  // delivery service, so it wires them together here.
  getMcpPush()
    .then(async (mp) => {
      const MD = await import("@/services/message-delivery-service");
      // Socket-write success → delivery marked `delivered`.
      mp.setDeliveredHook((sid, mid) => {
        MD.markDelivered(mid, sid, "mcp_push").catch((err) =>
          peerLog.debug("markDelivered hook failed", { sessionId: sid, error: String(err) }),
        );
      });
      // MCP server (re)connect → replay everything still undelivered for it.
      mp.setReplayHook(async (sid) => {
        const rows = await MD.getUndelivered(sid, 50);
        for (const r of rows) {
          mp.pushToMcpServer(sid, {
            type: r.channelId ? "channel_message" : r.toSessionId ? "peer_message" : "channel_message",
            messageId: r.id,
            fromSessionId: null,
            fromSessionName: r.fromSessionName,
            toSessionId: r.toSessionId,
            body: r.body,
            channelId: r.channelId,
            channelName: null,
            parentMessageId: r.parentMessageId,
            createdAt: new Date(r.createdAt).toISOString(),
          });
        }
      });
      // [x386.15] Proactive idle-reconnect replay: the tick asks which sessions
      // have undelivered backlog and reconnects each whose MCP socket reappeared,
      // firing the replay hook above — so replay no longer waits on a coincident
      // push. The provider returns [] cheaply when nothing is pending.
      mp.setPendingSessionsProvider(() => MD.getSessionsWithPending(200));
      mp.startMcpReconcile();
    })
    .catch((err) => peerLog.error("Failed to install MCP delivery hooks", { error: String(err) }));

  // [x386.9] Prune the awareness-chat backlog once at boot (TTL), then hourly.
  // Old messages with no unacked delivery are removed; bd remains the durable
  // work tracker, chat is ephemeral awareness.
  import("@/services/peer-service")
    .then((PeerService) => PeerService.cleanupOldMessages())
    .catch((err) => peerLog.error("Startup peer cleanup failed", { error: String(err) }));

  // Periodic peer message cleanup (hourly TTL).
  setInterval(() => {
    import("@/services/peer-service")
      .then((PeerService) => PeerService.cleanupOldMessages())
      .catch((err) => peerLog.error("Periodic peer cleanup failed", { error: String(err) }));
  }, 60 * 60 * 1000);

  // [y5ch.9] PID-liveness reconciliation sweep (30s). Clears stale
  // running/waiting sessions whose agent process died and emits exactly one
  // agent_stuck notification each. Lives here because the terminal server owns
  // tmux; in multi-instance/supervisor mode each instance sweeps its own.
  setInterval(() => {
    import("@/services/session-liveness-service")
      .then((svc) => svc.reconcileLiveness())
      .catch((err) => log.error("Liveness sweep failed", { error: String(err) }));
  }, 30_000);

  wss.on("connection", async (ws, req) => {
    const query = Object.fromEntries(new URL(req.url || "", "http://localhost").searchParams);

    // SECURITY: Validate authentication token
    const token = query.token as string | undefined;
    if (!token) {
      ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
      ws.close(4001, "Authentication required");
      return;
    }

    const authResult = validateWsToken(token);
    if (!authResult) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }));
      ws.close(4002, "Invalid or expired token");
      return;
    }

    // [remote-dev-d5ci] Control-mode connection: `?control=1` with a token minted
    // for the CONTROL_SESSION_SENTINEL. It joins the `connections` map ONLY so
    // broadcasts (agent_activity_status / session_metadata) reach it, enabling
    // live sidebar updates without an attached terminal. It never attaches a PTY,
    // never joins sessionConnections / sessionPrimaryConnection, and on disconnect
    // triggers no per-session side effects (see cleanupConnection's isControl
    // early-return). Reuses the exact same HMAC token auth as terminal sockets.
    if (query.control === "1") {
      if (authResult.sessionId !== CONTROL_SESSION_SENTINEL) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid control token" }));
        ws.close(4002, "Invalid control token");
        return;
      }
      const controlConnectionId = randomUUID();
      const controlConnection: TerminalConnection = {
        connectionId: controlConnectionId,
        pty: null,
        ws,
        sessionId: `${CONTROL_SESSION_SENTINEL}-${controlConnectionId}`,
        tmuxSessionName: "",
        isAttached: false,
        lastCols: 0,
        lastRows: 0,
        pendingResize: null,
        resizeTimeout: null,
        terminalType: "control",
        userId: authResult.userId,
        lastFocusAt: Date.now(),
        isVisible: false,
        isControl: true,
      };
      connections.set(controlConnectionId, controlConnection);
      log.debug("Control connection started", { connectionId: controlConnectionId, userId: authResult.userId });

      ws.on("close", () => {
        if (!connections.has(controlConnectionId)) return;
        cleanupConnection(controlConnectionId);
      });
      ws.on("error", (error) => {
        log.warn("Control connection error", { connectionId: controlConnectionId, error: String(error) });
        if (!connections.has(controlConnectionId)) return;
        cleanupConnection(controlConnectionId);
      });

      ws.send(JSON.stringify({ type: "control_ready" }));
      return;
    }

    // Parse connection parameters
    const sessionId = authResult.sessionId;
    const userId = authResult.userId;
    const tmuxSessionName = (query.tmuxSession as string) || `rdv-${sessionId}`;
    const cols = parseInt(query.cols as string) || 80;
    const rows = parseInt(query.rows as string) || 24;
    const rawCwd = query.cwd as string | undefined;
    // tmux history-limit (scrollback buffer) - default 50000 lines
    const tmuxHistoryLimit = parseInt(query.tmuxHistoryLimit as string) || 50000;
    // Terminal type for agent exit detection
    const terminalType = (query.terminalType as string) || "shell";

    // SECURITY: Validate tmux session name to prevent command injection
    if (!validateSessionName(tmuxSessionName)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid session name" }));
      ws.close(4003, "Invalid session name");
      return;
    }

    // SECURITY [remote-dev-yk42]: Ownership check on the ?tmuxSession override.
    // The token is HMAC-bound to { sessionId, userId }, but `tmuxSessionName`
    // comes from an attacker-controllable query param that has so far only been
    // FORMAT-validated. Re-bind it to the token's USER at connect: look up the
    // session row that owns the requested tmux name and require it to belong to
    // the token's user. Without this, any authenticated user could attach to
    // ANOTHER user's tmux session (matters for multi-instance / multi-user;
    // single-user is unaffected in practice). Runs BEFORE any tmux create/attach
    // so we never touch a tmux session the caller does not own.
    //
    // A MISSING row is the session-CREATION path (this connect creates the tmux
    // session + its DB row), so it is ALLOWED — there is nothing to hijack and
    // the derived name is `rdv-${token.sessionId}`. A DB-error fails CLOSED
    // below (we reject rather than attach when ownership can't be verified).
    {
      let owningRow: { id: string; userId: string } | null = null;
      try {
        const { db } = await import("@/db");
        const { terminalSessions } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        owningRow =
          (await db.query.terminalSessions.findFirst({
            where: eq(terminalSessions.tmuxSessionName, tmuxSessionName),
            columns: { id: true, userId: true },
          })) ?? null;
      } catch (error) {
        // Fail CLOSED: if we cannot verify ownership, do not attach.
        log.error("tmuxSession ownership lookup failed", {
          tmuxSessionName,
          sessionId,
          error: String(error),
        });
        ws.send(JSON.stringify({ type: "error", message: "Authorization check failed" }));
        ws.close(4002, "Authorization check failed");
        return;
      }

      if (!isTmuxSessionAuthorized(owningRow, { sessionId, userId })) {
        // Reachable only when a row EXISTS and belongs to a DIFFERENT user
        // (the remote-dev-yk42 cross-user attach); creation (null) + same-user
        // attach are authorized above.
        log.warn("Rejected WS connect: tmuxSession owned by a different user", {
          tmuxSessionName,
          tokenSessionId: sessionId,
          tokenUserId: userId,
          ownerUserId: owningRow?.userId ?? null,
          ownerSessionId: owningRow?.id ?? null,
        });
        ws.send(JSON.stringify({ type: "error", message: "Not authorized for this session" }));
        ws.close(4002, "Not authorized for this session");
        return;
      }
    }

    // SECURITY: Validate cwd to prevent path traversal
    const cwd = validatePath(rawCwd);

    // Generate a unique connection ID for multi-client support
    const connectionId = randomUUID();

    // Check if tmux session exists (for attach vs create decision)
    const tmuxExists = tmuxSessionExists(tmuxSessionName);

    log.debug("Connection request", { connectionId, sessionId, tmuxSessionName, tmuxExists });

    let ptyProcess: IPty;

    try {
      if (tmuxExists) {
        // Attach to existing tmux session
        log.debug("Attaching to existing tmux session", { tmuxSessionName });
        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_attached",
          sessionId,
          tmuxSessionName,
        }));
      } else {
        // Create new tmux session
        log.debug("Creating new tmux session", { tmuxSessionName, historyLimit: tmuxHistoryLimit });
        createTmuxSession(tmuxSessionName, cols, rows, cwd, tmuxHistoryLimit);

        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_created",
          sessionId,
          tmuxSessionName,
        }));

        // [hgwo] We took the CREATE branch for an agent session, which means
        // the tmux session was gone — the terminal server (or the whole pod)
        // restarted out from under a persistent agent. The fresh tmux is a bare
        // shell, so relaunch the agent RESUMED (durable binding + native id /
        // disk discovery) instead of leaving an empty prompt. WS-disconnect
        // alone does NOT reach here (tmux + agent survive → the attach branch).
        if (isAgentTerminalType(terminalType)) {
          void import("@/server/agent-relaunch")
            .then(({ relaunchAgentInTmux }) => relaunchAgentInTmux(sessionId, tmuxSessionName))
            .catch((e) =>
              agentLog.error("Relaunch failed on cold-attach", {
                sessionId, error: String(e),
              }),
            );
        }
      }
    } catch (error) {
      log.error("Failed to create/attach tmux session", { connectionId, sessionId, error: String(error) });
      ws.send(JSON.stringify({
        type: "error",
        message: `Failed to create terminal session: ${(error as Error).message}`,
      }));
      ws.close();
      return;
    }

    const connection: TerminalConnection = {
      connectionId,
      pty: ptyProcess,
      ws,
      sessionId,
      tmuxSessionName,
      isAttached: true,
      lastCols: cols,
      lastRows: rows,
      pendingResize: null,
      resizeTimeout: null,
      terminalType,
      userId,
      lastFocusAt: Date.now(),
      isVisible: true,
    };

    // Register connection in both maps
    connections.set(connectionId, connection);
    if (!sessionConnections.has(sessionId)) {
      sessionConnections.set(sessionId, new Set());
    }
    sessionConnections.get(sessionId)!.add(connectionId);
    // Seed initial primary only if no connection currently holds it for this
    // session. This prevents a reconnect within the cooldown window from
    // stealing primary away from an active connection. Subsequent focus signals
    // (subject to the promotion cooldown) can re-promote later.
    if (!sessionPrimaryConnection.has(sessionId)) {
      sessionPrimaryConnection.set(sessionId, connectionId);
      sessionLastPromotionAt.set(sessionId, Date.now());
    }

    log.debug("Terminal connection started", { connectionId, sessionId, cols, rows, tmuxSessionName });

    // Note: Environment variables are now injected at session creation time
    // (in TmuxService.createSession) BEFORE the startup command runs.
    // The WebSocket environmentVars parameter is kept for potential future use
    // but is no longer used for injection here.

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.debug("PTY exited", { connectionId, sessionId, exitCode, terminalType });

      if (!connections.has(connectionId)) {
        log.debug("Stale PTY exit ignored", { connectionId, sessionId });
        return;
      }

      // Each connection has its own PTY (tmux attach-session process).
      // When the tmux session dies, ALL connections' PTYs exit independently.
      // Only notify THIS connection's WebSocket to avoid duplicate messages.
      if (ws.readyState === WebSocket.OPEN) {
        if (isAgentTerminalType(terminalType)) {
          agentLog.info("Agent PTY exited", { connectionId, sessionId, exitCode });
          ws.send(JSON.stringify(agentExitedEvent(sessionId, exitCode)));
        } else {
          ws.send(JSON.stringify({ type: "exit", code: exitCode }));
          ws.close();
        }
      }
      cleanupConnection(connectionId);
    });

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            connection.pty?.write(msg.data);
            break;
          case "resize": {
            // Ignore resize events with invalid dimensions
            // This prevents tmux from shrinking when tabs are hidden
            const MIN_COLS = 10;
            const MIN_ROWS = 3;
            const nextCols = Number(msg.cols);
            const nextRows = Number(msg.rows);
            if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
              break;
            }
            if (nextCols < MIN_COLS || nextRows < MIN_ROWS) {
              break;
            }

            connection.pendingResize = { cols: nextCols, rows: nextRows };
            if (connection.resizeTimeout) {
              break;
            }

            connection.resizeTimeout = setTimeout(() => {
              const pending = connection.pendingResize;
              connection.pendingResize = null;
              connection.resizeTimeout = null;

              if (!pending) return;
              if (pending.cols === connection.lastCols && pending.rows === connection.lastRows) {
                return;
              }

              connection.lastCols = pending.cols;
              connection.lastRows = pending.rows;

              // Always resize this connection's PTY
              try {
                connection.pty?.resize(pending.cols, pending.rows);
              } catch {
                // Ignore resize errors from pty
              }

              // Only resize the tmux window if this is the primary connection
              if (sessionPrimaryConnection.get(sessionId) === connectionId) {
                runTmuxResize(tmuxSessionName, pending.cols, pending.rows);
              }
            }, 50);
            break;
          }
          case "client_focus": {
            connection.lastFocusAt = Date.now();
            connection.isVisible = true;
            const force = msg.force === true;
            log.debug("client_focus received", { connectionId, sessionId, force });
            tryPromoteToPrimary(sessionId, connectionId, force);
            break;
          }
          case "client_blur": {
            connection.isVisible = false;
            // Bookkeeping only — do not change primary on blur.
            break;
          }
          case "detach":
            log.debug("Detaching from tmux session", { connectionId, sessionId, tmuxSessionName });
            cleanupConnection(connectionId);
            ws.close();
            break;

          case "restart_agent": {
            if (!isAgentTerminalType(terminalType)) {
              ws.send(JSON.stringify({
                type: "error",
                message: "restart_agent is only valid for agent sessions",
              }));
              break;
            }

            agentLog.info("Restarting agent session", { connectionId, sessionId });
            // Collect other connections BEFORE the try block so the error
            // handler can clean up orphaned sessionConnections entries.
            const otherConns = getConnectionsForSession(sessionId).filter(
              (c) => c.connectionId !== connectionId
            );
            try {
              // Destroy PTYs for ALL connections to this session before
              // killing the tmux session, so their onExit handlers see the
              // connection already removed and skip the stale-exit path.
              for (const other of otherConns) {
                safeDestroyPty(other.pty);
                connections.delete(other.connectionId);
              }
              safeDestroyPty(connection.pty);

              // Use synchronous kill so the session is fully gone before we
              // recreate it — avoids a race between async kill and sync create.
              try {
                execFileSync("tmux", ["kill-session", "-t", tmuxSessionName], { stdio: "pipe" });
              } catch { /* session may already be dead */ }
              createTmuxSession(tmuxSessionName, connection.lastCols, connection.lastRows, cwd, tmuxHistoryLimit);

              const newPty = attachToTmuxSession(tmuxSessionName, connection.lastCols, connection.lastRows);
              connection.pty = newPty;

              // Reconnect other connections to the new tmux session
              for (const other of otherConns) {
                try {
                  const otherPty = attachToTmuxSession(tmuxSessionName, other.lastCols, other.lastRows);
                  other.pty = otherPty;
                  connections.set(other.connectionId, other);
                  otherPty.onData((data) => {
                    if (other.ws.readyState === WebSocket.OPEN) {
                      other.ws.send(JSON.stringify({ type: "output", data }));
                    }
                  });
                  otherPty.onExit(({ exitCode: otherExitCode }) => {
                    if (!connections.has(other.connectionId)) return;
                    if (other.ws.readyState === WebSocket.OPEN) {
                      other.ws.send(JSON.stringify(agentExitedEvent(sessionId, otherExitCode)));
                    }
                    cleanupConnection(other.connectionId);
                  });
                } catch (reattachErr) {
                  agentLog.warn("Failed to reattach other connection after restart", {
                    connectionId: other.connectionId,
                    error: String(reattachErr),
                  });
                  // Clean up the failed connection
                  const connSet = sessionConnections.get(sessionId);
                  if (connSet) connSet.delete(other.connectionId);
                  if (other.ws.readyState === WebSocket.OPEN) {
                    other.ws.send(JSON.stringify({
                      type: "error",
                      message: "Lost connection during agent restart",
                    }));
                    other.ws.close();
                  }
                }
              }

              newPty.onData((data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "output", data }));
                }
              });

              newPty.onExit(({ exitCode: newExitCode }) => {
                agentLog.info("Restarted agent session exited", { connectionId, sessionId, exitCode: newExitCode });
                if (!connections.has(connectionId)) {
                  log.debug("Stale restarted PTY exit ignored", { connectionId, sessionId });
                  return;
                }
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(agentExitedEvent(sessionId, newExitCode)));
                }
                cleanupConnection(connectionId);
              });

              // [hgwo] The recreated tmux is a BARE shell — relaunch the agent
              // (resumed if possible) so its conversation comes back instead of
              // an empty prompt. Non-blocking; the PTY handlers above already
              // stream the relaunched output. Broadcast resumed-vs-fresh once
              // the relaunch resolves so the UI (hgwo.7) can badge it.
              void import("@/server/agent-relaunch")
                .then(({ relaunchAgentInTmux }) => relaunchAgentInTmux(sessionId, tmuxSessionName))
                .then(({ resumed }) => {
                  broadcastToSession(sessionId, {
                    type: "agent_restarted",
                    sessionId,
                    tmuxSessionName,
                    resumed,
                  });
                })
                .catch((e) => {
                  agentLog.error("Relaunch failed after restart_agent", {
                    sessionId, error: String(e),
                  });
                  broadcastToSession(sessionId, {
                    type: "agent_restarted",
                    sessionId,
                    tmuxSessionName,
                    resumed: false,
                  });
                });
            } catch (error) {
              agentLog.error("Failed to restart agent session", { connectionId, sessionId, error: String(error) });
              // Other connections were removed from `connections` but may still
              // be in `sessionConnections`. Clean up the orphaned entries so
              // session-level state is properly released.
              const connSet = sessionConnections.get(sessionId);
              if (connSet) {
                for (const other of otherConns) {
                  connSet.delete(other.connectionId);
                  if (other.ws.readyState === WebSocket.OPEN) {
                    other.ws.send(JSON.stringify({
                      type: "error",
                      message: "Lost connection during agent restart",
                    }));
                    other.ws.close();
                  }
                }
              }
              cleanupConnection(connectionId);
              ws.send(JSON.stringify({
                type: "error",
                message: `Failed to restart agent: ${(error as Error).message}`,
              }));
            }
            break;
          }
        }
      } catch {
        // JSON parse error — forward raw text to PTY
        if (connections.has(connectionId)) {
          connection.pty?.write(message.toString());
        }
      }
    });

    ws.on("close", () => {
      log.debug("WebSocket closed", { connectionId, sessionId });
      if (!connections.has(connectionId)) return;
      cleanupConnection(connectionId);
    });

    ws.on("error", (error) => {
      log.error("Terminal connection error", { connectionId, sessionId, error: String(error) });
      if (!connections.has(connectionId)) return;
      cleanupConnection(connectionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId, tmuxSessionName }));
    // [remote-dev-f9y9] Replay current in-memory status indicators + progress to
    // the (re)connecting client. WS pushes are one-shot; a tab that was hidden or
    // whose socket silently dropped misses them and they have no DB fallback.
    // (agentActivityStatus is recovered separately via the client's reconnect
    // refresh from the DB.)
    const replayIndicators = sessionStatusIndicators.get(sessionId);
    if (replayIndicators) {
      for (const [key, indicator] of replayIndicators) {
        ws.send(JSON.stringify({ type: "session_status_update", sessionId, key, indicator }));
      }
    }
    const replayProgress = sessionProgressBars.get(sessionId);
    if (replayProgress) {
      ws.send(JSON.stringify({
        type: "session_progress_update",
        sessionId,
        value: replayProgress.value,
        label: replayProgress.label,
      }));
    }
    // Inform every session client of the new primary set (this connection became
    // primary on connect; previously-primary clients will flip to secondary).
    broadcastPrimaryChanged(sessionId);
  });

  return wss;
}

// Graceful shutdown of terminal connections: destroy PTY wrappers but preserve
// tmux sessions for reconnection. Synchronous and fast.
//
// IMPORTANT: this MUST NOT call process.exit() and MUST NOT register its own
// signal handlers. The terminal server's single shutdown authority is
// `shutdown()` in src/server/index.ts (the sole entry point that imports this
// module); it calls this function as part of its bounded teardown, then
// releases the instance lock and exits. If this function exited the process
// or trapped SIGTERM itself, it would run before index.ts's shutdown and skip
// the lock release + bounded cleanup. See remote-dev-i85i.
export function shutdownTerminalConnections(): void {
  log.info("Shutting down terminal server (tmux sessions preserved)...");
  // [x386.15] Stop the proactive MCP reconcile tick (best-effort; it's unref'd,
  // but stop it cleanly so no pass fires mid-teardown). Uses the cached module
  // ref if mcp-push was already loaded; otherwise nothing was ever started.
  if (_mcpPush) _mcpPush.stopMcpReconcile();
  for (const [id, conn] of connections) {
    safeDestroyPty(conn.pty);
    conn.ws.close();
    log.debug("Closed PTY wrapper", { connectionId: id, sessionId: conn.sessionId });
  }
  connections.clear();
  sessionConnections.clear();
  sessionPrimaryConnection.clear();
  sessionLastPromotionAt.clear();
  // [remote-dev-f9y9] cleanupConnection now only drops these when tmux is gone
  // (so they survive a transient WS disconnect for the attach-time replay), so
  // full teardown must clear them explicitly.
  sessionStatusIndicators.clear();
  sessionProgressBars.clear();
}
