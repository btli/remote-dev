"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { parseUnifiedDiff, type DiffFileEntry } from "./parseUnifiedDiff";
import { cn } from "@/lib/utils";

interface DiffPayload {
  raw: string;
  base: string | null;
  /** [n6uc.9] Set by the route when the diff exceeded the server byte/time cap. */
  truncated?: boolean;
}

/**
 * [n6uc.9] Cap on how many diff lines we render across all files. A near-10MB
 * diff can be hundreds of thousands of lines; mapping each to a DOM node hangs
 * the tab. Past this cap we render the prefix and show a "truncated" notice
 * pointing the reviewer at the terminal for the full diff. (Shared by web +
 * mobile, so this is a plain line-cap rather than a new virtualization dep.)
 */
const MAX_RENDERED_LINES = 3000;

/**
 * [n6uc.6] In-app worktree diff viewer: fetches the session's `git diff` and
 * renders a per-file list with colored unified hunks. Read-only review.
 */
export function SessionDiffViewer({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<DiffFileEntry[] | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True when the SERVER truncated the diff (exceeded the byte/time cap).
  const [serverTruncated, setServerTruncated] = useState(false);

  // Reset to the loading state DURING render when the session changes (avoids a
  // synchronous setState in the effect, which the React Compiler flags).
  const [seenSessionId, setSeenSessionId] = useState(sessionId);
  if (seenSessionId !== sessionId) {
    setSeenSessionId(sessionId);
    setFiles(null);
    setBase(null);
    setError(null);
    setServerTruncated(false);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/sessions/${sessionId}/diff`, { credentials: "include" })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d: DiffPayload) => {
        if (cancelled) return;
        setFiles(parseUnifiedDiff(d.raw));
        setBase(d.base);
        setServerTruncated(d.truncated === true);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">Failed to load diff: {error}</div>
    );
  }
  if (!files) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading diff…</div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No changes against the base branch{base ? ` (${base})` : ""}.
      </div>
    );
  }

  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  const totalLines = files.reduce((n, f) => n + f.lines.length, 0);

  // Render at most MAX_RENDERED_LINES lines, drawing from a budget shared across
  // files so a single huge file can't blow the cap. Computed as a pure reduce
  // (no mutation during render) — each entry carries its capped slice of lines.
  const clientTruncated = totalLines > MAX_RENDERED_LINES;
  const visibleFiles = files.reduce<
    { remaining: number; out: { file: DiffFileEntry; lines: DiffFileEntry["lines"] }[] }
  >(
    (acc, file) => {
      if (acc.remaining <= 0) return acc;
      const lines = file.lines.slice(0, acc.remaining);
      return {
        remaining: acc.remaining - lines.length,
        out: [...acc.out, { file, lines }],
      };
    },
    { remaining: MAX_RENDERED_LINES, out: [] },
  ).out;

  return (
    <div className="flex flex-col gap-4 p-4 font-mono text-xs">
      <div className="text-[11px] text-muted-foreground">
        {files.length} file{files.length === 1 ? "" : "s"} changed{" "}
        <span className="text-green-400">+{totalAdd}</span>{" "}
        <span className="text-red-400">-{totalDel}</span>
        {base ? <span className="ml-2 opacity-70">vs {base}</span> : null}
      </div>

      {serverTruncated && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Diff too large — the server capped it at {MB_LABEL}. Showing a partial
          diff; open this session in the terminal and run{" "}
          <code className="rounded bg-black/30 px-1">git diff</code> for the full
          changes.
        </div>
      )}

      {visibleFiles.map(({ file: f, lines: shown }) => {
        return (
          <div
            key={f.path}
            className="border border-border rounded overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 bg-muted/40 px-2 py-1">
              <span className="flex items-center gap-1 truncate">
                {f.isNew && (
                  <span className="text-green-400 text-[9px] uppercase">
                    new
                  </span>
                )}
                {f.isDeleted && (
                  <span className="text-red-400 text-[9px] uppercase">del</span>
                )}
                <span className="truncate">{f.path}</span>
              </span>
              <span className="shrink-0">
                <span className="text-green-400">+{f.additions}</span>{" "}
                <span className="text-red-400">-{f.deletions}</span>
              </span>
            </div>
            <pre className="overflow-x-auto">
              {shown.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "px-2 whitespace-pre",
                    l.type === "add" && "bg-green-500/10 text-green-300",
                    l.type === "del" && "bg-red-500/10 text-red-300",
                    l.type === "meta" && "text-muted-foreground/60",
                  )}
                >
                  {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                  {l.text}
                </div>
              ))}
            </pre>
          </div>
        );
      })}

      {clientTruncated && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Diff truncated — {MAX_RENDERED_LINES.toLocaleString()} of{" "}
          {totalLines.toLocaleString()} lines shown. Open this session in the
          terminal and run{" "}
          <code className="rounded bg-black/30 px-1">git diff</code> for the full
          diff.
        </div>
      )}
    </div>
  );
}

/** Human label for the server byte cap (keep in sync with the route's limit). */
const MB_LABEL = "10MB";
