"use client";

/**
 * Namespace events viewer (client component) — fetches
 * `GET /api/instances/:id/events` and renders them newest-first as a list. The
 * API degrades to `{ events: [] }` + a note when no cluster is reachable, so
 * this never errors hard. Uses `fetch` + `console.error`.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const buttonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-transparent px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

interface EventDTO {
  type: string;
  reason: string;
  message: string;
  count: number;
  lastSeen: string | null;
  involvedObject: string;
}

interface EventsResponse {
  events: EventDTO[];
  note?: string;
}

export function InstanceEvents({ instanceId }: { instanceId: string }) {
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/instances/${instanceId}/events`);
      const data = (await res.json()) as EventsResponse;
      setEvents(data.events ?? []);
      setNote(data.note ?? null);
    } catch (err) {
      console.error("events fetch failed", err);
      setNote("Could not load events.");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {note ?? (events.length === 0 ? "No recent events." : `${events.length} events`)}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={buttonClass}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {events.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {events.map((e, i) => (
            <li key={`${e.reason}-${e.lastSeen ?? ""}-${i}`} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 font-medium",
                    e.type === "Warning"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-zinc-500/15 text-zinc-400",
                  )}
                >
                  {e.reason || e.type}
                </span>
                <span className="truncate font-mono text-muted-foreground">
                  {e.involvedObject}
                </span>
                {e.count > 1 ? (
                  <span className="text-muted-foreground">×{e.count}</span>
                ) : null}
                {e.lastSeen ? (
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {new Date(e.lastSeen).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-muted-foreground">{e.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
