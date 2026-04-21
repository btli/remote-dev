# Phase G — Cleanup (Delete Legacy folderTree from Sidebar.tsx)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.7` (depends on `remote-dev-oqol.4`, `.5`, `.6`)

**Goal:** Remove the legacy folder-tree rendering path from `Sidebar.tsx` (~800 lines, `~1440-2250`), drop the now-unused folder state/handlers, and update documentation. After this phase, only the new `ProjectTreeSidebar` renders the tree.

**Architecture:** `Sidebar.tsx` keeps its header (collapse toggle, new-folder/new-session buttons, resize handle), footer (profiles/ports/trash buttons), and collapsed-mode sidebar shell. Everything tree-related is delegated to `<ProjectTreeSidebar />`.

**Exit criteria:** `Sidebar.tsx` no longer imports `SessionFolder`, `FolderNode`, folder drag/drop handlers, or legacy session-render helpers. `bun run typecheck`, `bun run test:run`, `bun run lint` all clean. Sidebar visually identical to Phases A–F but with only one tree.

---

## Task G0 (prereq): Visual parity verification

Before deleting 800 lines, manually verify in the browser that the new `ProjectTreeSidebar` rendered above the legacy tree looks and behaves the same.

Spin up `bun run dev` and walk through:

- [ ] Group expand/collapse works (new tree)
- [ ] Project session list renders (new tree)
- [ ] Repo stats badges appear (new tree)
- [ ] Context menu items all work (new tree)
- [ ] Drag/drop works in all 3 modes (new tree)
- [ ] Mobile swipe works (new tree)
- [ ] Inline rename works (new tree)
- [ ] Inline create works (new tree)
- [ ] Active-node highlight matches legacy

Capture a screenshot for the PR description. Do not commit.

---

## Task G1: Delete legacy folderTree rendering block

**File:** `src/components/session/Sidebar.tsx`

