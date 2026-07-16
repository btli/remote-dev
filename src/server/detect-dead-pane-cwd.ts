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

export interface ClassifyPaneCwdOptions {
  /** Existence probe — must throw when the path cannot be stat'ed. */
  statFn: (path: string) => void;
  /**
   * Absolute paths that identify the server's own application directory
   * (e.g. process.cwd() and `<process.cwd()>/.next/standalone`). A pane
   * whose cwd equals one of these was born from a poisoned daemon even when
   * the directory exists (deploys re-create it).
   */
  serverAppDirMarkers: string[];
}

/** Classify a pane's cwd + foreground command (from tmux display-message). */
export function classifyPaneCwd(
  paneCurrentPath: string,
  paneCurrentCommand: string,
  options: ClassifyPaneCwdOptions,
): PaneCwdClassification {
  let broken = false;
  let reason: PaneCwdBrokenReason | null = null;

  if (!paneCurrentPath) {
    broken = true;
    reason = "stat-failed";
  } else {
    const resolved = pathResolve(paneCurrentPath);
    const markers = options.serverAppDirMarkers.map((m) => pathResolve(m));
    if (resolved.endsWith("/.next/standalone") || markers.includes(resolved)) {
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
