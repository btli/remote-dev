/**
 * WorkContextService — the awareness layer beads does NOT hold.
 *
 * [x386.11] Per-session branch/worktree/folder/status/last-activity, plus a
 * READ-ONLY view of the bd issue the agent has claimed. No task data is
 * duplicated — bd is queried live via `beadsQuery`; we only mirror the claimed
 * issue id/title for display and NEVER write back to bd.
 *
 * **The session → bd-issue join is intentionally loose** (there is no hard FK):
 *   - a session's working dir is `terminalSessions.projectPath` (the worktree),
 *     and bd is keyed by that path's `.beads/` Dolt DB;
 *   - bd's `assignee`/`actor` is freetext (not a session UUID), so we join on
 *     the **issue id embedded in the branch name** (e.g. `feat/x386-...` /
 *     `feat/x386.11-...`) and fall back to "most recent in-progress issue in
 *     this project" when the branch encodes no id.
 * The result carries `joinConfidence: "branch" | "project" | "none"` so the UI
 * and digest never over-trust a project-level guess.
 *
 * [x386.14] Also detects collisions — another active session sharing this
 * session's branch, worktree path, or claimed bd issue — the most common cause
 * of stepped-on work.
 */

import { db } from "@/db";
import { terminalSessions, agentWorkContext, agentPeerMessages } from "@/db/schema";
import { eq, and, like, desc, inArray } from "drizzle-orm";
import { beadsQuery, isBeadsAvailable } from "@/lib/beads-db";
import type { RowDataPacket } from "mysql2/promise";
import { createLogger } from "@/lib/logger";

const log = createLogger("WorkContext");

// Matches an issue id like "x386", "x386.11", "remote-dev-x386", "abc-1f2" in a
// branch name. We strip a leading prefix segment (feat/, fix/, chore/, …) and
// take the first token that looks like an id.
const ISSUE_ID_IN_BRANCH = /([a-z0-9]+(?:-[a-z0-9]+)+(?:\.[0-9]+)?|[a-z0-9]+\.[0-9]+)/i;

interface ClaimRow extends RowDataPacket {
  id: string;
  title: string;
  assignee: string | null;
  status: string;
}

export type JoinConfidence = "branch" | "project" | "none";

export interface WorkContext {
  sessionId: string;
  projectId: string;
  branch: string | null;
  worktreePath: string | null;
  activityStatus: string | null;
  claimedIssueId: string | null;
  claimedIssueTitle: string | null;
  joinConfidence: JoinConfidence;
}

export interface Collision {
  peerSessionId: string;
  peerName: string;
  reason: "branch" | "worktree" | "issue";
  value: string;
}

/** Extract a bd issue id embedded in a branch name, if any. */
export function extractIssueIdFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  // Drop a conventional leading "type/" segment so "feat/x386.11-foo" → "x386.11-foo".
  const tail = branch.includes("/") ? branch.slice(branch.indexOf("/") + 1) : branch;
  const m = tail.match(ISSUE_ID_IN_BRANCH);
  return m ? m[1] : null;
}

/**
 * Compute (and cache) the work-context for a session, including the READ-ONLY
 * bd-issue join. Persists a snapshot to `agent_work_context` so the chat UI and
 * digest can read it without a live git/bd call. Returns null if the session
 * has no project.
 */
export async function computeWorkContext(sessionId: string): Promise<WorkContext | null> {
  const s = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: {
      projectId: true,
      worktreeBranch: true,
      projectPath: true,
      agentActivityStatus: true,
    },
  });
  if (!s?.projectId) return null;

  let claimedIssueId: string | null = null;
  let claimedIssueTitle: string | null = null;
  let joinConfidence: JoinConfidence = "none";

  const path = s.projectPath ?? null;
  // bd Dolt schema can drift across bd versions (see beads_dolt_schema_coupling);
  // wrap every bd query so a column rename degrades to joinConfidence:"none"
  // instead of throwing.
  if (path) {
    try {
      if (await isBeadsAvailable(path)) {
        const branchIssue = extractIssueIdFromBranch(s.worktreeBranch);
        if (branchIssue) {
          const rows = await beadsQuery<ClaimRow>(
            path,
            "SELECT id, title, assignee, status FROM issues WHERE id = ? AND status = 'in_progress' LIMIT 1",
            [branchIssue],
          );
          if (rows[0]) {
            claimedIssueId = rows[0].id;
            claimedIssueTitle = rows[0].title;
            joinConfidence = "branch";
          }
        }
        if (!claimedIssueId) {
          // Fallback: any single in-progress issue in this project (loose).
          const rows = await beadsQuery<ClaimRow>(
            path,
            "SELECT id, title, assignee, status FROM issues WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 1",
            [],
          );
          if (rows[0]) {
            claimedIssueId = rows[0].id;
            claimedIssueTitle = rows[0].title;
            joinConfidence = "project";
          }
        }
      }
    } catch (err) {
      log.debug("bd join failed; degrading to joinConfidence:none", {
        sessionId,
        error: String(err),
      });
      claimedIssueId = null;
      claimedIssueTitle = null;
      joinConfidence = "none";
    }
  }

  const ctx: WorkContext = {
    sessionId,
    projectId: s.projectId,
    branch: s.worktreeBranch ?? null,
    worktreePath: path,
    activityStatus: s.agentActivityStatus ?? null,
    claimedIssueId,
    claimedIssueTitle,
    joinConfidence,
  };

  await db
    .insert(agentWorkContext)
    .values({
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
      branch: ctx.branch,
      worktreePath: ctx.worktreePath,
      activityStatus: ctx.activityStatus,
      claimedIssueId: ctx.claimedIssueId,
      claimedIssueTitle: ctx.claimedIssueTitle,
      joinConfidence: ctx.joinConfidence,
    })
    .onConflictDoUpdate({
      target: agentWorkContext.sessionId,
      set: {
        projectId: ctx.projectId,
        branch: ctx.branch,
        worktreePath: ctx.worktreePath,
        activityStatus: ctx.activityStatus,
        claimedIssueId: ctx.claimedIssueId,
        claimedIssueTitle: ctx.claimedIssueTitle,
        joinConfidence: ctx.joinConfidence,
        updatedAt: new Date(),
      },
    });

  return ctx;
}

