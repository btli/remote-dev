"use client";

/**
 * Storage browser (client component) — READ-ONLY listing of an instance's
 * persistent data volume via `GET /api/instances/:id/storage` (an ephemeral
 * inspector Job, so each round-trip takes a few seconds). Directories are
 * navigable; files trigger a download via the file endpoint. The API degrades to
 * an empty listing + a note when no cluster is reachable, so this never errors
 * hard. Uses `fetch` + `console.error`.
 *
 * Limitations surfaced to the operator: read-only (no upload/delete), a few-second
 * latency per listing, the stopped + node-pinned caveat (a `note`), and the
 * file-size cap (the file endpoint returns 413).
 */

import { useCallback, useEffect, useState } from "react";

const buttonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-transparent px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

type EntryType = "dir" | "file" | "other";

interface DirEntry {
  name: string;
  type: EntryType;
  size: number;
  mtimeMs: number;
}

interface Listing {
  path: string;
  entries: DirEntry[];
  truncated: boolean;
}

interface StorageResponse {
  listing: Listing;
  note?: string;
}

/** Join a (relative) dir path + a child name into a normalized relative path. */
function joinPath(dir: string, name: string): string {
  const base = dir.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${name}` : name;
}

/** Drop the last segment of a relative path (go up one directory). */
function parentPath(dir: string): string {
  const parts = dir.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/** Human-readable byte size. */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function InstanceStorage({ instanceId }: { instanceId: string }) {
  const [path, setPath] = useState(""); // relative path under the volume root
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setNote(null);
      try {
        const qs = `?path=${encodeURIComponent(target || "/")}`;
        const res = await fetch(`/api/instances/${instanceId}/storage${qs}`);
        if (res.status === 400) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setNote(data.error ?? "Invalid path.");
          return;
        }
        const data = (await res.json()) as StorageResponse;
        setEntries(data.listing?.entries ?? []);
        setTruncated(data.listing?.truncated ?? false);
        setNote(data.note ?? null);
        setPath(target);
      } catch (err) {
        console.error("storage fetch failed", err);
        setNote("Could not load storage.");
      } finally {
        setLoading(false);
      }
    },
    [instanceId],
  );

  // Load the volume root on mount. `load` is stable (only depends on
  // instanceId), so including it satisfies the exhaustive-deps rule and still
  // runs once per instance.
  useEffect(() => {
    void load("");
  }, [load]);

  function openDir(name: string): void {
    void load(joinPath(path, name));
  }

  function goUp(): void {
    void load(parentPath(path));
  }

  function download(name: string): void {
    const filePath = joinPath(path, name);
    const url = `/api/instances/${instanceId}/storage/file?path=${encodeURIComponent(filePath)}`;
    // Let the browser handle the download (the endpoint sets Content-Disposition).
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Sort: dirs first, then files, each alphabetical.
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === "dir") return -1;
      if (b.type === "dir") return 1;
    }
    return a.name.localeCompare(b.name);
  });

  const crumbs = path.split("/").filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => void load("")}
            className="font-mono hover:text-foreground hover:underline"
          >
            /
          </button>
          {crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1">
              <span>/</span>
              <button
                type="button"
                onClick={() => void load(crumbs.slice(0, i + 1).join("/"))}
                className="truncate font-mono hover:text-foreground hover:underline"
              >
                {c}
              </button>
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {path ? (
            <button type="button" onClick={goUp} disabled={loading} className={buttonClass}>
              Up
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load(path)}
            disabled={loading}
            className={buttonClass}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {note ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {note}
        </div>
      ) : null}

      {truncated ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          Listing truncated at 1000 entries — open a subdirectory or use a terminal
          to see the rest.
        </div>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {sorted.length === 0 && !loading ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            {note ? "" : "Empty directory."}
          </li>
        ) : null}
        {sorted.map((e) => (
          <li key={e.name} className="flex items-center gap-3 px-3 py-2 text-xs">
            {e.type === "dir" ? (
              <button
                type="button"
                onClick={() => openDir(e.name)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
              >
                <span aria-hidden className="text-muted-foreground">
                  📁
                </span>
                <span className="truncate font-mono">{e.name}/</span>
              </button>
            ) : e.type === "file" ? (
              <button
                type="button"
                onClick={() => download(e.name)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
                title="Download"
              >
                <span aria-hidden className="text-muted-foreground">
                  📄
                </span>
                <span className="truncate font-mono">{e.name}</span>
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
                <span aria-hidden>•</span>
                <span className="truncate font-mono">{e.name}</span>
              </span>
            )}
            <span className="shrink-0 text-muted-foreground">
              {e.type === "file" ? fmtSize(e.size) : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Read-only. Files over 5 MiB can&apos;t be downloaded here — use a terminal.
        Browsing a stopped workspace whose storage is node-pinned requires starting
        it first.
      </p>
    </div>
  );
}
