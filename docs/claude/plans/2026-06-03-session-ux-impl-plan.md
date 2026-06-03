# Session UX & Observability Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the repo CLAUDE.md, all code edits MUST run in a git worktree subagent — the main agent coordinates only.

**Goal:** Borrow cmux's at-a-glance multi-agent triage — surface live git branch + dirty state + linked PR# + listening ports + last-activity/needs-attention per session in the tree, add a jump-to-next-agent-needing-attention action, an in-app worktree diff/review viewer, and a remote per-session port-proxy so `localhost:PORT` on remote/k3s instances opens in the browser.

**Architecture:** A single server endpoint `GET /api/sessions/:id/metadata` aggregates git (branch/dirty/ahead-behind via `worktree-service`), PR (from the existing `githubPullRequests` cache, falling back to the current live lookup), and per-session listening ports (PID-tree intersected with `getListeningPorts()`). The client keeps the existing `useSessionGitStatus` polling cache but renames it to `useSessionMetadata` and adds a WebSocket `session_metadata` push (debounced) from `src/server/terminal.ts` so rows update live without per-row polling. The needs-attention indicator consumes a new `severity` field on notifications (y5ch.1 cross-dependency) with a local interim derivation from `agentActivityStatus` when y5ch.1 hasn't shipped. The diff viewer is a new App Router route that renders a `git diff` computed server-side. The port-proxy reuses the `apps/supervisor-router` Bun HTTP/WS proxy pattern as a new per-session HTTP-CONNECT-style forward route.

**Tech Stack:** Next.js 16 App Router + React 19, Drizzle ORM + libsql, `xterm.js`, Bun (lint/typecheck/`test:run` via Vitest, env `happy-dom`), `node-pty`/tmux terminal server, `lucide-react` icons, `@/lib/exec` (`execFile`/`execFileNoThrow`) for git/lsof, `@/lib/logger` (`createLogger`) for ALL server logging.

---

## Grounding: what already exists (verified)

| Concern | Existing code | Gap this epic fills |
|---|---|---|
| Branch + ahead/behind + PR chips | `src/components/session/SessionMetadataBar.tsx:21`, `src/hooks/useSessionGitStatus.ts:31`, `src/app/api/sessions/[id]/git-status/route.ts:20` | dirty state, PR from cache, live WS refresh |
| Per-session row render | `src/components/session/project-tree/SessionRow.tsx:277` (renders `<SessionMetadataBar>`) | new chips wired through |
| Listening-port detection | `src/services/port-monitoring-service.ts:44` `getListeningPorts()` returns `Map<port,{process,pid}>` | attribute ports to a session via PID tree |
| Port allocations + active set | `src/contexts/PortContext.tsx:41`, `src/app/api/ports/status/route.ts` | per-session (not per-project) attribution |
| PR cache (rich) | `src/db/schema.ts:532` `githubPullRequests` (reviewDecision, ciStatus, isDraft, branch) | read it in metadata route |
| Agent activity WS flow | `src/server/terminal.ts:655` broadcasts `agent_activity_status`; consumed `src/hooks/useTerminalWebSocket.ts:288` → `SessionManager.tsx:315` → `SessionContext.tsx:221` | add `session_metadata` push |
| Worktree git helpers | `src/services/worktree-service.ts:538` `getCurrentBranch`, `:552` `hasUncommittedChanges` | reuse + add diff/dirty-count |
| Notification model | `src/db/schema.ts:1460` `notificationEvents` (NO severity), `src/types/notification.ts:5` | y5ch.1 adds `severity`; interim fallback |
| Bun reverse proxy + WS bridge | `apps/supervisor-router/src/lib/proxy.ts:1` (`proxyHttp`, hop-by-hop set, WS bridge) | model for per-session port-proxy |
| `lastActivityAt` | `src/db/schema.ts:406`, `src/types/session.ts:60` (present, unused in row) | surface as "needs attention" timestamp |

**Key fact:** a worktree session's worktree path IS its `session.projectPath` (set to the worktree path at create time — `src/services/session-service.ts:438,467`), and `session.worktreeBranch` holds the branch. So git operations run with `cwd: session.projectPath`.

---

## File Structure

**Create:**
- `src/types/session-metadata.ts` — `SessionMetadata`, `SessionGitStatus`, `SessionPrStatus`, `SessionPortInfo` shared types (server + client).
- `src/services/session-metadata-service.ts` — Clean-Arch service: aggregates git + PR-cache + ports for a session.
- `src/app/api/sessions/[id]/metadata/route.ts` — `GET` returns `SessionMetadata` (supersedes git-status route; git-status route kept as thin alias for back-compat).
- `src/app/api/sessions/[id]/diff/route.ts` — `GET` returns `{ files: DiffFileEntry[], raw: string }` from `git diff` in the worktree.
- `src/components/session/diff/SessionDiffViewer.tsx` — client diff viewer (file list + unified hunks).
- `src/components/session/diff/parseUnifiedDiff.ts` — pure parser: raw `git diff` text → `DiffFileEntry[]` (testable, no React).
- `src/app/sessions/[id]/diff/page.tsx` — App Router page hosting `SessionDiffViewer`.
- `src/hooks/useSessionMetadata.ts` — replaces `useSessionGitStatus`; polls `/metadata`, merges WS `session_metadata` pushes.
- `src/hooks/useJumpToAttention.ts` — computes ordered list of attention-needing sessions + `jumpNext()`.
- `src/services/__tests__/session-metadata-service.test.ts` — service tests (node env).
- `src/components/session/diff/__tests__/parseUnifiedDiff.test.ts` — parser tests (node env).
- `src/components/session/__tests__/SessionMetadataBar.test.tsx` — row chip rendering (happy-dom).
- `src/hooks/__tests__/useJumpToAttention.test.ts` — jump ordering (node env).
- `src/app/api/sessions/[id]/proxy/[port]/[[...path]]/route.ts` — per-session localhost:PORT HTTP proxy (n6uc.7).

**Modify:**
- `src/components/session/SessionMetadataBar.tsx` — add dirty-state, per-session ports w/ quick-open, needs-attention dot, PR review/CI status.
- `src/components/session/project-tree/SessionRow.tsx` — accept `metadata` prop, pass attention flag to row ring; add data-attr for jump scroll.
- `src/server/terminal.ts` — add `broadcastSessionMetadata()` + emit `session_metadata` on activity/exit; add `/internal/session-metadata` POST trigger.
- `src/hooks/useTerminalWebSocket.ts` — handle `session_metadata` message → `CustomEvent("rdv:session-metadata")`.
- `src/contexts/SessionContext.tsx` — store `sessionMetadata: Record<string, SessionMetadata>`, `setSessionMetadata`.
- `src/components/session/SessionManager.tsx` — subscribe to `rdv:session-metadata`; wire `useJumpToAttention` keyboard shortcut; pass metadata to rows.
- `src/components/mobile/session/SessionMetadataSheet.tsx` — show branch/dirty/PR/ports (mobile parity, read-only).
- `src/components/mobile/sessions/SessionsTab.tsx` — add mobile "jump to next attention" FAB.
- `src/db/schema.ts` — (only if y5ch.1 not yet merged) add `severity` to `notificationEvents`.
- `src/types/notification.ts` — (interim) add `NotificationSeverity` + `severity` field.

---

## Build Sequence (respects deps)

1. **Phase A — metadata capture & display** (n6uc.1 git/dirty, n6uc.2 PR-cache, n6uc.3 ports): shared types → `session-metadata-service` → `/metadata` route → `useSessionMetadata` hook → row chips → WS push.
2. **Phase B — needs-attention** (n6uc.4): severity field (interim if y5ch.1 pending) → attention derivation in metadata/context → row dot + ring.
3. **Phase C — jump** (n6uc.5, depends .4): `useJumpToAttention` → keyboard shortcut (web) + mobile FAB.
4. **Phase D — diff viewer** (n6uc.6): diff route + parser → viewer component → page → link from row/metadata sheet.
5. **Phase E — port-proxy** (n6uc.7, builds on .3): per-session proxy route reusing supervisor-router pattern → quick-open links route through it on remote instances.
6. **Phase F — tests** (n6uc.8): the test files above are authored inline per-task (TDD); this phase is the final coverage sweep + `bun run test:run`.

