import { existsSync, rmSync, mkdirSync, cpSync } from "fs";
import { dirname, join } from "path";

/** SSR page routes probed by the deploy/rollback health gate. */
export const SSR_PROBE_PATHS = ["/", "/login"] as const;

/**
 * Whether an HTTP status from an SSR probe of `path` is acceptable.
 *
 * The local health check otherwise only exercises `/api/*`, so a build whose
 * SSR/middleware path is broken (e.g. a proxy redirect that 500s page routes —
 * the 2026-06-03 incident) passes on the API probe alone. These page probes
 * close that gap:
 *   "/"      → an unauthenticated request redirects to /login, so 2xx/3xx is
 *              healthy; any 4xx/5xx means routing or the proxy redirect broke.
 *   "/login" → an always-rendering SSR page; must be exactly 200.
 */
export function isAcceptableSsrStatus(path: string, status: number): boolean {
  if (path === "/login") return status === 200;
  return status >= 200 && status < 400;
}

/**
 * Restore a slot's standalone build over the live serving directory.
 *
 * The prod server runs from `PROJECT_ROOT/.next/standalone`; a failed deploy
 * leaves the NEW (broken) build there. Rollback MUST copy the target slot's
 * known-good snapshot back BEFORE restarting, otherwise the restart re-serves
 * the broken build (remote-dev-j0x5). The slot's standalone already contains
 * `.next/static` + `public` (buildSlot populates them), so a single recursive
 * copy is complete.
 */