/** All cached work-contexts for a project (used by digest + collision). */
export async function getProjectWorkContexts(projectId: string): Promise<WorkContext[]> {
  const rows = await db.query.agentWorkContext.findMany({
    where: eq(agentWorkContext.projectId, projectId),
  });
  return rows.map((r) => ({
    sessionId: r.sessionId,
    projectId: r.projectId,
    branch: r.branch,
    worktreePath: r.worktreePath,
    activityStatus: r.activityStatus,
    claimedIssueId: r.claimedIssueId,
    claimedIssueTitle: r.claimedIssueTitle,
    joinConfidence: (r.joinConfidence ?? "none") as JoinConfidence,
  }));
}

/**
 * [x386.14] Cached work-contexts for a project, restricted to sessions that are
 * still **active or suspended**. `closeSession` flips `terminal_session.status`
 * to `closed` but does NOT delete the row (so the work-context snapshot
 * lingers); collision detection must ignore those stale snapshots, otherwise an
 * agent resuming work on a branch/worktree/issue that a now-closed session used
 * would see a phantom "⚠ COLLISION" in every start digest. Inner-joins
 * `agent_work_context` against `terminal_session.status IN ('active','suspended')`
 * — the same liveness filter `getProjectPeers` applies.
 */
export async function getActiveProjectWorkContexts(projectId: string): Promise<WorkContext[]> {
  const rows = await db
    .select({
      sessionId: agentWorkContext.sessionId,
      projectId: agentWorkContext.projectId,
      branch: agentWorkContext.branch,
      worktreePath: agentWorkContext.worktreePath,
      activityStatus: agentWorkContext.activityStatus,
      claimedIssueId: agentWorkContext.claimedIssueId,
      claimedIssueTitle: agentWorkContext.claimedIssueTitle,
      joinConfidence: agentWorkContext.joinConfidence,
    })
    .from(agentWorkContext)
    .innerJoin(terminalSessions, eq(agentWorkContext.sessionId, terminalSessions.id))
    .where(
      and(
        eq(agentWorkContext.projectId, projectId),
        inArray(terminalSessions.status, ["active", "suspended"]),
      ),
    );
  return rows.map((r) => ({
    sessionId: r.sessionId,
    projectId: r.projectId,
    branch: r.branch,
    worktreePath: r.worktreePath,
    activityStatus: r.activityStatus,
    claimedIssueId: r.claimedIssueId,
    claimedIssueTitle: r.claimedIssueTitle,
    joinConfidence: (r.joinConfidence ?? "none") as JoinConfidence,
  }));
}

/**
 * [x386.14] Detect collisions for a session: another active session in the same
 * project sharing its branch, worktree path, or claimed bd issue. Reads the
 * cached contexts, so callers that need fresh data should
 * {@link computeWorkContext} first.
 */
