/**
 * [remote-dev-ipbo] 3-tier working-directory resolution for WS terminal
 * connections: client query → owning session row's project_path → home.
 *
 * The WS attach handler previously passed `undefined` through to
 * `tmux new-session` whenever the client omitted `?cwd=` — tmux then fell back
 * to the tmux SERVER daemon's own cwd, which a blue/green deploy can have
 * deleted out from under it (panes born in a dead inode). This resolver
 * guarantees a validated, always-present cwd string so `-c` is ALWAYS passed,
 * and reports which tier won (plus why higher tiers were rejected) so the
 * caller can log/banner the fallback instead of it being silent.
 *
 * Extracted from terminal.ts (same pattern as validate-cwd.ts) so it's
 * unit-testable without pulling in node-pty.
 */
import { validatePathWithReason, type CwdRejectedReason } from "./validate-cwd.js";

/** Which fallback tier supplied the working directory. */
export type ResolvedCwdTier = "query" | "session-row" | "home";

export interface ResolvedSessionCwd {
  /** Validated directory to pass to `tmux new-session -c`. Never empty. */
  cwd: string;
  tier: ResolvedCwdTier;
  /** Set when a non-empty query cwd was provided but rejected. */
  queryRejectedReason?: CwdRejectedReason;
  /** Set when a non-empty row project_path existed but was rejected. */
  rowRejectedReason?: CwdRejectedReason;
}

/**
 * [remote-dev-ipbo] Map the WS connect-time ownership-lookup row to the tier-2
 * (`rowProjectPath`) argument of {@link resolveSessionCwd}.
 *
 * The connect handler widened its ownership lookup to also select
 * `project_path` purely to feed tier 2. This mapping is trivially small, but
 * extracting it here pins the step with unit tests (terminal.ts itself cannot
 * be exercised without node-pty): no row (the session-creation path) and a row
 * whose `project_path` column is NULL both yield null, and a populated column
 * passes through untouched.
 */
export function rowProjectPathForCwd(
  owningRow: { projectPath: string | null } | null | undefined,
): string | null {
  return owningRow?.projectPath ?? null;
}

/**
 * Resolve the working directory for a new tmux session.
 *
 * Tier 1: the client-supplied `?cwd=` query value (validated).
 * Tier 2: the owning terminal_session row's project_path (validated) — covers
 *         clients that omit `?cwd=` entirely (the silent-absence class).
 * Tier 3: `homedir` (validated), else `"/"` — both always exist.
 */
export function resolveSessionCwd(
  rawQueryCwd: string | undefined,
  rowProjectPath: string | null | undefined,
  homedir: string,
): ResolvedSessionCwd {
  const query = validatePathWithReason(rawQueryCwd);
  if (query.path) {
    return { cwd: query.path, tier: "query" };
  }

  const row = validatePathWithReason(rowProjectPath ?? undefined);
  if (row.path) {
    return {
      cwd: row.path,
      tier: "session-row",
      queryRejectedReason: query.rejectedReason,
    };
  }

  const home = validatePathWithReason(homedir || undefined);
  return {
    cwd: home.path ?? "/",
    tier: "home",
    queryRejectedReason: query.rejectedReason,
    rowRejectedReason: row.rejectedReason,
  };
}
