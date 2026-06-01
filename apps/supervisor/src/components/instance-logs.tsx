"use client";

/**
 * Pod log viewer (client component) — fetches `GET /api/instances/:id/logs`
 * (tail) into a read-only textarea with a refresh button + a "previous
 * container" toggle. The API degrades to empty + a note when no cluster is
 * reachable, so this never errors hard. Uses `fetch` + `console.error`.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const buttonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-transparent px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

interface LogsResponse {
  pod: string | null;
  container: string;
  logs: string;
  note?: string;
}

export function InstanceLogs({ instanceId }: { instanceId: string }) {
  const [logs, setLogs] = useState("");
  const [pod, setPod] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [previous, setPrevious] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/instances/${instanceId}/logs?tail=500${previous ? "&previous=true" : ""}`,
      );
      const data = (await res.json()) as LogsResponse;
      setLogs(data.logs ?? "");
      setPod(data.pod ?? null);
      setNote(data.note ?? null);
    } catch (err) {
      console.error("logs fetch failed", err);
      setNote("Could not load logs.");
    } finally {
      setLoading(false);
    }
  }, [instanceId, previous]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {pod ? (
            <>
              Pod <code className="font-mono">{pod}</code>
            </>
          ) : (
            note ?? "No pod running."
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={previous}
              onChange={(e) => setPrevious(e.target.checked)}
            />
            Previous container
          </label>
          <button type="button" onClick={() => void load()} disabled={loading} className={buttonClass}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
      <textarea
        readOnly
        value={logs}
        placeholder={loading ? "Loading…" : "No log output."}
        className={cn(
          "h-80 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none",
        )}
      />
    </div>
  );
}
