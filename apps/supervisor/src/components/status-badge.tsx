import { cn } from "@/lib/utils";

/**
 * Status pill for an instance lifecycle status. Shared by the dashboard
 * (`app/page.tsx`) and the instance detail page (`app/instances/[id]/page.tsx`)
 * so the colour map lives in exactly one place.
 *
 * A pure presentational component — safe to render in server components.
 */
const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-400",
  provisioning: "bg-amber-500/15 text-amber-400",
  requested: "bg-sky-500/15 text-sky-400",
  suspended: "bg-zinc-500/15 text-zinc-400",
  terminating: "bg-orange-500/15 text-orange-400",
  deleted: "bg-zinc-500/15 text-zinc-500",
  error: "bg-red-500/15 text-red-400",
};

/**
 * Display labels that differ from the raw status value. Only the DISPLAY text
 * changes — the underlying status (e.g. `suspended`) is unchanged everywhere
 * else (DB, audit, API). "Stopped" is the user-facing label for `suspended`
 * (remote-dev-jvcx.15).
 */
const STATUS_LABELS: Record<string, string> = {
  suspended: "Stopped",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