export async function detectCollisions(sessionId: string): Promise<Collision[]> {
  const me = await db.query.agentWorkContext.findFirst({
    where: eq(agentWorkContext.sessionId, sessionId),
  });
  if (!me) return [];
  // Only collide against sessions that are still active/suspended — a closed
  // session's lingering work-context snapshot must not raise a phantom warning.
  const peers = await getActiveProjectWorkContexts(me.projectId);
  const out: Collision[] = [];
  for (const p of peers) {
    if (p.sessionId === sessionId) continue;
    if (me.branch && p.branch === me.branch) {
      out.push({ peerSessionId: p.sessionId, peerName: "", reason: "branch", value: me.branch });
    } else if (me.worktreePath && p.worktreePath === me.worktreePath) {
      out.push({ peerSessionId: p.sessionId, peerName: "", reason: "worktree", value: me.worktreePath });
    } else if (me.claimedIssueId && p.claimedIssueId === me.claimedIssueId) {
      out.push({ peerSessionId: p.sessionId, peerName: "", reason: "issue", value: me.claimedIssueId });
    }
  }
  // Backfill peer names from terminalSessions in one query.
  if (out.length > 0) {
    const ids = [...new Set(out.map((c) => c.peerSessionId))];
    const sessions = await db.query.terminalSessions.findMany({
      where: inArray(terminalSessions.id, ids),
      columns: { id: true, name: true },
    });
    const nameById = new Map(sessions.map((s) => [s.id, s.name]));
    for (const c of out) c.peerName = nameById.get(c.peerSessionId) ?? "peer";
  }
  return out;
}

// ── Start digest (x386.12) ───────────────────────────────────────────────────

const GOTCHA_PREFIX_RE = /^\[(gotcha|heads-up|progress)\]/i;

export interface DigestPeer {
  sessionId: string;
  name: string;
  status: string | null;
  branch: string | null;
  claimedIssueId: string | null;
  claimedIssueTitle: string | null;
  summary: string | null;
  joinConfidence: JoinConfidence;
}

export interface DigestGotcha {
  from: string;
  body: string;
  createdAt: string;
}

export interface StartDigest {
  peers: DigestPeer[];
  gotchas: DigestGotcha[];
  collisions: Collision[];
}

/**
 * [x386.12/.14] Build the start digest for a session: who's-working-on-what
 * (work-context + claimed bd issues), recent gotchas/heads-ups posted to
 * #agents (x386.13), and collisions. Recomputes the caller's own context first
 * so collisions use fresh branch data.
 */
export async function buildStartDigest(sessionId: string): Promise<StartDigest> {
  const me = await computeWorkContext(sessionId);
  if (!me) return { peers: [], gotchas: [], collisions: [] };

  const PeerService = await import("@/services/peer-service");
  const [contexts, peerInfos] = await Promise.all([
    getProjectWorkContexts(me.projectId),
    PeerService.getProjectPeers(me.projectId),
  ]);
  const ctxById = new Map(contexts.map((c) => [c.sessionId, c]));

  // Peers = the active project peers (excluding self), enriched with cached
  // work-context where available.
  const peers: DigestPeer[] = peerInfos
    .filter((p) => p.sessionId !== sessionId)
    .map((p) => {
      const ctx = ctxById.get(p.sessionId);
      return {
        sessionId: p.sessionId,
        name: p.name,
        status: p.agentActivityStatus ?? ctx?.activityStatus ?? null,
        branch: ctx?.branch ?? null,
        claimedIssueId: ctx?.claimedIssueId ?? null,
        claimedIssueTitle: ctx?.claimedIssueTitle ?? null,
        summary: p.peerSummary,
        joinConfidence: ctx?.joinConfidence ?? "none",
      };
    });

  const gotchas = await getRecentGotchas(me.projectId, 5);
  const collisions = await detectCollisions(sessionId);

  return { peers, gotchas, collisions };
}

/**
 * Most-recent gotcha/heads-up/progress notes in the project's #agents channel.
 * These are messages whose body carries a `[gotcha]` / `[heads-up]` /
 * `[progress]` prefix (written by `rdv peer note`, x386.13).
 */
export async function getRecentGotchas(projectId: string, limit = 5): Promise<DigestGotcha[]> {
  const ChannelService = await import("@/services/channel-service");
  let agentsChannelId: string;
  try {
    agentsChannelId = await ChannelService.getAgentsChannelId(projectId);
  } catch {
    return [];
  }
  // Filter to bracket-prefixed bodies in SQL so high-volume check-in/check-out
  // chatter in #agents can't push tagged notes out of an over-fetched window.
  // `LIKE '[%'` is a cheap prefix gate; the precise GOTCHA_PREFIX_RE below then
  // rejects any non-note bracket (e.g. "[other]"). Newest-first, capped.
  const rows = await db
    .select({
      fromSessionName: agentPeerMessages.fromSessionName,
      body: agentPeerMessages.body,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(agentPeerMessages)
    .where(and(eq(agentPeerMessages.channelId, agentsChannelId), like(agentPeerMessages.body, "[%")))
    .orderBy(desc(agentPeerMessages.createdAt))
    .limit(limit * 4);
  return rows
    .filter((m) => GOTCHA_PREFIX_RE.test(m.body))
    .slice(0, limit)
    .map((m) => ({
      from: m.fromSessionName,
      body: m.body,
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    }));
}

// Re-export so callers can assert against the namespaced logger if needed.
export { log as _workContextLog };
