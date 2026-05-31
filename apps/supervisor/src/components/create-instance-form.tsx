"use client";

/**
 * Create-instance form with a storage-target dropdown (spec §7).
 *
 * Mirrors the main app's "discover & select" UX (`/api/directories`): on mount
 * it fetches the live storage options from `GET /api/storage-targets`, renders
 * them in a <select>, and surfaces the SELECTED option's resiliencyNote so the
 * operator sees the data-resiliency trade-off before provisioning. Submitting
 * POSTs `/api/instances` with the chosen option id as `storageTargetId`.
 *
 * Client component — uses fetch + console for client-side errors (the server
 * logger is server-only).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface StorageTargetOption {
  id: string;
  name: string;
  kind: string;
  resiliencyNote: string;
  isDefault: boolean;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,14}$/;

const inputClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "text-sm font-medium";

export function CreateInstanceForm() {
  const router = useRouter();

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [storageTargetId, setStorageTargetId] = useState("default");

  const [options, setOptions] = useState<StorageTargetOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Discover storage targets on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/storage-targets");
        if (!res.ok) {
          throw new Error(`Failed to load storage targets (${res.status})`);
        }
        const data = (await res.json()) as { targets: StorageTargetOption[] };
        if (cancelled) return;
        setOptions(data.targets);
        // Default the selection to the option flagged isDefault, else the first.
        const preferred =
          data.targets.find((t) => t.isDefault) ?? data.targets[0];
        if (preferred) setStorageTargetId(preferred.id);
      } catch (err) {
        if (cancelled) return;
        console.error("storage-targets fetch failed", err);
        setOptionsError(
          "Could not load storage targets. The cluster default will be used.",
        );
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = options.find((o) => o.id === storageTargetId);
  const slugValid = slug === "" || SLUG_PATTERN.test(slug);
  const canSubmit =
    !submitting &&
    SLUG_PATTERN.test(slug) &&
    displayName.trim().length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          displayName: displayName.trim(),
          storageTargetId,
        }),
      });
      if (res.status === 202) {
        // Provisioning queued — back to the dashboard.
        router.push("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFormError(data.error ?? `Request failed (${res.status})`);
    } catch (err) {
      console.error("create instance failed", err);
      setFormError("Network error while creating the instance.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="slug" className={labelClass}>
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="alpha"
          autoComplete="off"
          spellCheck={false}
          className={cn(inputClass, !slugValid && "border-destructive")}
          aria-invalid={!slugValid}
        />
        <p className="text-xs text-muted-foreground">
          1–15 chars, lowercase letter first, then lowercase letters, digits, or
          hyphens. The instance is served at{" "}
          <code className="font-mono">/{slug || "<slug>"}</code>.
        </p>
        {!slugValid ? (
          <p className="text-xs text-destructive">Invalid slug format.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="displayName" className={labelClass}>
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alpha"
          autoComplete="off"
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="storageTargetId" className={labelClass}>
          Storage target
        </label>
        <select
          id="storageTargetId"
          name="storageTargetId"
          value={storageTargetId}
          onChange={(e) => setStorageTargetId(e.target.value)}
          disabled={optionsLoading}
          className={cn(inputClass, "appearance-none")}
        >
          {optionsLoading ? (
            <option value="default">Loading…</option>
          ) : (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {o.resiliencyNote}
              </option>
            ))
          )}
        </select>
        {optionsError ? (
          <p className="text-xs text-destructive">{optionsError}</p>
        ) : null}
        {selected ? (
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {selected.kind}
            </span>{" "}
            — {selected.resiliencyNote}
          </div>
        ) : null}
      </div>

      {formError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create instance"}
        </button>
        <Link
          href="/"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
