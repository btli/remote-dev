"use client";

/**
 * Instance lifecycle action panel (client component).
 *
 * Surfaces the lifecycle controls a detail page offers, gated by the instance's
 * current status + the viewer's role:
 *   - Stop (ready) / Start (suspended)            — operator, POST suspend/resume
 *   - Image rollout (ready/suspended)             — operator, PATCH imageTag
 *   - Grow storage (ready/suspended)              — operator, PATCH storageRequest
 *   - Delete (any non-terminal)                   — admin, DELETE
 *   - Remove permanently (deleted)                — admin, DELETE ?purge=true
 *
 * "Stop"/"Start" are the user-facing labels for suspend/resume — the underlying
 * statuses (`ready`/`suspended`) and audit actions are unchanged. All actions
 * hit the JSON API and refresh the page on success. Uses `fetch` +
 * `console.error` (the structured server logger is server-only).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow transition-colors disabled:pointer-events-none disabled:opacity-50";

interface InstanceActionsProps {
  instanceId: string;
  /** The instance slug — shown in the permanent-remove confirm + freed on purge. */
  slug: string;
  status: string;
  storageRequest: string | null;
  imageTag: string | null;
  /** True when the viewer may operate (operator or admin). */
  canOperate: boolean;
  /** True when the viewer may delete (admin). */
  canDelete: boolean;
}

export function InstanceActions({
  instanceId,
  slug,
  status,
  storageRequest,
  imageTag,
  canOperate,
  canDelete,
}: InstanceActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState(imageTag ?? "");
  const [size, setSize] = useState("");

  const editable = status === "ready" || status === "suspended";

  async function run(
    fn: () => Promise<Response>,
    label: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.status === 202 || res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `${label} failed (${res.status})`);
    } catch (err) {
      console.error(`${label} failed`, err);
      setError(`Network error during ${label}.`);
    } finally {
      setBusy(false);
    }
  }

  function post(path: string, label: string): void {
    void run(() => fetch(`/api/instances/${instanceId}/${path}`, { method: "POST" }), label);
  }

  function patch(payload: Record<string, string>, label: string): void {
    void run(
      () =>
        fetch(`/api/instances/${instanceId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      label,
    );
  }

  function del(): void {
    if (!confirm("Delete this instance? Its namespace and data will be removed.")) {
      return;
    }
    void run(() => fetch(`/api/instances/${instanceId}`, { method: "DELETE" }), "delete");
  }

  function removePermanently(): void {
    if (
      !confirm(
        `Permanently remove this record? The slug "${slug}" will be freed for reuse. This cannot be undone.`,
      )
    ) {
      return;
    }
    // The detail page no longer exists after a purge → redirect to the dashboard
    // rather than refresh. A 404 (already purged) is also treated as success.
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}?purge=true`, {
          method: "DELETE",
        });
        if (res.ok || res.status === 404) {
          router.push("/");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Remove failed (${res.status})`);
        setBusy(false);
      } catch (err) {
        console.error("permanent remove failed", err);
        setError("Network error during permanent remove.");
        setBusy(false);
      }
    })();
  }

  if (!canOperate && !canDelete) {
    return (
      <p className="text-sm text-muted-foreground">
        You have view-only access to this instance.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {canOperate ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* Stop / Start are always rendered, each enabled only for its
              applicable status (Stop ← ready; Start ← suspended). They POST to
              the existing suspend/resume routes (the canonical actions). */}
          <button
            type="button"
            disabled={busy || status !== "ready"}
            onClick={() => post("suspend", "stop")}
            className={cn(buttonClass, "bg-secondary text-secondary-foreground hover:bg-secondary/80")}
          >
            Stop
          </button>
          <button
            type="button"
            disabled={busy || status !== "suspended"}
            onClick={() => post("resume", "start")}
            className={cn(buttonClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            Start
          </button>
        </div>
      ) : null}

      {canOperate && editable ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="space-y-2">
            <label htmlFor="imageTag" className="text-sm font-medium">
              Image rollout
            </label>
            <div className="flex gap-2">
              <input
                id="imageTag"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="ghcr.io/btli/remote-dev@sha256:…"
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, "font-mono")}
              />
              <button
                type="button"
                disabled={busy || image.trim() === "" || image.trim() === (imageTag ?? "")}
                onClick={() => patch({ imageTag: image.trim() }, "image rollout")}
                className={cn(buttonClass, "shrink-0 bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                Roll out
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              The reconciler rolls the StatefulSet to the new image (brief blip
              while the new pod becomes ready).
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="storageRequest" className="text-sm font-medium">
              Grow storage
            </label>
            <div className="flex gap-2">
              <input
                id="storageRequest"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder={storageRequest ? `larger than ${storageRequest}` : "e.g. 20Gi"}
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, "font-mono")}
              />
              <button
                type="button"
                disabled={busy || size.trim() === ""}
                onClick={() => patch({ storageRequest: size.trim() }, "resize")}
                className={cn(buttonClass, "shrink-0 bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                Resize
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Grow-only — PVCs cannot shrink. Current request:{" "}
              <code className="font-mono">{storageRequest ?? "unknown"}</code>.
            </p>
          </div>
        </div>
      ) : null}

      {canDelete && status === "deleted" ? (
        <button
          type="button"
          disabled={busy}
          onClick={removePermanently}
          className={cn(buttonClass, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
        >
          Remove permanently
        </button>
      ) : canDelete ? (
        <button
          type="button"
          disabled={busy || status === "terminating"}
          onClick={del}
          className={cn(buttonClass, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
        >
          Delete instance
        </button>
      ) : null}
    </div>
  );
}