---

## Phase A

### Task 1: Shared session-metadata types

**Bead:** remote-dev-n6uc.1 (foundation for .2/.3)

**Files:**
- Create: `src/types/session-metadata.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/types/session-metadata.ts
/** Per-session live observability metadata surfaced in the tree/list. */

export interface SessionGitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  /** Count of porcelain-dirty entries (staged + unstaged + untracked). */
  dirtyCount: number;
}

export interface SessionPrStatus {
  number: number;
  /** "open" | "closed" | "merged" (GitHub `state`, refined by merged flag). */
  state: string;
  url: string;
  isDraft: boolean;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  ciStatus: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | null;
}

export interface SessionPortInfo {
  port: number;
  process: string | null;
  pid: number | null;
}

export interface SessionMetadata {
  sessionId: string;
  git: SessionGitStatus | null;
  pr: SessionPrStatus | null;
  ports: SessionPortInfo[];
  /** ISO timestamp of last agent activity / notification (from session row). */
  lastActivityAt: string | null;
  /** Highest unmet severity for this session: "error" | "actionable" | null. */
  attention: "error" | "actionable" | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no consumers yet; file compiles).

- [ ] **Step 3: Commit**

```bash
git add src/types/session-metadata.ts
git commit -m "feat(session-metadata): shared SessionMetadata types (remote-dev-n6uc.1)"
```

---

### Task 2: session-metadata-service (git + dirty + ahead/behind)

**Bead:** remote-dev-n6uc.1

**Files:**
- Create: `src/services/session-metadata-service.ts`
- Test: `src/services/__tests__/session-metadata-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/__tests__/session-metadata-service.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseGitStatusPorcelain, parseAheadBehind } from "../session-metadata-service";

describe("parseGitStatusPorcelain", () => {
  it("counts staged, unstaged, and untracked entries", () => {
    const out = " M src/a.ts\nA  src/b.ts\n?? src/c.ts\n";
    expect(parseGitStatusPorcelain(out)).toBe(3);
  });
  it("returns 0 for clean tree", () => {
    expect(parseGitStatusPorcelain("")).toBe(0);
  });
});

