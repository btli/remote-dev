"use client";

/**
 * InstancesSection — Settings panel for the peer-instance registry used by
 * server-to-server project migration (stage 3 UI over the stage-1 API).
 *
 * Top half: CRUD over /api/peers — list registered destinations (API keys
 * are write-only; reads only ever see a masked preview), Add/Edit dialog
 * with a collapsible Cloudflare Access service-token section, per-peer
 * "Test connection" (GET /api/peers/:id/capabilities runs a live verify and
 * stamps lastSeenAt), and delete-with-confirm (cascades that peer's jobs).
 *
 * Bottom half: recent migration jobs (GET /api/migrations, newest first)
 * with status chips and a details expander showing the conflict report.
 */
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import {
  formatBytes,
  migrationPhaseLabel,
  parseConflictReport,
  readApiError,
  workingTreeModeLabel,
  type MigrationJobDTO,
  type PeerInstanceDTO,
} from "@/components/migration/migration-format";
import type { MigrationJobStatus } from "@/types/migration";

export function InstancesSection() {
  const [peers, setPeers] = useState<PeerInstanceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PeerInstanceDTO | "new" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PeerInstanceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/peers");
      if (!res.ok) throw new Error(await readApiError(res, "Failed to load peers"));
      const data = (await res.json()) as { peers: PeerInstanceDTO[] };
      setPeers(data.peers ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load peers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/peers/${deleteConfirm.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readApiError(res, "Delete failed"));
      setDeleteConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Register other Remote Dev instances as migration destinations. API
            keys are stored encrypted and never shown again after saving.
          </p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="w-4 h-4 mr-1" /> Add instance
          </Button>
        </div>

        <MigrationRequirements />

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : peers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No peer instances yet. Click{" "}
            <span className="font-medium">Add instance</span> to register a
            migration destination.
          </div>
        ) : (
          <ul className="space-y-2">
            {peers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-card/50"
              >
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <Globe className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.baseUrl}
                      {" · "}
                      {p.lastSeenAt
                        ? `verified ${formatDistanceToNow(new Date(p.lastSeenAt), { addSuffix: true })}`
                        : "never verified"}
                      {p.capabilities &&
                        ` · v${p.capabilities.version} (${p.capabilities.appVersion})`}
                    </div>
                  </div>
                </div>
                <TestConnectionButton peerId={p.id} onVerified={refresh} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing(p)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Edit instance"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteConfirm(p)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete instance"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecentMigrations peers={peers} />

      {editing && (
        <PeerEditDialog
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}

      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <AlertDialogContent className="bg-popover/95 backdrop-blur-xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Delete peer instance
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="text-foreground font-medium">
                {deleteConfirm?.name}
              </span>
              ? Its stored credentials and migration job history will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-transparent border-border text-muted-foreground hover:bg-accent"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Requirements explainer — what a migration destination needs
// ============================================================================

/**
 * A collapsible checklist of the prerequisites a migration destination must
 * satisfy. Surfaced both here and in the Migrate dialog so the most common
 * "it doesn't work" causes (no key, wrong key owner, missing slug, CF Access)
 * are visible before the user hits an error.
 */
export function MigrationRequirements({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-md border border-border bg-card/30"
    >
      <summary className="cursor-pointer text-sm font-medium p-3 text-foreground">
        Requirements for a migration destination
      </summary>
      <ul className="px-3 pb-3 space-y-1.5 text-xs text-muted-foreground list-disc pl-7">
        <li>
          The destination instance already <strong>exists and is reachable</strong>{" "}
          at its Base URL.
        </li>
        <li>
          <strong>Your account exists on the destination</strong>, and you have
          created an <strong>API key there</strong> (its Settings → Mobile → “New
          API Key”) for the user who will own the migrated project.
        </li>
        <li>
          If the destination is reached <strong>off-LAN through Cloudflare
          Access</strong>, add a <strong>CF Access service token</strong> below
          (Client ID + Secret) so server-to-server calls clear the edge.
        </li>
        <li>
          For a Shape B instance behind the supervisor router, the Base URL must
          include the <strong>instance slug</strong>, e.g.{" "}
          <code>https://rdv.joyful.house/homelab</code>.
        </li>
      </ul>
      <p className="px-3 pb-3 text-xs text-muted-foreground">
        See <code>docs/MIGRATION.md</code> for the full walkthrough.
      </p>
    </details>
  );
}

// ============================================================================
// Test connection button — live verify via /api/peers/:id/capabilities
// ============================================================================

function TestConnectionButton({
  peerId,
  onVerified,
}: {
  peerId: string;
  onVerified: () => Promise<void> | void;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; version: number; appVersion: string }
    | { kind: "fail"; message: string }
  >({ kind: "idle" });

  const onClick = async () => {
    setState({ kind: "running" });
    try {
      const res = await apiFetch(`/api/peers/${peerId}/capabilities`);
      if (!res.ok) {
        setState({
          kind: "fail",
          message: await readApiError(res, "Peer unreachable"),
        });
        return;
      }
      const data = (await res.json()) as {
        capabilities: { version: number; appVersion: string };
      };
      setState({
        kind: "ok",
        version: data.capabilities.version,
        appVersion: data.capabilities.appVersion,
      });
      // lastSeenAt + cached capabilities changed server-side — refresh the row.
      await onVerified();
    } catch (err) {
      setState({
        kind: "fail",
        message: err instanceof Error ? err.message : "Test failed",
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void onClick()}
      disabled={state.kind === "running"}
      title={
        state.kind === "fail"
          ? state.message
          : state.kind === "ok"
            ? `Reachable · capabilities v${state.version} · ${state.appVersion}`
            : "Test connection"
      }
    >
      {state.kind === "running" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : state.kind === "ok" ? (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <Check className="w-4 h-4" />
          <span className="text-xs">v{state.version}</span>
        </span>
      ) : state.kind === "fail" ? (
        <AlertCircle className="w-4 h-4 text-destructive" />
      ) : (
        <span className="text-xs">Test</span>
      )}
    </Button>
  );
}

// ============================================================================
// Add / Edit dialog
// ============================================================================

function PeerEditDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: PeerInstanceDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [cfClientId, setCfClientId] = useState(existing?.cfAccessClientId ?? "");
  const [cfSecret, setCfSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (!name.trim()) throw new Error("Name is required");
      if (!baseUrl.trim()) throw new Error("Base URL is required");
      if (!existing && !apiKey.trim()) throw new Error("API key is required");

      if (existing) {
        // PATCH semantics: omitted fields keep their stored value. Clearing
        // the CF client id clears the service-token pair.
        const body: Record<string, unknown> = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
        };
        if (apiKey.trim()) body.apiKey = apiKey;
        const trimmedClientId = cfClientId.trim();
        if (trimmedClientId !== (existing.cfAccessClientId ?? "")) {
          body.cfAccessClientId = trimmedClientId || null;
          if (!trimmedClientId) body.cfAccessSecret = null;
        }
        if (cfSecret.trim()) {
          body.cfAccessClientId = trimmedClientId || null;
          body.cfAccessSecret = cfSecret;
        }
        const res = await apiFetch(`/api/peers/${existing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await readApiError(res, "Save failed"));
      } else {
        const res = await apiFetch("/api/peers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            baseUrl: baseUrl.trim(),
            apiKey,
            cfAccessClientId: cfClientId.trim() || null,
            cfAccessSecret: cfSecret || null,
          }),
        });
        if (!res.ok) throw new Error(await readApiError(res, "Save failed"));
      }
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit peer instance" : "Add peer instance"}
          </DialogTitle>
          <DialogDescription>
            Create the API key <strong>on the destination instance</strong>,
            for the account that will own the migrated project: open its
            Settings → Mobile and click “New API Key”. Paste it below — it is
            stored encrypted here and never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="peer-name">Name</Label>
            <Input
              id="peer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="homelab"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="peer-url">Base URL</Label>
            <Input
              id="peer-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://rdv.example.com"
            />
            <p className="text-xs text-muted-foreground">
              The destination&apos;s origin. If it&apos;s served under a path prefix
              (a Shape B instance behind the supervisor router), include the slug —
              e.g. <code>https://rdv.example.com/alpha</code>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="peer-key">
              API key{" "}
              {existing && (
                <span className="text-muted-foreground font-normal">
                  (stored: {existing.apiKeyMasked} — leave blank to keep)
                </span>
              )}
            </Label>
            <Input
              id="peer-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
              placeholder={existing ? "••••••••" : "rdv_…"}
            />
          </div>

          <details className="rounded-md border border-border bg-card/30">
            <summary className="cursor-pointer text-sm font-medium p-3">
              Cloudflare Access service token{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <p className="text-xs text-muted-foreground">
                Required only when the destination sits behind Cloudflare
                Access. Clear the Client ID to remove a stored token.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="peer-cf-id">CF-Access-Client-Id</Label>
                <Input
                  id="peer-cf-id"
                  value={cfClientId}
                  onChange={(e) => setCfClientId(e.target.value)}
                  placeholder="xxxxxxxx.access"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="peer-cf-secret">
                  CF-Access-Client-Secret{" "}
                  {existing?.hasCfAccessSecret && (
                    <span className="text-muted-foreground font-normal">
                      (stored — leave blank to keep)
                    </span>
                  )}
                </Label>
                <Input
                  id="peer-cf-secret"
                  type="password"
                  value={cfSecret}
                  onChange={(e) => setCfSecret(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </details>

          {formError && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            {existing ? "Save changes" : "Add instance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Recent migration jobs
// ============================================================================

const ACTIVE_STATUSES: ReadonlySet<MigrationJobStatus> = new Set([
  "pending",
  "running",
  "db_done",
  "files_done",
  "verifying",
]);

function statusChipClass(status: MigrationJobStatus): string {
  if (status === "completed")
    return "bg-green-500/15 text-green-600 dark:text-green-400";
  if (status === "failed") return "bg-destructive/15 text-destructive";
  if (status === "aborted") return "bg-muted text-muted-foreground";
  return "bg-primary/15 text-primary";
}

function RecentMigrations({ peers }: { peers: PeerInstanceDTO[] }) {
  const { projects } = useProjectTree();
  const [jobs, setJobs] = useState<MigrationJobDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/migrations");
      if (!res.ok) throw new Error(await readApiError(res, "Failed to load jobs"));
      const data = (await res.json()) as { jobs: MigrationJobDTO[] };
      // The API lists by createdAt ascending — show newest first.
      setJobs(
        [...(data.jobs ?? [])].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load migrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? id;
  const peerName = (id: string | null) =>
    id ? (peers.find((p) => p.id === id)?.name ?? id) : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Recent migrations</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh migrations"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </Button>
      </div>

      {!loading && jobs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No migrations yet. Right-click a project →{" "}
          <span className="font-medium">Migrate to instance…</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {jobs.map((job) => {
            const expanded = expandedId === job.id;
            const report = parseConflictReport(job.conflictReportJson);
            return (
              <li key={job.id} className="rounded-md border border-border bg-card/30">
                <button
                  onClick={() => setExpandedId(expanded ? null : job.id)}
                  className="w-full flex items-center gap-2 p-2.5 text-left"
                  aria-expanded={expanded}
                >
                  {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <ArrowRightLeft className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                    {projectName(job.projectId)}{" "}
                    <span className="text-muted-foreground">
                      → {peerName(job.peerInstanceId)}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                      statusChipClass(job.status),
                    )}
                  >
                    {ACTIVE_STATUSES.has(job.status) && (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    )}
                    {job.status}
                  </span>
                </button>
                {expanded && (
                  <div className="px-9 pb-3 space-y-1.5 text-xs text-muted-foreground">
                    <p>
                      {migrationPhaseLabel(job.status)} ·{" "}
                      {workingTreeModeLabel(job.workingTreeMode)} ·{" "}
                      {formatBytes(job.bytesTransferred)} transferred
                      {job.sizeEstimateBytes != null &&
                        ` of ≈${formatBytes(job.sizeEstimateBytes)}`}
                    </p>
                    {job.destProjectId && (
                      <p>
                        Destination project:{" "}
                        <code className="font-mono">{job.destProjectId}</code>
                      </p>
                    )}
                    {job.errorMessage && (
                      <pre className="text-destructive whitespace-pre-wrap break-all font-mono">
                        {job.errorMessage}
                      </pre>
                    )}
                    {report && report.conflicts.length > 0 ? (
                      <ul className="space-y-1 pt-1 border-t border-border/60">
                        {report.conflicts.map((c, i) => (
                          <li key={i}>
                            <span className="font-mono">{c.type}</span>{" "}
                            <span className="text-foreground">{c.message}</span>
                            {c.detail && (
                              <span className="block">{c.detail}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No conflicts recorded.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
