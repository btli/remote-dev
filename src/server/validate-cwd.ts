/**
 * Working-directory validation for new terminal sessions.
 *
 * Canonicalizes a requested cwd (neutralizing .., ., duplicate slashes) and
 * verifies the directory exists before it's handed to `tmux new-session -c`.
 * A missing/invalid path falls back to the shell's default start dir (with a
 * warning) rather than aborting session creation — but the REASON is reported
 * so the caller can surface user-facing feedback (a server-side warn alone gave
 * the user no signal that their configured dir was silently ignored).
 *
 * We intentionally do NOT restrict to $HOME: instance/container workspaces
 * routinely live outside the server's HOME (which may also be unset), and a
 * terminal already grants full shell access, so a cwd allowlist would add no
 * security — only the silent "starts in home" breakage this avoids.
 *
 * Extracted from terminal.ts so it's unit-testable without pulling in node-pty.
 */
import * as fs from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("Terminal");

/** Why a requested working directory was rejected (for user-facing feedback). */
export type CwdRejectedReason = "not-absolute" | "missing" | "not-dir";

export interface ValidatedPath {
  /** Canonicalized directory to pass to tmux, or undefined to use the default. */
  path: string | undefined;
  /** Set only when a non-empty path was provided but could not be used. */
  rejectedReason?: CwdRejectedReason;
}

/**
 * Validate a working directory and report WHY it was rejected (if it was).
 */
export function validatePathWithReason(path: string | undefined): ValidatedPath {
  if (!path) return { path: undefined };

  // Must be an absolute path
  if (!path.startsWith("/")) {
    log.warn("Ignoring non-absolute working directory", { path });
    return { path: undefined, rejectedReason: "not-absolute" };
  }

  // Canonicalize (collapses .., ., duplicate slashes) — neutralizes traversal.
  const resolved = pathResolve(path);

  // statSync follows symlinks, so a symlink to a directory is accepted (desired
  // for worktree/workspace layouts). Missing or non-directory → fall back.
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      log.warn("Working directory is not a directory; using default start dir", { path: resolved });
      return { path: undefined, rejectedReason: "not-dir" };
    }
  } catch {
    log.warn("Working directory does not exist; using default start dir", { path: resolved });
    return { path: undefined, rejectedReason: "missing" };
  }

  return { path: resolved };
}

/** Convenience wrapper that returns only the usable path (or undefined). */
export function validatePath(path: string | undefined): string | undefined {
  return validatePathWithReason(path).path;
}

/**
 * Matches C0 controls (0x00–0x1F), DEL (0x7F), and C1 controls (0x80–0x9F).
 *
 * Built via `new RegExp(String.fromCharCode(...))` rather than a regex literal
 * so the source contains NO literal control characters — that keeps the
 * `no-control-regex` lint rule satisfied without an eslint-disable (the rule
 * only inspects literal control bytes in the pattern source).
 */
const CONTROL_CHAR_RE = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(0x1f)}` +
    `${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  "g"
);

/**
 * Strip control characters (C0, DEL, C1) and cap length so an
 * attacker-supplied path can't inject ANSI/OSC sequences when echoed into
 * an xterm terminal. Used by the "working directory not found" banner.
 *
 * `cwd` arrives from the WebSocket query string; xterm.js interprets ESC /
 * OSC / CSI bytes, so a crafted value (e.g. `\x1b]0;…\x07` to retitle the
 * window, or `\x1b[2J` to clear the screen) would otherwise be rendered as
 * control codes rather than shown literally. Replacing each control byte with
 * `?` neutralizes the sequence while keeping the path readable.
 */
export function sanitizeCwdForDisplay(raw: string): string {
  return raw.replace(CONTROL_CHAR_RE, "?").slice(0, 256);
}
