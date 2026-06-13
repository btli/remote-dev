/**
 * Beads CLI data layer.
 *
 * Reads bd (beads, https://github.com/steveyegge/beads) project data by shelling
 * out to the `bd` binary with `--json` / `export` rather than connecting to a
 * dolt SQL server over TCP. bd reads its data in-process and is mode-agnostic:
 * it works for projects in BOTH embedded mode (no server; data in
 * `.beads/embeddeddolt`) and server mode (transparently), so this avoids the
 * ECONNREFUSED failures embedded-mode projects hit with the old TCP path.
 *
 * Replaces the former `src/lib/beads-db.ts` (mysql2 + dolt server).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createLogger } from "@/lib/logger";

const log = createLogger("BeadsCli");
const execFileAsync = promisify(execFile);

/** Default per-invocation timeout. bd reads embedded dolt in-process, so this is generous. */
const DEFAULT_TIMEOUT_MS = 8000;
/** bd export of a large project can be several MB of JSONL; allow plenty of headroom. */
const MAX_BUFFER = 32 * 1024 * 1024;

/** Candidate absolute paths for the bd binary, in priority order. */
const BD_BIN_CANDIDATES = [
  "/opt/homebrew/bin/bd",
  "/usr/local/bin/bd",
  "/home/linuxbrew/.linuxbrew/bin/bd",
] as const;

/**
 * True when `id` is a safe beads issue id to forward to `bd` as an argv element.
 * Rejects empty, over-long, flag-like (leading `-`), and shell/space metachar
 * inputs — defense against argument-injection even though execFile uses no shell.
 */
export function isValidIssueId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

/**
 * Resolve the bd binary path. Honors `BEADS_BD_BIN`, then the first existing
 * well-known install location, finally falling back to `"bd"` (resolved via PATH).
 */