describe("parseAheadBehind", () => {
  it("parses `git rev-list --left-right --count` output", () => {
    // upstream...HEAD => "behind\tahead"
    expect(parseAheadBehind("2\t5")).toEqual({ behind: 2, ahead: 5 });
  });
  it("defaults to zero on garbage", () => {
    expect(parseAheadBehind("nope")).toEqual({ behind: 0, ahead: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: FAIL — `parseGitStatusPorcelain is not a function` (module not found / no export).

- [ ] **Step 3: Implement the git portion of the service**

```typescript
// src/services/session-metadata-service.ts
import { execFileNoThrow } from "@/lib/exec";
import { createLogger } from "@/lib/logger";
import type { SessionGitStatus } from "@/types/session-metadata";

const log = createLogger("SessionMetadataService");

/** Count porcelain-dirty entries (each non-empty line is one path). */
export function parseGitStatusPorcelain(stdout: string): number {
  return stdout.split("\n").filter((l) => l.trim().length > 0).length;
}

/** Parse `git rev-list --left-right --count @{u}...HEAD` => behind\tahead. */
export function parseAheadBehind(stdout: string): { behind: number; ahead: number } {
  const m = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return { behind: 0, ahead: 0 };
  return { behind: parseInt(m[1], 10) || 0, ahead: parseInt(m[2], 10) || 0 };
}

/** Compute branch + ahead/behind + dirty count for a worktree path. */
export async function getGitStatus(cwd: string): Promise<SessionGitStatus | null> {
  const branchRes = await execFileNoThrow("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchRes.exitCode !== 0) return null; // not a git repo
  const branch = branchRes.stdout.trim() || null;

  const [abRes, statusRes] = await Promise.all([
    execFileNoThrow("git", ["-C", cwd, "rev-list", "--left-right", "--count", "@{u}...HEAD"]),
    execFileNoThrow("git", ["-C", cwd, "status", "--porcelain"]),
  ]);

  const { behind, ahead } = abRes.exitCode === 0 ? parseAheadBehind(abRes.stdout) : { behind: 0, ahead: 0 };
  const dirtyCount = statusRes.exitCode === 0 ? parseGitStatusPorcelain(statusRes.stdout) : 0;

  return { branch, ahead, behind, dirtyCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/services/session-metadata-service.ts src/services/__tests__/session-metadata-service.test.ts
git commit -m "feat(session-metadata): git status + dirty-count service (remote-dev-n6uc.1)"
```

---

### Task 3: session-metadata-service — PR from cache (reuse githubPullRequests)

**Bead:** remote-dev-n6uc.2

**Files:**
- Modify: `src/services/session-metadata-service.ts`
- Test: `src/services/__tests__/session-metadata-service.test.ts`

- [ ] **Step 1: Add failing test for PR mapper**

Append to the existing test file:

```typescript
import { mapCachedPrToStatus } from "../session-metadata-service";

describe("mapCachedPrToStatus", () => {
  it("maps a cached PR row to SessionPrStatus", () => {
    const row = {
      prNumber: 42, state: "open", url: "https://x/42", isDraft: true,
      reviewDecision: "CHANGES_REQUESTED" as const, ciStatus: "FAILURE" as const,
    };
    expect(mapCachedPrToStatus(row)).toEqual({
      number: 42, state: "open", url: "https://x/42", isDraft: true,
      reviewDecision: "CHANGES_REQUESTED", ciStatus: "FAILURE",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: FAIL — `mapCachedPrToStatus is not a function`.

- [ ] **Step 3: Implement PR lookup (cache-first, live fallback)**

Add to `session-metadata-service.ts`:

```typescript
import { db } from "@/db";
import { githubPullRequests } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import * as GitHubService from "@/services/github-service";
import type { SessionPrStatus } from "@/types/session-metadata";

type CachedPrRow = {
  prNumber: number; state: string; url: string; isDraft: boolean;
  reviewDecision: SessionPrStatus["reviewDecision"]; ciStatus: SessionPrStatus["ciStatus"];
};

export function mapCachedPrToStatus(row: CachedPrRow): SessionPrStatus {
  return {
    number: row.prNumber, state: row.state, url: row.url, isDraft: row.isDraft,
    reviewDecision: row.reviewDecision ?? null, ciStatus: row.ciStatus ?? null,
  };
}

/** Find the PR for a session's worktree branch — cache first, GitHub API fallback. */
export async function getPrStatus(
  userId: string,
  githubRepoId: string | null,
  worktreeBranch: string | null
): Promise<SessionPrStatus | null> {
  if (!githubRepoId || !worktreeBranch) return null;

  // 1) Cache hit (githubPullRequests stores `branch` = head ref).
  const cached = await db.query.githubPullRequests.findFirst({
    where: and(
      eq(githubPullRequests.repositoryId, githubRepoId),
      eq(githubPullRequests.branch, worktreeBranch)
    ),
  });
  if (cached) return mapCachedPrToStatus(cached);

  // 2) Fallback: live lookup (mirrors the legacy git-status route behaviour).
  try {
    const token = await GitHubService.getAccessToken(userId);
    if (!token) return null;
    const repo = await GitHubService.getRepository(githubRepoId, userId);
    if (!repo) return null;
    const [owner, name] = repo.fullName.split("/");
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls?head=${owner}:${worktreeBranch}&state=all&per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
    );
    if (!res.ok) return null;
    const prs = (await res.json()) as Array<{ number: number; state: string; html_url: string; draft?: boolean }>;
    if (prs.length === 0) return null;
    return { number: prs[0].number, state: prs[0].state, url: prs[0].html_url, isDraft: !!prs[0].draft, reviewDecision: null, ciStatus: null };
  } catch (err) {
    log.debug("PR live fallback failed", { error: String(err), githubRepoId });
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: PASS (5 assertions; the mapper test does not hit the DB).

- [ ] **Step 5: Commit**

```bash
git add src/services/session-metadata-service.ts src/services/__tests__/session-metadata-service.test.ts
git commit -m "feat(session-metadata): linked PR from githubPullRequests cache (remote-dev-n6uc.2)"
```

---

### Task 4: session-metadata-service — per-session listening ports

**Bead:** remote-dev-n6uc.3

**Files:**
- Modify: `src/services/session-metadata-service.ts`
- Test: `src/services/__tests__/session-metadata-service.test.ts`

Approach: a session's processes live under the tmux pane shell. We collect the session's process subtree PIDs via `pgrep -P` BFS rooted at the tmux pane PID (`tmux list-panes -t <tmux> -F '#{pane_pid}'`), then intersect with `getListeningPorts()` (which already returns `{port,{process,pid}}`). Ports whose `pid` is in the subtree are attributed to the session. This is the cmux "ports owned by this session" behaviour and avoids the current per-project over-reporting in `SessionMetadataBar`.

- [ ] **Step 1: Add failing test for the port-attribution pure fn**

```typescript
import { attributePortsToPids } from "../session-metadata-service";

describe("attributePortsToPids", () => {
  it("keeps only ports whose pid is in the subtree set", () => {
    const listening = new Map<number, { process?: string; pid?: number }>([
      [3000, { process: "node", pid: 111 }],
      [5173, { process: "vite", pid: 222 }],
      [8080, { process: "other", pid: 999 }],
    ]);
    const result = attributePortsToPids(listening, new Set([111, 222]));
    expect(result).toEqual([
      { port: 3000, process: "node", pid: 111 },
      { port: 5173, process: "vite", pid: 222 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: FAIL — `attributePortsToPids is not a function`.

- [ ] **Step 3: Implement port attribution + subtree collection**

```typescript
import { getListeningPorts } from "@/services/port-monitoring-service";
import type { SessionPortInfo } from "@/types/session-metadata";

/** Pure: keep ports whose pid is in `pids`, sorted ascending by port. */
export function attributePortsToPids(
  listening: Map<number, { process?: string; pid?: number }>,
  pids: Set<number>
): SessionPortInfo[] {
  const out: SessionPortInfo[] = [];
  for (const [port, info] of listening) {
    if (info.pid != null && pids.has(info.pid)) {
      out.push({ port, process: info.process ?? null, pid: info.pid });
    }
  }
  return out.sort((a, b) => a.port - b.port);
}

/** Collect the descendant PID set of a root pid via `pgrep -P` BFS (bounded). */
async function collectSubtreePids(rootPid: number): Promise<Set<number>> {
  const seen = new Set<number>([rootPid]);
  let frontier = [rootPid];
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const res = await execFileNoThrow("pgrep", ["-P", String(pid)]);
      if (res.exitCode !== 0) continue;
      for (const line of res.stdout.split("\n")) {
        const child = parseInt(line.trim(), 10);
        if (Number.isFinite(child) && !seen.has(child)) { seen.add(child); next.push(child); }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Resolve the tmux pane pid for a session, then its listening ports. */
export async function getSessionPorts(tmuxSessionName: string): Promise<SessionPortInfo[]> {
  const paneRes = await execFileNoThrow("tmux", ["list-panes", "-t", tmuxSessionName, "-F", "#{pane_pid}"]);
  if (paneRes.exitCode !== 0) return [];
  const rootPids = paneRes.stdout.split("\n").map((l) => parseInt(l.trim(), 10)).filter(Number.isFinite);
  if (rootPids.length === 0) return [];
  const pidSet = new Set<number>();
  for (const root of rootPids) for (const pid of await collectSubtreePids(root)) pidSet.add(pid);
  const listening = await getListeningPorts();
  return attributePortsToPids(listening, pidSet);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/services/__tests__/session-metadata-service.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/services/session-metadata-service.ts src/services/__tests__/session-metadata-service.test.ts
git commit -m "feat(session-metadata): per-session listening-port attribution (remote-dev-n6uc.3)"
```

---

### Task 5: getSessionMetadata aggregator + `/metadata` route

**Bead:** remote-dev-n6uc.1 (+ .2/.3 consumed)

**Files:**
- Modify: `src/services/session-metadata-service.ts`
- Create: `src/app/api/sessions/[id]/metadata/route.ts`
- Modify: `src/app/api/sessions/[id]/git-status/route.ts` (thin alias)

- [ ] **Step 1: Add the aggregator (no new test — composition of tested fns)**

```typescript
import * as SessionService from "@/services/session-service";
import { deriveAttention } from "@/services/session-metadata-service-attention"; // added in Task 9
import type { SessionMetadata } from "@/types/session-metadata";

export async function getSessionMetadata(sessionId: string, userId: string): Promise<SessionMetadata | null> {
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return null;

  const cwd = session.projectPath;
  const [git, pr, ports] = await Promise.all([
    cwd ? getGitStatus(cwd) : Promise.resolve(null),
    getPrStatus(userId, session.githubRepoId, session.worktreeBranch),
    getSessionPorts(session.tmuxSessionName),
  ]);

  return {
    sessionId,
    git,
    pr,
    ports,
    lastActivityAt: session.lastActivityAt ? new Date(session.lastActivityAt).toISOString() : null,
    attention: await deriveAttention(userId, sessionId, session.agentActivityStatus ?? null),
  };
}
```

- [ ] **Step 2: Create the route**

```typescript
// src/app/api/sessions/[id]/metadata/route.ts
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getSessionMetadata } from "@/services/session-metadata-service";

/** GET /api/sessions/:id/metadata — branch+dirty, linked PR, ports, attention. */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  const metadata = await getSessionMetadata(sessionId, userId);
  if (!metadata) return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  return NextResponse.json(metadata);
});
```

- [ ] **Step 3: Make git-status a thin alias (back-compat for any mobile/Flutter caller)**

Replace the body of `src/app/api/sessions/[id]/git-status/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getSessionMetadata } from "@/services/session-metadata-service";

/** @deprecated Use /metadata. Kept for back-compat; returns the git+pr subset. */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  const meta = await getSessionMetadata(sessionId, userId);
  if (!meta) return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  return NextResponse.json({
    branch: meta.git?.branch ?? null,
    ahead: meta.git?.ahead ?? 0,
    behind: meta.git?.behind ?? 0,
    pr: meta.pr ? { number: meta.pr.number, state: meta.pr.state, url: meta.pr.url } : null,
  });
});
```

- [ ] **Step 4: Typecheck (note: `deriveAttention` from Task 9 must exist; sequence Task 9 before merging, or stub it returning `null` now)**

Run: `bun run typecheck && bun run lint`
Expected: PASS. If Task 9 not yet done, temporarily inline `const deriveAttention = async () => null` and replace in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/services/session-metadata-service.ts src/app/api/sessions/[id]/metadata/route.ts src/app/api/sessions/[id]/git-status/route.ts
git commit -m "feat(session-metadata): aggregate metadata route + git-status alias (remote-dev-n6uc.1)"
```

---

### Task 6: useSessionMetadata hook (replaces useSessionGitStatus)

**Bead:** remote-dev-n6uc.1 (+ .2/.3 surfaced)

**Files:**
- Create: `src/hooks/useSessionMetadata.ts`

- [ ] **Step 1: Implement the hook (poll + WS-merge, keep TTL cache pattern from useSessionGitStatus)**

```typescript
// src/hooks/useSessionMetadata.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { SessionMetadata } from "@/types/session-metadata";

const cache = new Map<string, { data: SessionMetadata; fetchedAt: number }>();
const TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;

function evictExpired(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.fetchedAt > TTL_MS) cache.delete(k);
}

/** Allow the WS layer (SessionManager) to push fresh metadata into the cache. */
export function primeSessionMetadata(meta: SessionMetadata): void {
  cache.set(meta.sessionId, { data: meta, fetchedAt: Date.now() });
}

export function useSessionMetadata(sessionId: string | null, enabled = true) {
  const [metadata, setMetadata] = useState<SessionMetadata | null>(() => {
    if (!sessionId) return null;
    const c = cache.get(sessionId);
    return c && Date.now() - c.fetchedAt < TTL_MS ? c.data : null;
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchNow = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await apiFetch(`/api/sessions/${id}/metadata`, { credentials: "include", signal: ctrl.signal });
      if (!res.ok) return;
      const data: SessionMetadata = await res.json();
      cache.set(id, { data, fetchedAt: Date.now() });
      evictExpired();
      if (!ctrl.signal.aborted) setMetadata(data);
    } catch {
      /* non-critical */
    }
  }, []);

  // Re-read cache when a WS push primes it (event from SessionManager).
  useEffect(() => {
    if (!sessionId) return;
    const onPush = (e: Event) => {
      const detail = (e as CustomEvent<SessionMetadata>).detail;
      if (detail?.sessionId === sessionId) setMetadata(detail);
    };
    document.addEventListener("rdv:session-metadata", onPush as EventListener);
    return () => document.removeEventListener("rdv:session-metadata", onPush as EventListener);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled) { setMetadata(null); return; }
    const c = cache.get(sessionId);
    if (c && Date.now() - c.fetchedAt < TTL_MS) { setMetadata(c.data); return; }
    const delay = Math.random() * 2000; // stagger like useSessionGitStatus
    const t = setTimeout(() => fetchNow(sessionId), delay);
    return () => { clearTimeout(t); abortRef.current?.abort(); };
  }, [sessionId, enabled, fetchNow]);

  const refresh = useCallback(() => { if (sessionId) { cache.delete(sessionId); fetchNow(sessionId); } }, [sessionId, fetchNow]);
  return { metadata, refresh };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSessionMetadata.ts
git commit -m "feat(session-metadata): useSessionMetadata hook with WS-merge (remote-dev-n6uc.1)"
```

---

### Task 7: SessionMetadataBar — new chips (dirty, per-session ports, PR review/CI)

**Bead:** remote-dev-n6uc.1 / .2 / .3

**Files:**
- Modify: `src/components/session/SessionMetadataBar.tsx`
- Test: `src/components/session/__tests__/SessionMetadataBar.test.tsx`

- [ ] **Step 1: Write the failing component test (happy-dom)**

```typescript
// src/components/session/__tests__/SessionMetadataBar.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TerminalSession } from "@/types/session";
import type { SessionMetadata } from "@/types/session-metadata";

// useSessionMetadata is the only data source the bar reads.
const meta: SessionMetadata = {
  sessionId: "s1",
  git: { branch: "feat/x", ahead: 2, behind: 0, dirtyCount: 3 },
  pr: { number: 42, state: "open", url: "u", isDraft: false, reviewDecision: "CHANGES_REQUESTED", ciStatus: "FAILURE" },
  ports: [{ port: 3000, process: "node", pid: 111 }],
  lastActivityAt: null,
  attention: null,
};
vi.mock("@/hooks/useSessionMetadata", () => ({
  useSessionMetadata: () => ({ metadata: meta, refresh: () => {} }),
  primeSessionMetadata: () => {},
}));

afterEach(cleanup);

const session = { id: "s1", name: "S", terminalType: "agent", projectId: "p1" } as unknown as TerminalSession;

describe("SessionMetadataBar", () => {
  it("renders branch, dirty count, PR number, and a session-owned port", async () => {
    const { SessionMetadataBar } = await import("../SessionMetadataBar");
    render(<SessionMetadataBar session={session} />);
    expect(screen.getByText("feat/x")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();      // dirty count badge
    expect(screen.getByText(/#42/)).toBeTruthy();     // PR chip
    expect(screen.getByText(/3000/)).toBeTruthy();    // port chip
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/components/session/__tests__/SessionMetadataBar.test.tsx`
Expected: FAIL — bar still reads `useSessionGitStatus`/`usePortContext`, no dirty/per-session-port chips.

- [ ] **Step 3: Rewrite the bar to consume `useSessionMetadata`**

```tsx
// src/components/session/SessionMetadataBar.tsx
"use client";
import { cn } from "@/lib/utils";
import { GitBranch, ArrowUp, ArrowDown, GitPullRequest, Radio, FileDiff } from "lucide-react";
import { useSessionMetadata } from "@/hooks/useSessionMetadata";
import type { TerminalSession } from "@/types/session";

interface SessionMetadataBarProps { session: TerminalSession; isCollapsed?: boolean; }

export function SessionMetadataBar({ session, isCollapsed }: SessionMetadataBarProps) {
  const { metadata } = useSessionMetadata(session.id, !isCollapsed);
  if (isCollapsed) return null;
  const git = metadata?.git;
  const pr = metadata?.pr;
  const ports = metadata?.ports ?? [];
  if (!git?.branch && ports.length === 0 && !pr) return null;

  const prTone = pr?.reviewDecision === "CHANGES_REQUESTED" || pr?.ciStatus === "FAILURE"
    ? "text-red-400 bg-red-400/10"
    : pr?.state === "open" ? "text-green-400 bg-green-400/10" : "text-purple-400 bg-purple-400/10";

  return (
    <div className="flex flex-wrap gap-1 mt-0.5 px-1">
      {git?.branch && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 bg-muted/30 rounded px-1 py-0.5 max-w-[120px]">
          <GitBranch className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{git.branch}</span>
          {git.ahead > 0 && (<span className="inline-flex items-center text-green-400"><ArrowUp className="w-2 h-2" />{git.ahead}</span>)}
          {git.behind > 0 && (<span className="inline-flex items-center text-orange-400"><ArrowDown className="w-2 h-2" />{git.behind}</span>)}
          {git.dirtyCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-amber-400" title={`${git.dirtyCount} uncommitted changes`}>
              <FileDiff className="w-2 h-2" />{git.dirtyCount}
            </span>
          )}
        </span>
      )}
      {pr && (
        <a href={pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
           className={cn("inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5", prTone)}>
          <GitPullRequest className="w-2.5 h-2.5" />#{pr.number}{pr.isDraft ? " ·draft" : ""}
        </a>
      )}
      {ports.map((p) => (
        <a key={p.port} href={`/api/sessions/${session.id}/proxy/${p.port}/`} target="_blank" rel="noreferrer"
           onClick={(e) => e.stopPropagation()} title={p.process ?? undefined}
           className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-400/10 rounded px-1 py-0.5 hover:underline">
          <Radio className="w-2.5 h-2.5" />:{p.port}
        </a>
      ))}
    </div>
  );
}
```

Note: the quick-open `href` points at the per-session proxy route (Task 16). On localhost that route 302-redirects to `http://localhost:PORT/`; on remote/k3s it streams through the proxy. This keeps one code path for both.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/components/session/__tests__/SessionMetadataBar.test.tsx`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SessionMetadataBar.tsx src/components/session/__tests__/SessionMetadataBar.test.tsx
git commit -m "feat(session-ux): branch+dirty+PR-review+per-session ports chips (remote-dev-n6uc.1/.2/.3)"
```

---

### Task 8: WebSocket push of live metadata

**Bead:** remote-dev-n6uc.1 (delivery for .1–.4)

**Files:**
- Modify: `src/server/terminal.ts`
- Modify: `src/hooks/useTerminalWebSocket.ts`
- Modify: `src/contexts/SessionContext.tsx`
- Modify: `src/components/session/SessionManager.tsx`

- [ ] **Step 1: Add a broadcaster + emit on activity-status changes (server)**

In `src/server/terminal.ts`, after the existing `agentStatusLog` block, add a helper and call it. Use `createLogger` (already imported as `log`/`agentStatusLog`):

```typescript
// near other broadcast helpers (after broadcastToClients, ~line 230)
async function broadcastSessionMetadata(sessionId: string, userId: string): Promise<void> {
  try {
    const { getSessionMetadata } = await import("@/services/session-metadata-service");
    const meta = await getSessionMetadata(sessionId, userId);
    if (meta) broadcastToUser(userId, { type: "session_metadata", metadata: meta });
  } catch (err) {
    log.warn("session_metadata broadcast failed", { error: String(err), sessionId });
  }
}
```

Then, inside the `/internal/agent-status` handler (right after the existing `broadcastToClients({ type: "agent_activity_status", ... })` at ~line 655), look up the userId already fetched for the notification path and fire-and-forget:

```typescript
// after persisting activity status; reuse the session lookup you already do
void import("@/db").then(async ({ db }) => {
  const { terminalSessions } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId), columns: { userId: true },
  });
  if (row) await broadcastSessionMetadata(sessionId, row.userId);
});
```

Also call `broadcastSessionMetadata` in the agent-exit handler (the block near `agentExitedEvent`) so dirty-state/ports refresh when an agent stops.

- [ ] **Step 2: Add a client handler that re-dispatches as a DOM event (web)**

In `src/hooks/useTerminalWebSocket.ts`, add a case beside `case "agent_activity_status":` (~line 288):

```typescript
case "session_metadata":
  if (msg.metadata) {
    document.dispatchEvent(new CustomEvent("rdv:session-metadata", { detail: msg.metadata }));
  }
  break;
```

- [ ] **Step 3: Store metadata in SessionContext (optional consumers like jump)**

In `src/contexts/SessionContext.tsx`, add state mirroring `agentActivityStatuses`:

```typescript
const [sessionMetadata, setSessionMetadataState] = useState<Record<string, SessionMetadata>>({});
const setSessionMetadata = useCallback((m: SessionMetadata) => {
  setSessionMetadataState((prev) => ({ ...prev, [m.sessionId]: m }));
}, []);
```

Expose `sessionMetadata` + `setSessionMetadata` on the context value (add to the interface near `agentActivityStatuses` at line 89, and to the `useMemo` value). Import `SessionMetadata` and `primeSessionMetadata`.

- [ ] **Step 4: Wire SessionManager to prime cache + context on the DOM event**

In `src/components/session/SessionManager.tsx`, near the `rdv:sidebar-changed` listener (~line 328):

```typescript
useEffect(() => {
  const onMeta = (e: Event) => {
    const meta = (e as CustomEvent<SessionMetadata>).detail;
    if (!meta) return;
    primeSessionMetadata(meta);     // updates the useSessionMetadata cache
    setSessionMetadata(meta);       // updates context for jump/needs-attention
  };
  document.addEventListener("rdv:session-metadata", onMeta as EventListener);
  return () => document.removeEventListener("rdv:session-metadata", onMeta as EventListener);
}, [setSessionMetadata]);
```

- [ ] **Step 5: Typecheck + lint + run touched tests**

Run: `bun run typecheck && bun run lint && bun run test:run src/components/session/__tests__/SessionMetadataBar.test.tsx`
Expected: PASS. Manual check: trigger an agent waiting hook → row chips update without a page reload.

- [ ] **Step 6: Commit**

```bash
git add src/server/terminal.ts src/hooks/useTerminalWebSocket.ts src/contexts/SessionContext.tsx src/components/session/SessionManager.tsx
git commit -m "feat(session-ux): WebSocket push of live session metadata (remote-dev-n6uc.1)"
```

---

## Phase B

### Task 9: Needs-attention severity (interim) + derivation

**Bead:** remote-dev-n6uc.4 (cross-dep: remote-dev-y5ch.1)

**Cross-dependency policy:** y5ch.1 (P1) adds `severity` (`actionable | passive | error`) to `notificationEvents` + `NotificationType` classification. If y5ch.1 has merged, consume its `severity` column directly. If NOT, this task adds the same column (idempotent with y5ch.1's migration intent) and an interim derivation from `agentActivityStatus`. Coordinate the column name `severity` with y5ch.1 to avoid a duplicate migration; if y5ch.1 lands first, skip Step 1.

**Files:**
- Modify (interim only): `src/db/schema.ts`, `src/types/notification.ts`
- Create: `src/services/session-metadata-service-attention.ts`

- [ ] **Step 1 (interim, skip if y5ch.1 merged): add severity to schema + types**

In `src/db/schema.ts` `notificationEvents` (line ~1460), after `type`:

```typescript
severity: text("severity").$type<"actionable" | "passive" | "error">().notNull().default("passive"),
```

In `src/types/notification.ts`:

```typescript
export type NotificationSeverity = "actionable" | "passive" | "error";
// add `severity: NotificationSeverity;` to NotificationEvent and
// `severity?: NotificationSeverity;` to CreateNotificationInput
```

Push schema: `bun run db:push` (additive column with default — safe).

- [ ] **Step 2: Implement `deriveAttention` (the function Task 5 imports)**

```typescript
// src/services/session-metadata-service-attention.ts
import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";

/**
 * Highest unmet attention level for a session.
 * Primary source: the most recent UNREAD notification's severity (y5ch.1).
 * Interim fallback: agentActivityStatus ("error" → error, "waiting" → actionable).
 */
export async function deriveAttention(
  userId: string,
  sessionId: string,
  agentActivityStatus: string | null
): Promise<"error" | "actionable" | null> {
  const latest = await db.query.notificationEvents.findFirst({
    where: and(
      eq(notificationEvents.userId, userId),
      eq(notificationEvents.sessionId, sessionId),
      isNull(notificationEvents.readAt)
    ),
    orderBy: [desc(notificationEvents.createdAt)],
    columns: { severity: true },
  });
  if (latest?.severity === "error") return "error";
  if (latest?.severity === "actionable") return "actionable";

  // Interim signal if no actionable notification recorded yet.
  if (agentActivityStatus === "error") return "error";
  if (agentActivityStatus === "waiting") return "actionable";
  return null;
}
```

- [ ] **Step 3: Replace the Task 5 stub import**

In `session-metadata-service.ts`, ensure the import points at the real module:
`import { deriveAttention } from "@/services/session-metadata-service-attention";` (remove any temporary inline stub).

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. (`severity` column resolves; `deriveAttention` exported.)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/types/notification.ts src/services/session-metadata-service-attention.ts src/services/session-metadata-service.ts
git commit -m "feat(session-ux): needs-attention severity derivation (remote-dev-n6uc.4)"
```

---

### Task 10: Surface attention in the row (dot + ring)

**Bead:** remote-dev-n6uc.4

**Files:**
- Modify: `src/components/session/SessionMetadataBar.tsx`
- Modify: `src/components/session/project-tree/SessionRow.tsx`

- [ ] **Step 1: Add an attention dot + relative-time to the bar**

Append inside the bar's wrapper (before `</div>`), reading `metadata?.attention` and `metadata?.lastActivityAt`:

```tsx
{metadata?.attention && (
  <span
    title={metadata.attention === "error" ? "Agent error — needs attention" : "Agent waiting — needs attention"}
    className={cn(
      "inline-flex items-center text-[10px] rounded px-1 py-0.5",
      metadata.attention === "error" ? "text-red-400 bg-red-400/10" : "text-yellow-400 bg-yellow-400/10"
    )}
    data-attention={metadata.attention}
  >
    ●
  </span>
)}
```

- [ ] **Step 2: Strengthen the row ring using metadata (not just local agentStatus)**

`SessionRow.tsx` already computes `isAgentAlertState` from `agentStatus` (line 126). Add a `data-needs-attention` attribute on the row div so the jump action can `querySelector` it. In the outer row `<div role="button" ...>` add:

```tsx
data-session-id={session.id}
data-needs-attention={isAgentAlertState ? "true" : undefined}
```

(`isAgentAlertState` already gates the `ring-2 ring-yellow-400/70 animate-pulse` styling — keep it; the metadata dot is the richer per-source signal, the ring is the coarse local one.)

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/session/SessionMetadataBar.tsx src/components/session/project-tree/SessionRow.tsx
git commit -m "feat(session-ux): needs-attention dot + row data-attrs (remote-dev-n6uc.4)"
```

---

## Phase C

### Task 11: useJumpToAttention hook

**Bead:** remote-dev-n6uc.5 (depends .4)

**Files:**
- Create: `src/hooks/useJumpToAttention.ts`
- Test: `src/hooks/__tests__/useJumpToAttention.test.ts`

- [ ] **Step 1: Write the failing test for the pure ordering fn**

```typescript
// src/hooks/__tests__/useJumpToAttention.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextAttentionId } from "../useJumpToAttention";

describe("nextAttentionId", () => {
  const ordered = ["a", "b", "c", "d"];
  const attention = new Set(["b", "d"]);
  it("returns first attention session after the active one (wraps)", () => {
    expect(nextAttentionId(ordered, attention, "b")).toBe("d");
    expect(nextAttentionId(ordered, attention, "d")).toBe("b"); // wrap
    expect(nextAttentionId(ordered, attention, "a")).toBe("b");
  });
  it("returns first attention session when active is null", () => {
    expect(nextAttentionId(ordered, attention, null)).toBe("b");
  });
  it("returns null when no session needs attention", () => {
    expect(nextAttentionId(ordered, new Set(), "a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/hooks/__tests__/useJumpToAttention.test.ts`
Expected: FAIL — `nextAttentionId is not a function`.

- [ ] **Step 3: Implement hook + pure fn**

```typescript
// src/hooks/useJumpToAttention.ts
import { useCallback } from "react";
import { useSessionContext } from "@/contexts/SessionContext";
import type { SessionMetadata } from "@/types/session-metadata";

/** Pure: next id in `ordered` (after `activeId`, wrapping) that's in `attention`. */
export function nextAttentionId(
  ordered: string[],
  attention: Set<string>,
  activeId: string | null
): string | null {
  if (attention.size === 0) return null;
  const start = activeId ? ordered.indexOf(activeId) : -1;
  for (let i = 1; i <= ordered.length; i++) {
    const candidate = ordered[(start + i + ordered.length) % ordered.length];
    if (attention.has(candidate)) return candidate;
  }
  return null;
}

export function useJumpToAttention() {
  const { sessions, activeSessionId, setActiveSession, sessionMetadata, agentActivityStatuses } =
    useSessionContext();

  const jumpNext = useCallback(() => {
    const ordered = sessions.map((s) => s.id);
    const attention = new Set<string>();
    for (const s of sessions) {
      const meta = sessionMetadata[s.id] as SessionMetadata | undefined;
      const status = agentActivityStatuses[s.id];
      if (meta?.attention || status === "waiting" || status === "error") attention.add(s.id);
    }
    const target = nextAttentionId(ordered, attention, activeSessionId);
    if (target) {
      setActiveSession(target);
      // Scroll the row into view (rows carry data-session-id, Task 10).
      requestAnimationFrame(() => {
        document.querySelector(`[data-session-id="${target}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
    return target;
  }, [sessions, activeSessionId, setActiveSession, sessionMetadata, agentActivityStatuses]);

  return { jumpNext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/hooks/__tests__/useJumpToAttention.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useJumpToAttention.ts src/hooks/__tests__/useJumpToAttention.test.ts
git commit -m "feat(session-ux): jump-to-next-attention ordering hook (remote-dev-n6uc.5)"
```

---

### Task 12: Wire jump — keyboard (web) + mobile FAB

**Bead:** remote-dev-n6uc.5

**Files:**
- Modify: `src/components/session/SessionManager.tsx`
- Modify: `src/components/mobile/sessions/SessionsTab.tsx`

- [ ] **Step 1: Add a keyboard shortcut (web) — Ctrl/Cmd+. cycles to next attention**

`SessionManager.tsx` already has a `handleKeyDown` registered (~line 1571). Inside it (before the closing brace), add — placing it with the other shortcut branches:

```typescript
// Ctrl/Cmd + .  → jump to next agent needing attention
if ((e.ctrlKey || e.metaKey) && e.key === ".") {
  e.preventDefault();
  jumpNext();
  return;
}
```

At the top of the component, `const { jumpNext } = useJumpToAttention();` and add `jumpNext` to the effect's dependency array.

- [ ] **Step 2: Add a mobile FAB**

In `src/components/mobile/sessions/SessionsTab.tsx`, add a floating button (only shown when at least one session needs attention). Mobile may use `console.error` per repo rules, but this needs none. Compute attention from the same context:

```tsx
import { useJumpToAttention } from "@/hooks/useJumpToAttention";
import { Bell } from "lucide-react";
// inside the component:
const { jumpNext } = useJumpToAttention();
const { sessions, sessionMetadata, agentActivityStatuses } = useSessionContext();
const needsAttention = sessions.some(
  (s) => sessionMetadata[s.id]?.attention || ["waiting", "error"].includes(agentActivityStatuses[s.id] ?? "")
);
// near the end of the returned JSX:
{needsAttention && (
  <button
    type="button"
    aria-label="Jump to next agent needing attention"
    onClick={() => jumpNext()}
    className="fixed bottom-20 right-4 z-30 rounded-full bg-yellow-500 text-black w-12 h-12 flex items-center justify-center shadow-lg animate-pulse"
  >
    <Bell className="w-5 h-5" />
  </button>
)}
```

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. Manual: set two agents to "waiting", press Cmd+. → focus cycles between them; on mobile the FAB appears and advances.

- [ ] **Step 4: Commit**

```bash
git add src/components/session/SessionManager.tsx src/components/mobile/sessions/SessionsTab.tsx
git commit -m "feat(session-ux): jump-to-attention keyboard shortcut + mobile FAB (remote-dev-n6uc.5)"
```

---

## Phase D

### Task 13: Unified-diff parser (pure)

**Bead:** remote-dev-n6uc.6

**Files:**
- Create: `src/components/session/diff/parseUnifiedDiff.ts`
- Test: `src/components/session/diff/__tests__/parseUnifiedDiff.test.ts`

- [ ] **Step 1: Write the failing parser test**

```typescript
// src/components/session/diff/__tests__/parseUnifiedDiff.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../parseUnifiedDiff";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
diff --git a/README.md b/README.md
new file mode 100644
index 000..333
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+hello
`;

describe("parseUnifiedDiff", () => {
  it("splits into files with path + add/del counts", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "README.md"]);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(0);
  });
  it("captures hunk lines with type", () => {
    const files = parseUnifiedDiff(SAMPLE);
    const types = files[0].lines.map((l) => l.type);
    expect(types).toContain("add");
    expect(types).toContain("del");
    expect(types).toContain("ctx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/components/session/diff/__tests__/parseUnifiedDiff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// src/components/session/diff/parseUnifiedDiff.ts
export type DiffLineType = "add" | "del" | "ctx" | "meta";
export interface DiffLine { type: DiffLineType; text: string; }
export interface DiffFileEntry {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/** Parse raw `git diff` output into per-file entries with counts + hunk lines. */
export function parseUnifiedDiff(raw: string): DiffFileEntry[] {
  const files: DiffFileEntry[] = [];
  let current: DiffFileEntry | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      const m = line.match(/ b\/(.+)$/);
      current = { path: m ? m[1] : "unknown", additions: 0, deletions: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") ||
        line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("@@") ||
        line.startsWith("similarity") || line.startsWith("rename ")) {
      current.lines.push({ type: "meta", text: line });
      continue;
    }
    if (line.startsWith("+")) { current.additions++; current.lines.push({ type: "add", text: line.slice(1) }); }
    else if (line.startsWith("-")) { current.deletions++; current.lines.push({ type: "del", text: line.slice(1) }); }
    else current.lines.push({ type: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
  }
  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/components/session/diff/__tests__/parseUnifiedDiff.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/components/session/diff/parseUnifiedDiff.ts src/components/session/diff/__tests__/parseUnifiedDiff.test.ts
git commit -m "feat(diff): unified-diff parser (remote-dev-n6uc.6)"
```

---

### Task 14: Diff route + page + viewer

**Bead:** remote-dev-n6uc.6

**Files:**
- Create: `src/app/api/sessions/[id]/diff/route.ts`
- Create: `src/components/session/diff/SessionDiffViewer.tsx`
- Create: `src/app/sessions/[id]/diff/page.tsx`

- [ ] **Step 1: Diff route — `git diff` in the worktree against its merge-base**

```typescript
// src/app/api/sessions/[id]/diff/route.ts
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { getDefaultBranch } from "@/services/worktree-service";
import { execFileNoThrow } from "@/lib/exec";

/**
 * GET /api/sessions/:id/diff
 * Returns the raw `git diff` of the worktree branch vs its merge-base with the
 * default branch (uncommitted changes included via `git diff <base>...`).
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  const cwd = session.projectPath;
  if (!cwd) return NextResponse.json({ raw: "", base: null });

  const base = await getDefaultBranch(cwd).catch(() => "main");
  // merge-base diff: everything on this branch + working tree vs the base.
  const mb = await execFileNoThrow("git", ["-C", cwd, "merge-base", "HEAD", base]);
  const baseRef = mb.exitCode === 0 && mb.stdout.trim() ? mb.stdout.trim() : base;
  const diff = await execFileNoThrow("git", ["-C", cwd, "diff", baseRef]);
  if (diff.exitCode !== 0) return NextResponse.json({ raw: "", base: baseRef });
  return NextResponse.json({ raw: diff.stdout, base: baseRef });
});
```

- [ ] **Step 2: Viewer component (file list + colored hunks)**

```tsx
// src/components/session/diff/SessionDiffViewer.tsx
"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { parseUnifiedDiff, type DiffFileEntry } from "./parseUnifiedDiff";
import { cn } from "@/lib/utils";

export function SessionDiffViewer({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<DiffFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/sessions/${sessionId}/diff`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { raw: string }) => { if (!cancelled) setFiles(parseUnifiedDiff(d.raw)); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) return <div className="p-4 text-sm text-red-400">Failed to load diff: {error}</div>;
  if (!files) return <div className="p-4 text-sm text-muted-foreground">Loading diff…</div>;
  if (files.length === 0) return <div className="p-4 text-sm text-muted-foreground">No changes against the base branch.</div>;

  return (
    <div className="flex flex-col gap-4 p-4 font-mono text-xs">
      {files.map((f) => (
        <div key={f.path} className="border border-border rounded overflow-hidden">
          <div className="flex items-center justify-between bg-muted/40 px-2 py-1">
            <span className="truncate">{f.path}</span>
            <span><span className="text-green-400">+{f.additions}</span> <span className="text-red-400">-{f.deletions}</span></span>
          </div>
          <pre className="overflow-x-auto">
            {f.lines.map((l, i) => (
              <div key={i} className={cn(
                "px-2 whitespace-pre",
                l.type === "add" && "bg-green-500/10 text-green-300",
                l.type === "del" && "bg-red-500/10 text-red-300",
                l.type === "meta" && "text-muted-foreground/60"
              )}>
                {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}{l.text}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: App Router page**

```tsx
// src/app/sessions/[id]/diff/page.tsx
import { SessionDiffViewer } from "@/components/session/diff/SessionDiffViewer";

export default async function SessionDiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="h-screen overflow-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-2 text-sm">
        Worktree diff — session {id}
      </header>
      <SessionDiffViewer sessionId={id} />
    </main>
  );
}
```

- [ ] **Step 4: Add a "View diff" entry from the row context menu + metadata bar**

In `src/components/session/SessionMetadataBar.tsx`, when `git?.dirtyCount` or `git?.ahead`, render a small link to the diff page:

```tsx
{(git && (git.dirtyCount > 0 || git.ahead > 0)) && (
  <a href={`/sessions/${session.id}/diff`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
     title="View worktree diff" className="inline-flex items-center text-[10px] text-muted-foreground/70 hover:text-foreground">
    <FileDiff className="w-2.5 h-2.5" />
  </a>
)}
```

(`FileDiff` is already imported in Task 7.)

- [ ] **Step 5: Typecheck + lint + run diff tests**

Run: `bun run typecheck && bun run lint && bun run test:run src/components/session/diff/__tests__/parseUnifiedDiff.test.ts`
Expected: PASS. Manual: open `/sessions/<id>/diff` for a worktree session with changes → file list + colored hunks render.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/sessions/[id]/diff/route.ts src/components/session/diff/SessionDiffViewer.tsx src/app/sessions/[id]/diff/page.tsx src/components/session/SessionMetadataBar.tsx
git commit -m "feat(diff): in-app worktree diff viewer route + page (remote-dev-n6uc.6)"
```

---

## Phase E

### Task 15: Per-session port-proxy (n6uc.7)

**Bead:** remote-dev-n6uc.7 (builds on .3)

**Reality check (be honest):** A full cmux-style SOCKS5/HTTP-CONNECT per-session tunnel that makes arbitrary `localhost:PORT` "just work" for any TCP client is large and out of scope for one task. What is realistic and high-value: an **authenticated HTTP reverse-proxy route** that forwards browser requests to a session's `localhost:PORT`. On a single-host (localhost) deploy this 302-redirects to `http://localhost:PORT/` (no proxy needed). On a **remote/k3s instance** the same route runs *inside* the instance pod, so `localhost:PORT` there is the dev server — the route streams it back through the already-authenticated front door (supervisor-router → instance), exactly reusing the `apps/supervisor-router/src/lib/proxy.ts` forwarding semantics (hop-by-hop stripping, `Content-Encoding` handling, cookie pass-through). WebSocket upgrade for dev-server HMR is documented as a follow-up (`n6uc.7` note) because Next.js route handlers cannot upgrade sockets — that must live in `src/server/terminal.ts` if needed.

**Files:**
- Create: `src/app/api/sessions/[id]/proxy/[port]/[[...path]]/route.ts`

- [ ] **Step 1: Implement the proxy route (GET/POST/etc. via a shared handler)**

```typescript
// src/app/api/sessions/[id]/proxy/[port]/[[...path]]/route.ts
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { getSessionPorts } from "@/services/session-metadata-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/proxy");

/** Hop-by-hop headers (RFC 7230 §6.1) not forwarded by a proxy. */
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

async function handle(request: Request, userId: string, params?: Record<string, string>) {
  const sessionId = params?.id;
  const portStr = params?.port;
  if (!sessionId || !portStr) return errorResponse("session id and port required", 400, "BAD_REQUEST");
  const port = parseInt(portStr, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return errorResponse("invalid port", 400, "BAD_PORT");

  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");

  // SECURITY: only allow ports actually owned by this session's process tree.
  const owned = await getSessionPorts(session.tmuxSessionName);
  if (!owned.some((p) => p.port === port)) {
    return errorResponse("Port is not owned by this session", 403, "PORT_NOT_OWNED");
  }

  // Reconstruct the upstream path + query from the catch-all segment.
  const url = new URL(request.url);
  const proxyPrefix = `/api/sessions/${sessionId}/proxy/${port}`;
  const upstreamPath = url.pathname.startsWith(proxyPrefix) ? url.pathname.slice(proxyPrefix.length) || "/" : "/";
  const target = `http://127.0.0.1:${port}${upstreamPath}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v); });

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual",
    });
    // Strip framing headers the fetch impl already decoded (mirror supervisor-router).
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete("content-encoding");
    respHeaders.delete("content-length");
    return new NextResponse(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (err) {
    log.warn("port proxy upstream failed", { error: String(err), sessionId, port });
    return errorResponse("Dev server not reachable on that port", 502, "UPSTREAM_UNREACHABLE");
  }
}

export const GET = withApiAuth((req, ctx) => handle(req, ctx.userId, ctx.params));
export const POST = withApiAuth((req, ctx) => handle(req, ctx.userId, ctx.params));
export const PUT = withApiAuth((req, ctx) => handle(req, ctx.userId, ctx.params));
export const PATCH = withApiAuth((req, ctx) => handle(req, ctx.userId, ctx.params));
export const DELETE = withApiAuth((req, ctx) => handle(req, ctx.userId, ctx.params));
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Start a dev server in a session (e.g. `bun run dev` in a worktree session listening on 3000), then open the quick-open chip from Task 7 (`/api/sessions/<id>/proxy/3000/`). Expected: the app loads through the proxy. Hit a port NOT owned by the session → `403 PORT_NOT_OWNED`. Document the WS/HMR limitation in the bead.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/sessions/[id]/proxy/[port]/[[...path]]/route.ts"
git commit -m "feat(port-proxy): authenticated per-session localhost:PORT HTTP proxy (remote-dev-n6uc.7)"
```

---

## Phase F

### Task 16: Test coverage sweep

**Bead:** remote-dev-n6uc.8

**Files:** (all test files authored in earlier tasks)
- `src/services/__tests__/session-metadata-service.test.ts` (Tasks 2–4)
- `src/components/session/diff/__tests__/parseUnifiedDiff.test.ts` (Task 13)
- `src/components/session/__tests__/SessionMetadataBar.test.tsx` (Task 7)
- `src/hooks/__tests__/useJumpToAttention.test.ts` (Task 11)

- [ ] **Step 1: Add one more service test — empty session has empty metadata shape**

Append to `session-metadata-service.test.ts`:

```typescript
import { attributePortsToPids as attr } from "../session-metadata-service";
describe("attributePortsToPids edge cases", () => {
  it("returns [] when no pids match", () => {
    const m = new Map([[3000, { process: "node", pid: 1 }]]);
    expect(attr(m, new Set([999]))).toEqual([]);
  });
  it("ignores entries with no pid", () => {
    const m = new Map([[3000, { process: "node" }]]);
    expect(attr(m, new Set([1]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the full suite + gates**

Run: `bun run test:run && bun run lint && bun run typecheck`
Expected: PASS — all four new test files green, no lint/type errors. Confirm counts: `session-metadata-service` ≥ 8 assertions, `parseUnifiedDiff` 6, `SessionMetadataBar` 4, `useJumpToAttention` 4.

- [ ] **Step 3: Commit**

```bash
git add src/services/__tests__/session-metadata-service.test.ts
git commit -m "test(session-ux): metadata + diff + jump coverage sweep (remote-dev-n6uc.8)"
```

---

## Risks & Open Questions

1. **Port-proxy realism & security (n6uc.7).** The shipped route is an authenticated HTTP reverse-proxy gated to session-owned ports — NOT a general SOCKS5/HTTP-CONNECT tunnel. WebSocket/HMR upgrade is intentionally deferred (Next.js route handlers cannot upgrade sockets; would need `src/server/terminal.ts`). SSRF is contained by (a) `withApiAuth`, (b) the `PORT_NOT_OWNED` check via `getSessionPorts`, and (c) hard-coding the upstream host to `127.0.0.1`. Open question: do we want a relative `<base href>` rewrite so dev-server absolute asset paths resolve under the proxy prefix? For many SPAs the current pass-through is enough; SSR apps with absolute `/` asset URLs may need rewriting — flag in the bead.

2. **Cross-dependency on y5ch.1 severity (n6uc.4).** The plan adds `severity` to `notificationEvents` only if y5ch.1 hasn't landed, and coordinates the exact column name (`severity`) to avoid a duplicate migration. Interim derivation falls back to `agentActivityStatus`. If y5ch.1 changes the enum values, `deriveAttention` must be updated — keep the mapping in one place (`session-metadata-service-attention.ts`).

3. **Live-metadata refresh cost.** `getSessionMetadata` shells out to git (3 calls) + `pgrep` BFS + `lsof` per request. Mitigations already in the plan: 60s client TTL cache, 0–2s mount stagger, and the WS push fires only on activity-status transitions (not on every output frame). Risk: many sessions × frequent status flips could cause `lsof` storms. If observed, add a short server-side memo (e.g. 3s) around `getListeningPorts()` since it's process-global. Flag for load testing.

4. **Mobile parity scope.** Web/PWA is the primary target. Mobile gets read-only metadata in `SessionMetadataSheet` + a jump FAB in `SessionsTab` (both reuse the same context + hook). The Flutter client (`mobile/`) is explicitly out of scope for this epic — file a follow-up bead if native parity is wanted. The diff viewer is a full web route; it works in the PWA webview but is not a native Flutter screen.

5. **`@{u}` upstream absence.** `getGitStatus` ahead/behind uses `@{u}...HEAD`; a branch with no upstream returns non-zero and we default to `{0,0}` — correct (no upstream = nothing to compare). Verified against `worktree-service` patterns.

---

## Self-Review

**1. Spec coverage (all 8 beads):**
- n6uc.1 live branch + dirty → Tasks 1, 2, 5, 6, 7, 8 ✅ (dirtyCount added; branch already existed, now WS-live)
- n6uc.2 PR# + status from `githubPullRequests` cache → Task 3 (cache-first + live fallback), surfaced Task 7 ✅
- n6uc.3 listening ports per session + quick-open → Task 4 (PID-subtree attribution), chip+link Task 7 ✅
- n6uc.4 needs-attention indicator (severity cross-dep) → Tasks 9, 10 ✅ (interim + y5ch.1 path)
- n6uc.5 jump to next attention (keyboard + mobile) → Tasks 11, 12 ✅
- n6uc.6 in-app diff viewer → Tasks 13, 14 ✅
- n6uc.7 remote port-proxy → Task 15 ✅ (scoped honestly)
- n6uc.8 tests → authored inline (Tasks 2–4, 7, 11, 13) + sweep Task 16 ✅

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to". Every code step shows full code; the one deliberate forward-reference (`deriveAttention` used in Task 5, defined in Task 9) is called out with an explicit stub instruction. Fixed.

**3. Type-name consistency:** `SessionMetadata`, `SessionGitStatus`, `SessionPrStatus`, `SessionPortInfo` (Task 1) used identically in Tasks 3–8, 11, 15. `DiffFileEntry`/`DiffLine`/`DiffLineType` (Task 13) used in Task 14. Functions: `getSessionMetadata` (Task 5) imported in Tasks 8, 15; `getSessionPorts` (Task 4) used in Tasks 5, 15; `attributePortsToPids`/`parseGitStatusPorcelain`/`parseAheadBehind`/`mapCachedPrToStatus` (Tasks 2–4) match their tests; `deriveAttention` (Task 9) matches Task 5's import; `nextAttentionId`/`useJumpToAttention` (Task 11) match Task 12; `primeSessionMetadata`/`useSessionMetadata` (Task 6) match Tasks 7, 8; WS message type string `"session_metadata"` and DOM event `"rdv:session-metadata"` consistent across Tasks 6, 8. Verified — no drift.
