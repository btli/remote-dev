/**
 * CrownDiffCollector — per-candidate `git diff` collection + filtering (epic
 * remote-dev-oyej.5). Drops lockfiles / `node_modules` / binary hunks and
 * truncates oversize diffs so the judge sees a focused, bounded patch.
 *
 * Uses the safe `execFile` helper (no shell) against each candidate's worktree.
 */
import { execFile } from "@/lib/exec";
import { createLogger } from "@/lib/logger";
import type { CrownDiffStats } from "@/types/crown";

const log = createLogger("CrownDiff");

/** Hard cap on stored/judged diff size (~64KB). */
export const MAX_DIFF_BYTES = 64 * 1024;

/** Path globs whose hunks are dropped before the diff reaches the judge. */
const EXCLUDE_PATHSPECS = [
  ":(exclude)**/*.lock",
  ":(exclude)**/bun.lockb",
  ":(exclude)**/package-lock.json",
  ":(exclude)**/yarn.lock",
  ":(exclude)**/pnpm-lock.yaml",
  ":(exclude)**/Cargo.lock",
  ":(exclude)**/node_modules/**",
  ":(exclude)**/.next/**",
  ":(exclude)**/dist/**",
];

export interface CollectedDiff {
  diff: string;
  stats: CrownDiffStats;
  truncated: boolean;
}

/**
 * Filter a raw unified diff: drop hunks for binary files and truncate to
 * {@link MAX_DIFF_BYTES}. (Pathspec exclusion is applied at the `git diff` call;
 * this is the in-memory belt-and-suspenders pass for binaries + size.) Pure.
 */
export function filterDiff(raw: string): { diff: string; truncated: boolean } {
  // Drop "Binary files a/x and b/y differ" file sections — keep it textual.
  const lines = raw.split("\n");
  const kept: string[] = [];
  let skippingBinary = false;
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      skippingBinary = false;
    }
    if (line.startsWith("Binary files ") && line.endsWith("differ")) {
      // Drop this marker line; the surrounding diff header stays harmless.
      skippingBinary = true;
      continue;
    }
    if (skippingBinary) continue;
    kept.push(line);
  }
  let diff = kept.join("\n");
  let truncated = false;
  if (Buffer.byteLength(diff, "utf-8") > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES);
    diff += "\n\n[... diff truncated ...]";
    truncated = true;
  }
  return { diff, truncated };
}

/** Parse `git diff --numstat` (excluded paths already applied) into stats. */
export function parseNumstat(numstat: string): CrownDiffStats {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [add, del] = trimmed.split(/\s+/);
    files += 1;
    // Binary files show "-" for counts; treat as 0.
    if (add !== "-") additions += Number(add) || 0;
    if (del !== "-") deletions += Number(del) || 0;
  }
  return { files, additions, deletions };
}

/**
 * Collect a filtered diff for a candidate branch vs its base. Runs
 * `git diff <base>...<branch>` (three-dot: changes on the branch since it
 * diverged) with lockfile/build-output pathspecs excluded.
 */
export async function collectDiff(
  worktreePath: string,
  branch: string,
  baseBranch: string,
): Promise<CollectedDiff> {
  const range = `${baseBranch}...${branch}`;
  try {
    const [diffRes, statRes] = await Promise.all([
      execFile(
        "git",
        ["diff", range, "--", ".", ...EXCLUDE_PATHSPECS],
        { cwd: worktreePath, timeout: 30_000 },
      ),
      execFile(
        "git",
        ["diff", "--numstat", range, "--", ".", ...EXCLUDE_PATHSPECS],
        { cwd: worktreePath, timeout: 30_000 },
      ),
    ]);
    const { diff, truncated } = filterDiff(diffRes.stdout);
    const stats = parseNumstat(statRes.stdout);
    return { diff, stats, truncated };
  } catch (err) {
    log.warn("crown diff collection failed", {
      worktreePath,
      branch,
      error: String(err),
    });
    return { diff: "", stats: { files: 0, additions: 0, deletions: 0 }, truncated: false };
  }
}
