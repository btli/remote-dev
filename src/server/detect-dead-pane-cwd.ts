/**
 * [remote-dev-ipbo] Classify a tmux pane's current working directory as
 * healthy or broken, for the attach-time dead-pane audit in terminal.ts.
 *
 * A pane is "broken" when it sits in a directory that either no longer exists
 * (stat fails) or is the server's own application directory — the signature of
 * the deploy incident: a poisoned tmux daemon births panes inside
 * `.next/standalone`, and because blue/green REBUILDS that directory, a plain
 * existence check passes on the incident pane. The marker comparison is
 * therefore load-bearing: it flags panes parked in the (re-created) server app
 * dir even though stat succeeds.
 *
 * Two guards keep the audit from false-positives on healthy panes:
 * - The server's `process.cwd()` is NOT itself a marker unless it is a
 *   `.next/standalone` dir (see {@link computeServerAppDirMarkers}) — the
 *   terminal server runs from the repo checkout, which is simultaneously a
 *   legitimate user project when dogfooding remote-dev inside remote-dev.
 * - A pane sitting exactly at its own session row's project path is healthy by
 *   definition (incident panes sit in the server app dir, never at their row's
 *   path), and paths UNDER the project are exempt from the bare
 *   `.next/standalone` suffix rule so a user inspecting their own standalone
 *   build isn't "healed" out of it.
 *
 * Healing (typed `cd`) is only safe when the pane's foreground process is a
 * plain shell — typing into vim/claude/etc. would corrupt their input.
 *
 * Pure module (fs access injected) so it's unit-testable without node-pty.
 */
import { resolve as pathResolve } from "node:path";

/** Why a pane cwd was classified broken. */
export type PaneCwdBrokenReason = "stat-failed" | "in-server-app-dir";

export interface PaneCwdClassification {
  broken: boolean;
  reason: PaneCwdBrokenReason | null;
  /** Broken AND the foreground process is a plain shell a typed `cd` can heal. */
  healable: boolean;
}

/**
 * Foreground commands a typed `cd` heal is safe for. tmux reports login shells
 * with a leading dash (e.g. "-zsh").
 */
const HEALABLE_SHELL_COMMANDS = new Set([
  "zsh",
  "bash",
  "sh",
  "fish",
  "-zsh",
  "-bash",
  "-sh",
]);

/**
 * Derive the server-app-dir markers from the server process's cwd.
 *
 * The dangerous directory is the deploy-rebuilt `.next/standalone` — NOT the
 * checkout itself. The terminal server's cwd is normally the repo checkout
 * (`bun tsx src/server/index.ts` in prod and dev), which on a dogfooding
 * instance is ALSO a legitimate user project; treating it as a marker would
 * flag every healthy pane parked at the repo root and type `cd` into the
 * user's shell on reconnect. So `processCwd` itself is only a marker when it
 * IS a `.next/standalone` dir; otherwise the marker is the standalone dir
 * nested inside it.
 */
export function computeServerAppDirMarkers(processCwd: string): string[] {
  const resolved = pathResolve(processCwd);
  if (resolved.endsWith("/.next/standalone")) {
    return [resolved];
  }
  return [pathResolve(resolved, ".next/standalone")];
}

export interface ClassifyPaneCwdOptions {
  /** Existence probe — must throw when the path cannot be stat'ed. */
  statFn: (path: string) => void;
  /**
   * Absolute paths that identify the server's own application directory
   * (from {@link computeServerAppDirMarkers}). A pane whose cwd equals one of
   * these was born from a poisoned daemon even when the directory exists
   * (deploys re-create it).
   */
  serverAppDirMarkers: string[];
  /**
   * The owning session row's VALIDATED project path (caller must have
   * confirmed it exists), if any. A pane sitting exactly here is healthy by
   * definition; descendants are exempt from the bare `.next/standalone`
   * suffix rule (markers still apply).
   */
  sessionProjectPath?: string;
}

/** Classify a pane's cwd + foreground command (from tmux display-message). */
export function classifyPaneCwd(
  paneCurrentPath: string,
  paneCurrentCommand: string,
  options: ClassifyPaneCwdOptions,
): PaneCwdClassification {
  let broken = false;
  let reason: PaneCwdBrokenReason | null = null;

  const projectRoot = options.sessionProjectPath
    ? pathResolve(options.sessionProjectPath)
    : undefined;

  if (!paneCurrentPath) {
    broken = true;
    reason = "stat-failed";
  } else {
    const resolved = pathResolve(paneCurrentPath);
    const markers = options.serverAppDirMarkers.map((m) => pathResolve(m));
    const underProject =
      projectRoot !== undefined &&
      resolved.startsWith(projectRoot === "/" ? "/" : `${projectRoot}/`);

    if (projectRoot !== undefined && resolved === projectRoot) {
      // A pane exactly where its session row says it belongs is healthy by
      // definition (the caller validated the path exists). Incident panes sit
      // in the server app dir, never at their row's project path.
    } else if (
      markers.includes(resolved) ||
      (resolved.endsWith("/.next/standalone") && !underProject)
    ) {
      broken = true;
      reason = "in-server-app-dir";
    } else {
      try {
        options.statFn(resolved);
      } catch {
        broken = true;
        reason = "stat-failed";
      }
    }
  }

  return {
    broken,
    reason,
    healable: broken && HEALABLE_SHELL_COMMANDS.has(paneCurrentCommand),
  };
}