Regions to delete (approximate line ranges; let git blame and the plan's inventory guide you):

1. **Imports no longer needed** (top of file): `SessionFolder`, `FolderNode`
2. **Helper `folderTree` useMemo** (lines ~395-430)
3. **Folder drag handlers** (lines ~574-910):
   - `handleFolderDragStart`
   - `handleFolderDragOver`
   - `handleFolderDrop`
   - `handleFolderTouchStart/Move/End`
   - `initiateTouchDrag`
   - `isDescendantOf`
4. **Session drag handlers** (lines ~574-1068):
   - `handleSessionDragStart/DragOver/Drop`
   - `handleDragStart/Over/Leave/Drop` (if folder-aware)
5. **Legacy editing helpers**: `handleStartEdit`, `handleSaveEdit`, `handleCancelEdit` — but only if they're folder-specific. If session-rename still needs them (Sidebar.tsx owns the onSessionRename handler), leave the session path intact.
6. **New-folder inline input** (lines ~1698-1719) — replaced by inline-create in the new tree
7. **Legacy tree rendering block** (lines ~1740-2250):
   - `folderTree.map(...)`
   - `renderFolderNode` / `renderSession` / `renderSessionsWithSplits` / `countSessionsRecursively` / `getRolledUpStats`
   - All folder ContextMenu JSX
   - All session ContextMenu JSX (unless sessions are rendered outside the tree — verify pinned-root-sessions section stays if it's outside the tree)
8. **Root-pinned / root-unpinned session blocks** (lines ~1722-1725, 2253-2256) — these render sessions with `projectId == null`. In the new model, all sessions must have a projectId. If any root-level sessions still exist in the DB, they need a migration or a displayed warning. **Decision:** file a bd follow-up to backfill any remaining root sessions into an "(Unassigned)" project; for Phase G, assume zero root sessions (covered by Phase 1/2 of prior refactor, but verify with a one-time SQL check).

**Step 1: SQL sanity check** — `SELECT COUNT(*) FROM terminal_session WHERE project_id IS NULL AND status != 'closed'` must return 0. If not 0, block Phase G and file the migration issue.

- [ ] **Step 2: Delete props from Sidebar interface**

Remove from the `SidebarProps` interface:
- `folders`, `onFolderCreate`, `onFolderDelete`, `onFolderToggle`, `onFolderClick`, `onFolderSettings`, `onFolderReorder`, `onFolderMove`
- `onFolderNewSession`, `onFolderNewAgent`, `onFolderNewWorktree`, `onFolderAdvancedSession`, `onFolderResumeClaudeSession`
- `getFolderRepoStats`, `folderHasPreferences`, `folderHasRepo`
- `onEmptyTrash`
- Keep: `onOpenNodePreferences`, `onQuickNewSession`, `onNewAgent`, `onNewSession`, plus everything non-tree-related

Or — recommended — rename `onFolder*` → `onProject*` where the semantic is still needed (e.g., `onProjectNewSession` replaces `onFolderNewSession`), and pass these to `ProjectTreeSidebar`.

- [ ] **Step 3: Delete body**

Delete the regions listed above. Use `git diff --stat` after to confirm you removed ~800 lines.

- [ ] **Step 4: Update `src/components/session/SessionManager.tsx`**

Remove props that are no longer passed. Wire any remaining handlers (`onProjectNewSession`, etc.) through the new `ProjectTreeSidebar` props.

Update this file's tests if any (`tests/components/session/SessionManager.test.tsx` — check existence).

- [ ] **Step 5: Run gates**

```
bun run typecheck
bun run test:run
bun run lint
```

Fix typecheck errors one at a time. If a test fails because it was targeting legacy DOM, update the test to target the new `ProjectTreeSidebar` DOM.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(sidebar): delete legacy folderTree block — ProjectTreeSidebar now owns rendering"
```

---

## Task G2: Drop folder state from PreferencesContext

Check for remaining consumers:

```bash
grep -rn "folderPreferences\|foldersMap\|setFolders\|useState<Map<string, FolderWithAncestry>>" src/
```

If zero consumers remain, delete:
- `folders` state + `setFolders` call
- `folderPreferences` state (if also unused)
- Their entries in the context value object + `ProjectTreeContextValue`-equivalent type

If consumers still exist, file a bd follow-up issue listing each caller and defer.

- [ ] **Commit (if dropped)**

```bash
git commit -m "refactor(preferences): drop unused folders/folderPreferences state"
```

---

## Task G3: Delete orphaned types

**Files:**
- `src/types/session.ts` (or wherever `SessionFolder` lives) — delete `SessionFolder` type if unused
- Any other orphan types surfaced by typecheck

```bash
grep -rn "SessionFolder\b\|FolderNode\b" src/
```

- [ ] **Delete unused types; run typecheck; commit**

```bash
git commit -m "chore(types): drop SessionFolder and FolderNode after tree migration"
```

---

## Task G4: Update CHANGELOG

Add under `[Unreleased] / Changed` in `CHANGELOG.md`:

```markdown
- Migrated the Sidebar project tree from the legacy folder-based renderer to
  the new group/project-aware `ProjectTreeSidebar`. Drops ~800 lines of
  duplicated rendering in `Sidebar.tsx` while preserving drag/drop, context
  menus, repo stats rollup, inline editing, and mobile touch gestures.
```

Also consider an entry under `Removed` listing the retired types/handlers.

- [ ] **Commit**

```bash
git commit -m "docs(changelog): note project-tree feature-parity migration"
```

---

## Task G5: Final verification

- [ ] `bun run typecheck` — clean (baseline)
- [ ] `bun run test:run` — all tests pass
- [ ] `bun run lint` — clean
- [ ] `bun run build` — succeeds
- [ ] Visual smoke in `bun run dev` — verify the Projects screenshot the user flagged now shows a single tree with full features

If all green:

- [ ] Close master bd issue `remote-dev-oqol`.

---

## Acceptance Criteria

- [ ] `Sidebar.tsx` line count reduced by ~800
- [ ] No references to `folderTree`, `SessionFolder`, `FolderNode`, folder drag handlers
- [ ] All previously-passing tests still pass
- [ ] New tree renders with full parity (verified in Task G0)
- [ ] CHANGELOG updated
- [ ] Single tree visible in the sidebar (no duplication)

## Risks / Open Questions

- **Root-level sessions:** if `project_id IS NULL` count > 0, Phase G must block on a backfill migration. File immediately as a blocker.
- **Test breakage avalanche:** deleting 800 lines at once may cascade into many test failures. If more than 10 tests break, consider splitting Phase G into "delete JSX" and "delete props" sub-commits so each is independently bisectable.
- **Header / footer / collapsed-mode regressions:** these were *not* touched by Phases A–F. Run a targeted manual check that the collapsed sidebar, resize handle, and footer buttons still work after Phase G deletions.
- **SessionManager prop signature churn:** G1 renames `onFolder*` to `onProject*`. Downstream callers (if any) need updates. Check `grep -n "onFolderNewSession\|onFolderNewAgent" src/`.
