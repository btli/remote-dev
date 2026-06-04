/**
 * [n6uc.6] Pure parser: raw `git diff` text → per-file entries with add/del
 * counts and typed hunk lines. No React, no I/O — unit-tested in isolation and
 * consumed by `SessionDiffViewer`.
 */

export type DiffLineType = "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffFileEntry {
  path: string;
  additions: number;
  deletions: number;
  /** True when the file is newly added (a `new file mode` header was seen). */
  isNew: boolean;
  /** True when the file is deleted (a `deleted file mode` header was seen). */
  isDeleted: boolean;
  lines: DiffLine[];
}

/** Parse raw `git diff` output into per-file entries with counts + hunk lines. */
export function parseUnifiedDiff(raw: string): DiffFileEntry[] {
  const files: DiffFileEntry[] = [];
  let current: DiffFileEntry | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      // Prefer the `b/<path>` side; fall back to the `a/<path>` side.
      const m = line.match(/ b\/(.+)$/) ?? line.match(/ a\/(.+?) b\//);
      current = {
        path: m ? m[1] : "unknown",
        additions: 0,
        deletions: 0,
        isNew: false,
        isDeleted: false,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file")) current.isNew = true;
    if (line.startsWith("deleted file")) current.isDeleted = true;

    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("@@") ||
      line.startsWith("similarity") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("Binary files")
    ) {
      current.lines.push({ type: "meta", text: line });
      continue;
    }

    if (line.startsWith("+")) {
      current.additions++;
      current.lines.push({ type: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.deletions++;
      current.lines.push({ type: "del", text: line.slice(1) });
    } else {
      current.lines.push({
        type: "ctx",
        text: line.startsWith(" ") ? line.slice(1) : line,
      });
    }
  }

  return files;
}