export function resolveBdBin(): string {
  const override = process.env.BEADS_BD_BIN;
  if (override) {
    if (!override.startsWith("/")) {
      log.warn("BEADS_BD_BIN is not an absolute path; resolving via CWD/PATH", { override });
    }
    return override;
  }
  for (const candidate of BD_BIN_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return "bd";
}

export interface RunBdOptions {
  timeoutMs?: number;
}

/**
 * Run `bd` against `projectPath` with the given args and return stdout.
 *
 * Always invokes via execFile with an argv ARRAY (never a shell string) so
 * `projectPath` and ids can't be interpreted by a shell — no injection surface.
 * Args are prefixed with `-C <projectPath>` (bd's `--directory` global flag).
 *
 * On spawn failure (ENOENT — bd missing), non-zero exit, or timeout, the
 * underlying error is thrown unchanged (preserving `.code` / `.killed` / `.signal`)
 * so `isBeadsUnavailable` can classify it.
 */
export async function runBd(
  projectPath: string,
  args: string[],
  opts?: RunBdOptions
): Promise<string> {
  const bin = resolveBdBin();
  const fullArgs = ["-C", projectPath, ...args];
  try {
    const { stdout } = await execFileAsync(bin, fullArgs, {
      timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    log.debug("bd invocation failed", {
      bin,
      args: args.join(" "),
      error: String(err),
    });
    throw err;
  }
}

/** Run bd and parse its stdout as a single JSON value of type `T`. */
export async function runBdJson<T>(
  projectPath: string,
  args: string[],
  opts?: RunBdOptions
): Promise<T> {
  const stdout = await runBd(projectPath, args, opts);
  return JSON.parse(stdout) as T;
}

/**
 * Parse JSONL (one JSON object per line) into an array of unknowns. Blank lines
 * are skipped. A malformed line throws (surfaced as a generic 500 by callers).
 */
export function parseJsonl(stdout: string): unknown[] {
  const out: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

/**
 * In-memory cache of `bd export` stdout per projectPath with a short TTL, to
 * coalesce the rapid bursts of polls the sidebar makes (issues + stats + a
 * detail open often fire within the same second). Staleness tradeoff: a write
 * made via bd in the last ~2s may not be reflected until the TTL lapses — an
 * acceptable delay for a read-only viewer that already polls on an interval.
 */
const EXPORT_CACHE_TTL_MS = 2000;
const exportCache = new Map<string, { stdout: string; at: number }>();

/**
 * Run `bd export` (JSONL of issues) with a short-TTL stdout cache. Plain
 * `bd export` carries full-fidelity regular issues — each record embeds its
 * dependency edges and comments, which `bd list` does NOT. It does not (and
 * cannot) emit message-type beads: those are ephemeral wisps stored in
 * `.beads/ephemeral.sqlite3`, not the dolt `issues` table, so `bd export`
 * never sees them even with `--include-infra`. Messages are fetched separately
 * via {@link runBdInfraListCached}. The service layer still filters the export
 * to a viewable-type allowlist.
 */
export async function runBdExportCached(
  projectPath: string,
  opts?: RunBdOptions
): Promise<string> {
  const cached = exportCache.get(projectPath);
  const now = Date.now();
  if (cached && now - cached.at < EXPORT_CACHE_TTL_MS) {
    return cached.stdout;
  }
  const stdout = await runBd(projectPath, ["export"], opts);
  if (exportCache.size > 256) exportCache.clear();
  exportCache.set(projectPath, { stdout, at: now });
  return stdout;
}

/**
 * In-memory cache of `bd list --include-infra` stdout per projectPath, mirroring
 * {@link exportCache}. Kept separate so the two polls (export + infra list)
 * cache independently. Same ~2s staleness tradeoff: a message bead created in
 * the last ~2s may not appear until the TTL lapses — acceptable for a read-only
 * viewer that already polls on an interval.
 */
const INFRA_LIST_CACHE_TTL_MS = 2000;
const infraListCache = new Map<string, { stdout: string; at: number }>();

/**
 * Run `bd list --include-infra -n 0 --json` (a single JSON array) with a
 * short-TTL stdout cache. This is the ONLY way to surface message-type beads —
 * inter-agent message wisps live in `.beads/ephemeral.sqlite3`, which `bd
 * export` can't read. `--include-infra` admits ephemeral/infra beads, `-n 0`
 * lifts the default 50-row cap (so messages aren't truncated), and the service
 * layer filters the result down to `issue_type === "message"`. Note `bd list`
 * records are lean (no embedded dependencies/comments), so it's used only for
 * messages, not as a replacement for the full export.
 */
export async function runBdInfraListCached(
  projectPath: string,
  opts?: RunBdOptions
): Promise<string> {
  const cached = infraListCache.get(projectPath);
  const now = Date.now();
  if (cached && now - cached.at < INFRA_LIST_CACHE_TTL_MS) {
    return cached.stdout;
  }
  const stdout = await runBd(
    projectPath,
    ["list", "--include-infra", "-n", "0", "--json"],
    opts
  );
  if (infraListCache.size > 256) infraListCache.clear();
  infraListCache.set(projectPath, { stdout, at: now });
  return stdout;
}

/** Numeric exit codes / message fragments that mean bd could not produce data. */
const TIMEOUT_MESSAGE_FRAGMENTS = ["ENOENT", "timed out"] as const;

/**
 * True when an error indicates bd could not produce data — bd missing (ENOENT),
 * a timeout (killed/signal or "ERR_CHILD_PROCESS"), or a non-zero exit. These
 * degrade to the `{ unavailable: true }` API response rather than a 500.
 *
 * Walks `code`, the `cause` chain, and `AggregateError.errors`, with a
 * message-text fallback. Replaces the old `isDoltUnavailable`.
 */
export function isBeadsUnavailable(err: unknown): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      // ENOENT = bd binary not found; ERR_CHILD_PROCESS = generic spawn failure;
      // ERR_CHILD_PROCESS_TIMED_OUT = execFile killed the child for exceeding `timeout`.
      if (
        code === "ENOENT" ||
        code === "ERR_CHILD_PROCESS" ||
        code === "ERR_CHILD_PROCESS_TIMED_OUT"
      ) {
        return true;
      }
    }
    // execFile sets `killed` + `signal` (e.g. SIGTERM) when it enforces `timeout`.
    if ((current as { killed?: unknown }).killed === true) return true;
    const signal = (current as { signal?: unknown }).signal;
    if (typeof signal === "string" && signal.length > 0) return true;
    // A non-zero numeric exit code means bd ran but failed to produce data.
    if (typeof code === "number" && code !== 0) return true;
    const cause = (current as { cause?: unknown }).cause;
    if (cause) stack.push(cause);
    if (current instanceof AggregateError) stack.push(...current.errors);
  }
  // Fallback: match the message text for errors that don't expose a usable code.
  const msg = String(err);
  for (const fragment of TIMEOUT_MESSAGE_FRAGMENTS) {
    if (msg.includes(fragment)) return true;
  }
  return false;
}