export function restoreStandalone(
  srcSlotStandalone: string,
  liveStandalone: string,
): { ok: boolean; reason?: string } {
  if (!existsSync(srcSlotStandalone)) {
    return { ok: false, reason: `slot standalone not found: ${srcSlotStandalone}` };
  }
  if (existsSync(liveStandalone)) {
    rmSync(liveStandalone, { recursive: true, force: true });
  }
  mkdirSync(dirname(liveStandalone), { recursive: true });
  cpSync(srcSlotStandalone, liveStandalone, { recursive: true });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Isolated deploy source worktree (remote-dev-yxvy)
//
// Deploys used to build directly in PROJECT_ROOT — the LIVE dev + agent working
// tree — doing `git reset --hard origin/master` there, which silently WIPED any
// uncommitted/staged/untracked work a developer or agent had in progress. The fix
// is to build from a deploy-OWNED, persistent detached worktree pinned to
// origin/master that lives OUTSIDE the repo (so no .gitignore entry is needed and
// PROJECT_ROOT's source is never touched). The helpers below are pure so they can
// be unit-tested without running a real deploy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The deploy-owned source worktree path, under the deploy data dir.
 *
 * Lives OUTSIDE PROJECT_ROOT (it's a sibling under `~/.remote-dev/deploy-src`) so
 * that the hard reset we run to pin it to origin/master can NEVER touch the live
 * working tree, and so nothing needs to be added to `.gitignore`.
 */
export function deploySourceDir(dataDir: string): string {
  return join(dataDir, "deploy-src");
}

/**
 * Ordered git command argv arrays to materialize/refresh the deploy source
 * worktree, given whether it already exists.
 *
 * - `firstCreate === true`: the worktree does not exist yet. We `git fetch origin`
 *   in PROJECT_ROOT, then `git worktree add --detach <deploySrc> origin/master`
 *   from PROJECT_ROOT (the worktree's git dir is owned by PROJECT_ROOT's repo).
 * - `firstCreate === false`: the worktree already exists. We fetch + hard-reset
 *   it to origin/master IN the worktree itself (`git -C <deploySrc> …`). This
 *   reset is safe — it's the deploy's OWN detached tree, not PROJECT_ROOT —
 *   so no dev/agent work is ever at risk.
 *
 * The ancestry/divergence guard is NOT part of these argv arrays; it is a
 * separate decision (see `ancestryGuardDecision`) so it can be tested in
 * isolation and applied between the fetch and the reset.
 */
export function gitSyncCommands(
  projectRoot: string,
  deploySrc: string,
  firstCreate: boolean,
): string[][] {
  if (firstCreate) {
    return [
      ["git", "-C", projectRoot, "fetch", "origin"],
      ["git", "-C", projectRoot, "worktree", "add", "--detach", deploySrc, "origin/master"],
    ];
  }
  return [
    ["git", "-C", deploySrc, "fetch", "origin"],
    ["git", "-C", deploySrc, "reset", "--hard", "origin/master"],
  ];
}

/**
 * Decision derived from the exit code of
 * `git merge-base --is-ancestor HEAD origin/master`.
 *
 * Mirrors the original buildSlot branching so the "diverged vs git-error"
 * distinction is preserved (and now testable):
 *   - exit 0   → HEAD is an ancestor of origin/master (fast-forwardable or equal):
 *                proceed.
 *   - exit 1   → HEAD has diverged (local commits not on origin): refuse, a hard
 *                reset would silently lose them.
 *   - other    → a git error (typically 128 — e.g. origin/master ref missing after
 *                a bad fetch): refuse and surface the error.
 *
 * For the deploy source worktree this guard is trivially satisfied (it's detached
 * at origin/master, so HEAD never diverges), but we keep + test it so the
 * "only ever build origin/master" safety property is explicit and preserved.
 */
export type AncestryDecision = "proceed" | "diverged" | "git-error";

export function ancestryGuardDecision(exitCode: number): AncestryDecision {
  if (exitCode === 0) return "proceed";
  if (exitCode === 1) return "diverged";
  return "git-error";
}

// ─────────────────────────────────────────────────────────────────────────────
// Native-module ABI rebuild (remote-dev-7wgn)
//
// Prod runs `next-server` under /opt/homebrew/bin/node (Homebrew Node, currently
// v26 / NODE_MODULE_VERSION 147). The app's logging/analytics sidecars use the
// `better-sqlite3` NATIVE addon. bun installs a prebuilt binary; if Homebrew
// silently bumps Node's ABI (as happened 141→147), that prebuilt binary no
// longer loads and logs.db writes silently die (the logger swallows the error).
// To keep the ABI in lockstep we rebuild the addon FROM SOURCE against the exact
// runtime Node, in DEPLOY_SRC, BEFORE `bun run build` — so Next's standalone
// trace copies the correctly-built `.node` into the served bundle.
// ─────────────────────────────────────────────────────────────────────────────

/** Native packages rebuilt from source against the runtime Node on each deploy. */
export const NATIVE_MODULES_TO_REBUILD = ["better-sqlite3"] as const;

/**
 * The argv to rebuild the given native modules from source via npm. `npm rebuild`
 * correctly resolves bun's isolated node_modules layout (it walks the installed
 * tree) and `--build-from-source` forces a real compile against the headers of
 * whatever `node` is first on PATH — so the caller MUST invoke this with the
 * RUNTIME node (the one that runs next-server) ahead of any others on PATH.
 * `--foreground-scripts` surfaces compiler output into the captured stdout/stderr
 * so a failed compile is diagnosable from the deploy log.
 *
 * Pure (returns argv only) so it is unit-testable without spawning a toolchain.
 */
export function nativeRebuildCommand(
  modules: readonly string[] = NATIVE_MODULES_TO_REBUILD,
): string[] {
  return [
    "npm",
    "rebuild",
    ...modules,
    "--build-from-source",
    "--foreground-scripts",
  ];
}

/**
 * Compute the PATH that puts the runtime Node's directory FIRST, so `npm rebuild`
 * compiles against the runtime Node's headers rather than whatever `node` bun or
 * the deploy shell would otherwise resolve. Given the absolute path to the
 * runtime node binary and the current PATH, returns a new PATH with the binary's
 * directory prepended (de-duplicated if already leading). Pure/testable.
 *
 * @param runtimeNodePath absolute path to the runtime node (e.g. /opt/homebrew/bin/node)
 * @param currentPath     the inherited PATH (process.env.PATH)
 * @param pathSeparator   the platform PATH list separator (Node `path.delimiter`)
 * @param dirOf           extracts a file's directory (inject `path.dirname` — keeps this pure)
 */
export function pathWithRuntimeNodeFirst(
  runtimeNodePath: string,
  currentPath: string,
  pathSeparator: string,
  dirOf: (p: string) => string,
): string {
  const binDir = dirOf(runtimeNodePath);
  const parts = currentPath ? currentPath.split(pathSeparator) : [];
  const deduped = parts.filter((p) => p !== binDir);
  return [binDir, ...deduped].join(pathSeparator);
}

/**
 * Defense-in-depth guard for self-healing a pruned/corrupt deploy-src: only a
 * path that is EXACTLY the derived `<dataDir>/deploy-src` may be recursively
 * removed. This stops a future refactor that mis-wires `DATA_DIR` (e.g. to `""`,
 * `/`, or `$HOME`) from ever deleting an unintended directory. The check is by
 * trailing path segment using the platform separator, so it holds regardless of
 * the data dir prefix.
 *
 * @param candidate     the path the caller is about to `rmSync(recursive)`
 * @param pathSeparator the platform path separator (Node `path.sep`)
 */
export function isSafeDeploySrcToRemove(candidate: string, pathSeparator: string): boolean {
  return candidate.endsWith(`${pathSeparator}deploy-src`);
}
