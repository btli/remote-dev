/**
 * Pure resolution of the project a one-click ("Quick Terminal" / "New Agent")
 * session should launch into (remote-dev-bxcn).
 *
 * Extracted from `SessionManager` so the first-run fallback is unit-testable
 * without mounting the whole component. The decision:
 *
 *  - If a project is already active, use it (existing behavior, unchanged).
 *  - Otherwise fall back to the FIRST available project — the brand-new-instance
 *    case where the user has logged in but not clicked a project yet. The caller
 *    selects that project (so preference resolution + the tree highlight follow)
 *    and passes it as the session's `projectId`, satisfying the NOT-NULL
 *    `terminal_session.project_id` guard.
 *  - If there are genuinely zero projects, return `undefined` and let the
 *    downstream guard report it cleanly rather than inventing a project.
 */

/** Minimal shape of a project node needed to pick a fallback. */
export interface QuickSessionProject {
  id: string;
}

export interface ResolveQuickSessionFolderInput {
  /** The currently-active project id, or null/undefined when none is active. */
  activeFolderId: string | null | undefined;
  /** Available projects, in display order (index 0 is the first). */
  projects: readonly QuickSessionProject[];
}

export interface ResolveQuickSessionFolderResult {
  /** The project id to launch into, or undefined when none can be resolved. */
  folderId: string | undefined;
  /**
   * The project id the caller should newly SELECT (because nothing was active
   * and we fell back to the first project), or null when selection shouldn't
   * change (a project was already active, or there are no projects).
   */
  selectFolderId: string | null;
}

/**
 * Resolve the quick-session target project. Pure: returns both the project to
 * use and whether the caller should change the active selection.
 */
export function resolveQuickSessionFolder(
  input: ResolveQuickSessionFolderInput
): ResolveQuickSessionFolderResult {
  if (input.activeFolderId) {
    // A project is already active — use it, don't change selection.
    return { folderId: input.activeFolderId, selectFolderId: null };
  }
  const firstProjectId = input.projects[0]?.id;
  if (firstProjectId) {
    // Nothing active yet → fall back to the first project AND select it.
    return { folderId: firstProjectId, selectFolderId: firstProjectId };
  }
  // No projects at all → resolve to nothing; the downstream guard handles it.
  return { folderId: undefined, selectFolderId: null };
}
