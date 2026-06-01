"use client";

/**
 * Instance lifecycle action panel (client component).
 *
 * Surfaces the lifecycle controls a detail page offers, gated by the instance's
 * current status + the viewer's role:
 *   - Suspend (ready) / Resume (suspended)        — operator, POST suspend/resume
 *   - Image rollout (ready/suspended)             — operator, PATCH imageTag
 *   - Grow storage (ready/suspended)              — operator, PATCH storageRequest
 *   - Delete (any non-terminal)                   — admin, DELETE
 *
 * All actions hit the JSON API and refresh the page on success. Uses `fetch` +
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
          {status === "ready" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => post("suspend", "suspend")}
              className={cn(buttonClass, "bg-secondary text-secondary-foreground hover:bg-secondary/80")}
            >
              Suspend
            </button>
          ) : null}
          {status === "suspended" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => post("resume", "resume")}
              className={cn(buttonClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              Resume
            </button>
          ) : null}
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

      {canDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={del}
          className={cn(buttonClass, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
        >
          Delete instance
        </button>
      ) : null}
    </div>
  );
}
