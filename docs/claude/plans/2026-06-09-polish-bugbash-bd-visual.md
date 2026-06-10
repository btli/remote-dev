# Polish: bugbash — bd integration inconsistencies + visual glitches (2026-06-09)

> **SHIPPED 2026-06-09** — PR #405 (`fix/status-visual-drift`, remote-dev-ewxl),
> PR #406 (`fix/beads-detail-polish`, remote-dev-ougb),
> PR #407 (`fix/beads-data-correctness`, remote-dev-y19x). All merged to master;
> bd issues closed. Ship-it review caught and fixed two extra bugs in A
> (stale `unavailable` flag on real errors; epic-progress double-count on mixed
> structural dep types).

Focus: bd (beads) integration data-correctness/UX + status-visual drift in the web UI.
All items verified first-hand against source (not just explore-agent claims).
Notable: `bd list --status blocked` proves dolt stores a `blocked` status the entire
web integration omits; `/api/beads/stats` has no web consumer (client computes stats).

## Worktrees

Rule: no two worktrees modify the same file.

### Worktree A — `fix/beads-data-correctness` (heavy)

Files: `src/types/beads.ts`, `src/components/beads/beads-constants.ts`,
`src/services/beads-service.ts`, `src/services/__tests__/beads-service.test.ts`,
`src/lib/beads-db.ts`, `src/app/api/beads/route.ts`, `src/app/api/beads/stats/route.ts`,
`src/app/api/beads/[id]/route.ts`, `src/app/api/beads/[id]/comments/route.ts`,
`src/contexts/BeadsContext.tsx`, `src/components/beads/BeadsSidebar.tsx`

1. Add `"blocked"` to `BeadsStatus`; constants entries (`STATUS_COLORS.blocked`,
   `STATUS_BADGE_STYLES.blocked`, orange family); add to route `VALID_STATUSES`.
2. `BeadsDependency.dependsOnStatus?: BeadsStatus | null` populated by the service
   (batch lookup of blocker statuses); `isActiveBlocker()` helper in types
   (`dependsOnStatus !== "closed"`, missing = active/conservative).
3. Ready/blocked semantics unified everywhere: ready = status `open` AND no active
   blocking dep; blocked = non-closed AND (status `blocked` OR has active blocking dep).
   Applied in `BeadsContext.computedStats`, `BeadsSidebar` grouping, and `getStats` SQL
   (NOT EXISTS subquery; stop deriving ready by subtraction; count `blocked` status rows).
4. Epic-children augmentation honors the default retention predicate
   (`status != 'closed' OR closed_at >= cutoff OR issue_type = 'epic'`).
5. Dolt-unavailable made distinct: `isDoltUnavailable(err)` in `beads-db.ts`
   (walks `.code`/`.cause`/AggregateError; message fallback); routes return
   `unavailable: true`; context exposes it; sidebar shows "bd server unreachable" + Retry
   instead of the lying "No issues" empty state.
6. Remove the full-sidebar loading overlay (flashes over Schedules tab on every
   WS-driven refresh); header RefreshCw spinner is the load indicator.
7. Stale detail fix: store `selectedIssueId`, derive issue from `issueMap` so the
   detail pane live-updates; auto-returns to list if the issue is pruned.
8. Closed section sorted by `closedAt` desc.
9. Dep tooltip wording: "blocked by N · blocks M".
10. Dep chip color → shared constant with light/dark variants; dedupe
    `DEFAULT_SECTION_EXPANDED` (import `BEADS_SECTION_EXPAND_DEFAULTS`).
11. Epic rows get a child-progress chip (closed/total from issueMap).
12. Sidebar collapsed-badge `openCount` = `stats.total - stats.closed` (all non-closed),
    same as before but stated + consistent with new stats fields.

### Worktree B — `fix/beads-detail-polish` (light)

Files: `src/components/beads/BeadsIssueDetail.tsx`, `src/components/beads/BeadsDependencyTree.tsx`

1. Comments/events fetch error tracked separately; inline "Failed to load" + retry;
   small refresh affordance on the Comments header.
2. `formatDate` guards invalid dates ("unknown").
3. `aria-expanded` on all section toggles; `aria-label` on tree expand buttons.
4. Tree "(not found)" → "(not loaded)" with title hint (usually retention-pruned).

### Worktree C — `fix/status-visual-drift` (medium)

Files: `src/components/session/TabBar.tsx` (delete), `src/components/peers/FolderTabBar.tsx`,
`src/components/session/project-tree/sessionIconColor.ts`,
`src/components/session/SessionMetadataBar.tsx`, `src/components/terminal/Terminal.tsx`

1. Delete dead `session/TabBar.tsx` (zero imports; `FolderTabBar` is the real tab bar).
2. FolderTabBar: add `subagent` (violet) dot state; read live status via
   `useSessionContext().getAgentActivityStatus` instead of the possibly-stale
   `session.agentActivityStatus` field; keep mapping aligned with `sessionIconColor`.
3. Light-mode contrast pass: status colors + metadata chips get `*-600 dark:*-400/500`
   pairs (PR chips, ahead/behind arrows, dirty count, port chips, dep colors).
4. Drag-drop overlay tint → `--signal-attention` token (single chromatic accent rule).
   Recording dot + takeover pill intentionally unchanged (they float over the terminal
   canvas, which is theme-independent).

## Ship & merge

- Implementation agents: worktree-isolated, commit only (no push/PR), no changes to
  CHANGELOG.md / .beads/ / package.json.
- Ship-it agents: review full diff, fix findings, typecheck+lint+tests, push, `gh pr create`.
- Merge sequentially (B → C → A by size), rebase on conflicts, final verify on master.
- Final docs PR: CHANGELOG.md `[Unreleased]` entries + this plan marked shipped.
- bd issues track each worktree; close on merge.
