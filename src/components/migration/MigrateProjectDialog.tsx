"use client";

/**
 * MigrateProjectDialog — push a project to another Remote Dev instance
 * (server-to-server migration, stage 3 UI).
 *
 * Self-contained three-step dialog:
 *   1. configure — pick a registered peer (Settings → Instances manages the
 *      registry), choose a working-tree mode (with a debounced size preview
 *      per mode; the preview endpoint is stage 2 and may 404 — degrade to
 *      "preview unavailable"), and flip the include/remove toggles.
 *   2. progress — POST /api/migrations then poll the job every 2s. Shows a
 *      determinate bar when bytesTransferred/sizeEstimateBytes are usable.
 *      The job runs server-side, so closing the dialog does NOT abort it —
 *      there is an explicit Abort button for that.
 *   3. result — destination project id + parsed conflict report on success,
 *      errorMessage on failure.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { MigrationWorkingTreeMode } from "@/types/migration";
import {
  formatBytes,
  isTerminalMigrationStatus,
  migrationPhaseLabel,
  migrationProgressPercent,
  parseConflictReport,
  readApiError,
  type MigrationJobDTO,
  type PeerInstanceDTO,
  type SizePreviewDTO,
} from "./migration-format";

const POLL_INTERVAL_MS = 2000;
const PREVIEW_DEBOUNCE_MS = 400;

type Step = "configure" | "progress" | "result";

type PreviewState =
  | { state: "loading" }
  | { state: "ok"; data: SizePreviewDTO }
  | { state: "unavailable" }
  | { state: "error" };

interface ModeOption {
  value: MigrationWorkingTreeMode;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "full_tar",
    label: "Full copy",
    description:
      "Everything in the working tree (node_modules and build caches excluded).",
  },
  {
    value: "git_essentials",
    label: "Git clone + essentials",
    description:
      ".git plus uncommitted changes — the destination restores the rest from git.",
  },
  {
    value: "none",
    label: "No files",
    description: "Database records only — re-clone the repository on the destination.",
  },
];

interface MigrateProjectDialogProps {
  project: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once when the job completes (e.g. refresh the project tree). */
  onCompleted?: () => void;
}

export function MigrateProjectDialog({
  project,
  open,
  onOpenChange,
  onCompleted,
}: MigrateProjectDialogProps) {
  const [step, setStep] = useState<Step>("configure");

  // ── configure state ──
  const [peers, setPeers] = useState<PeerInstanceDTO[]>([]);
  const [peersLoading, setPeersLoading] = useState(false);
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [mode, setMode] = useState<MigrationWorkingTreeMode>("full_tar");
  const [includeDotEnv, setIncludeDotEnv] = useState(true);
  const [includeAgentCreds, setIncludeAgentCreds] = useState(true);
  const [includeSshKeys, setIncludeSshKeys] = useState(false);
  const [includeAgentSettings, setIncludeAgentSettings] = useState(true);
  const [includeChannelHistory, setIncludeChannelHistory] = useState(false);
  const [removeSourceAfterVerify, setRemoveSourceAfterVerify] = useState(false);
  const [previews, setPreviews] = useState<
    Partial<Record<MigrationWorkingTreeMode, PreviewState>>
  >({});
  const [testState, setTestState] = useState<
    | { state: "idle" }
    | { state: "running" }
    | { state: "ok"; version: number; appVersion: string }
    | { state: "fail"; message: string }
  >({ state: "idle" });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── progress / result state ──
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<MigrationJobDTO | null>(null);
  const [aborting, setAborting] = useState(false);

  // Keep the latest callback without retriggering the poll effect.
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  // Reset + load peers whenever the dialog (re)opens or the target changes.
  useEffect(() => {
    if (!open) return;
    setStep("configure");
    setSelectedPeerId("");
    setMode("full_tar");
    setIncludeDotEnv(true);
    setIncludeAgentCreds(true);
    setIncludeSshKeys(false);
    setIncludeAgentSettings(true);
    setIncludeChannelHistory(false);
    setRemoveSourceAfterVerify(false);
    setPreviews({});
    setTestState({ state: "idle" });
    setStarting(false);
    setError(null);
    setJobId(null);
    setJob(null);
    setAborting(false);

    let cancelled = false;
    setPeersLoading(true);
    void (async () => {
      try {
        const res = await apiFetch("/api/peers");
        if (!res.ok) throw new Error(await readApiError(res, "Failed to load peers"));
        const data = (await res.json()) as { peers: PeerInstanceDTO[] };
        if (cancelled) return;
        setPeers(data.peers ?? []);
        if ((data.peers ?? []).length === 1) setSelectedPeerId(data.peers[0].id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load peers");
        }
      } finally {
        if (!cancelled) setPeersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  // Debounced size preview for the selected mode (stage-2 endpoint; 404 ⇒
  // "preview unavailable"). Results are cached per mode for the dialog's life.
  useEffect(() => {
    if (!open || step !== "configure") return;
    if (previews[mode]) return; // already loading / resolved
    const timer = setTimeout(() => {
      setPreviews((prev) => ({ ...prev, [mode]: { state: "loading" } }));
      void (async () => {
        try {
          const res = await apiFetch("/api/migrations/size-preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: project.id, workingTreeMode: mode }),
          });
          if (res.status === 404) {
            setPreviews((prev) => ({ ...prev, [mode]: { state: "unavailable" } }));
            return;
          }
          if (!res.ok) {
            setPreviews((prev) => ({ ...prev, [mode]: { state: "error" } }));
            return;
          }
          const data = (await res.json()) as SizePreviewDTO;
          setPreviews((prev) => ({ ...prev, [mode]: { state: "ok", data } }));
        } catch {
          setPreviews((prev) => ({ ...prev, [mode]: { state: "error" } }));
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, step, mode, previews, project.id]);

  // Poll the job every 2s until it reaches a terminal state. The chain is a
  // self-rescheduling timeout so the cleanup always clears the pending timer
  // on unmount/close.
  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/migrations/${jobId}`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { job: MigrationJobDTO };
          if (cancelled) return;
          setJob(data.job);
          if (isTerminalMigrationStatus(data.job.status)) {
            setStep("result");
            if (data.job.status === "completed") onCompletedRef.current?.();
            return; // terminal — stop polling
          }
        }
      } catch {
        // Transient network failure — keep polling.
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, jobId]);

  const handleTestPeer = useCallback(async () => {
    if (!selectedPeerId) return;
    setTestState({ state: "running" });
    try {
      const res = await apiFetch(`/api/peers/${selectedPeerId}/capabilities`);
      if (!res.ok) {
        setTestState({
          state: "fail",
          message: await readApiError(res, "Peer unreachable"),
        });
        return;
      }
      const data = (await res.json()) as {
        capabilities: { version: number; appVersion: string };
      };
      setTestState({
        state: "ok",
        version: data.capabilities.version,
        appVersion: data.capabilities.appVersion,
      });
    } catch (err) {
      setTestState({
        state: "fail",
        message: err instanceof Error ? err.message : "Peer unreachable",
      });
    }
  }, [selectedPeerId]);

  const handleStart = useCallback(async () => {
    if (!selectedPeerId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/migrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          peerInstanceId: selectedPeerId,
          options: {
            workingTreeMode: mode,
            includeDotEnv,
            includeAgentCreds,
            includeSshKeys,
            includeAgentSettings,
            includeChannelHistory,
            removeSourceAfterVerify,
          },
        }),
      });
      if (!res.ok) {
        setError(await readApiError(res, "Failed to start migration"));
        return;
      }
      const data = (await res.json()) as { jobId: string };
      setJobId(data.jobId);
      setStep("progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start migration");
    } finally {
      setStarting(false);
    }
  }, [
    selectedPeerId,
    project.id,
    mode,
    includeDotEnv,
    includeAgentCreds,
    includeSshKeys,
    includeAgentSettings,
    includeChannelHistory,
    removeSourceAfterVerify,
  ]);

  const handleAbort = useCallback(async () => {
    if (!jobId) return;
    setAborting(true);
    try {
      const res = await apiFetch(`/api/migrations/${jobId}/abort`, {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as { job: MigrationJobDTO };
        setJob(data.job);
        if (isTerminalMigrationStatus(data.job.status)) setStep("result");
      }
    } catch {
      // The poll loop will surface the real state.
    } finally {
      setAborting(false);
    }
  }, [jobId]);

  const selectedPeer = peers.find((p) => p.id === selectedPeerId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-primary" />
            Migrate “{project.name}”
          </DialogTitle>
          <DialogDescription>
            {step === "configure" &&
              "Push this project to another Remote Dev instance. Sessions stay behind; schedules and triggers arrive disabled."}
            {step === "progress" &&
              "Migration in progress. It runs on the server — closing this dialog will not stop it."}
            {step === "result" && "Migration finished."}
          </DialogDescription>
        </DialogHeader>

        {step === "configure" && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* Destination peer */}
            <div className="space-y-1.5">
              <Label>Destination instance</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedPeerId}
                  onValueChange={(v) => {
                    setSelectedPeerId(v);
                    setTestState({ state: "idle" });
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue
                      placeholder={peersLoading ? "Loading…" : "Select a peer instance"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {peers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.baseUrl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleTestPeer()}
                  disabled={!selectedPeerId || testState.state === "running"}
                >
                  {testState.state === "running" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
              {testState.state === "ok" && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Reachable · capabilities v
                  {testState.version} · {testState.appVersion}
                </p>
              )}
              {testState.state === "fail" && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{testState.message}</span>
                </p>
              )}
              {!peersLoading && peers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No peer instances registered. Add one in Settings → Instances.
                </p>
              )}
            </div>

            {/* Working-tree mode */}
            <div className="space-y-1.5">
              <Label>Working tree</Label>
              <div className="space-y-1.5" role="radiogroup" aria-label="Working tree mode">
                {MODE_OPTIONS.map((opt) => {
                  const preview = previews[opt.value];
                  const selected = mode === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={cn(
                        "flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border bg-card/30 hover:bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="working-tree-mode"
                        className="mt-1"
                        checked={selected}
                        onChange={() => setMode(opt.value)}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {opt.label}
                          </span>
                          {preview?.state === "loading" && (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                          )}
                          {preview?.state === "ok" && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary"
                              title={
                                preview.data.warning ??
                                `Working tree ${formatBytes(preview.data.workingTreeBytes)} · profiles ${formatBytes(preview.data.profilesBytes)} · agent settings ${formatBytes(preview.data.agentSettingsBytes)}`
                              }
                            >
                              ≈ {formatBytes(preview.data.totalBytes)}
                            </span>
                          )}
                          {(preview?.state === "unavailable" ||
                            preview?.state === "error") && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              preview unavailable
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {opt.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Include toggles */}
            <div className="space-y-1.5">
              <Label>Include</Label>
              <div className="rounded-md border border-border divide-y divide-border">
                <ToggleRow
                  label="Environment files"
                  description=".env / .env.local in the working tree"
                  checked={includeDotEnv}
                  onCheckedChange={setIncludeDotEnv}
                />
                <ToggleRow
                  label="Agent credentials"
                  description="Stored provider API keys (re-encrypted on the destination)"
                  checked={includeAgentCreds}
                  onCheckedChange={setIncludeAgentCreds}
                />
                <ToggleRow
                  label="SSH keys"
                  description="Profile SSH keys (off by default)"
                  checked={includeSshKeys}
                  onCheckedChange={setIncludeSshKeys}
                />
                <ToggleRow
                  label="Agent settings"
                  description="MCP servers, agent configs, profile JSON settings"
                  checked={includeAgentSettings}
                  onCheckedChange={setIncludeAgentSettings}
                />
                <ToggleRow
                  label="Channel history"
                  description="Inter-agent channel messages (off by default)"
                  checked={includeChannelHistory}
                  onCheckedChange={setIncludeChannelHistory}
                />
              </div>
            </div>

            {/* Remove source */}
            <div className="rounded-md border border-border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Remove from source after verification
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Delete this project here once the destination verifies the import.
                  </div>
                </div>
                <Switch
                  checked={removeSourceAfterVerify}
                  onCheckedChange={setRemoveSourceAfterVerify}
                />
              </div>
              {removeSourceAfterVerify && (
                <p className="text-xs text-red-500 dark:text-red-400">
                  Warning: the project and its sessions will be deleted from this
                  instance after a successful verify. This cannot be undone here
                  (working-tree files on disk are not deleted).
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {step === "progress" && (
          <MigrationProgress job={job} />
        )}

        {step === "result" && (
          <MigrationResult job={job} peerName={selectedPeer?.name ?? null} />
        )}

        <DialogFooter>
          {step === "configure" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleStart()}
                disabled={!selectedPeerId || starting}
              >
                {starting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Start migration
              </Button>
            </>
          )}
          {step === "progress" && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleAbort()}
              disabled={aborting}
            >
              {aborting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Abort
            </Button>
          )}
          {step === "result" && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function MigrationProgress({ job }: { job: MigrationJobDTO | null }) {
  const percent = job
    ? migrationProgressPercent(job.bytesTransferred, job.sizeEstimateBytes)
    : null;
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        {job ? migrationPhaseLabel(job.status) : "Starting…"}
      </div>
      {percent != null && job ? (
        <div className="space-y-1">
          <Progress value={percent} />
          <p className="text-xs text-muted-foreground">
            {formatBytes(job.bytesTransferred)} of {formatBytes(job.sizeEstimateBytes)} ({percent}%)
          </p>
        </div>
      ) : (
        job &&
        job.bytesTransferred > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatBytes(job.bytesTransferred)} transferred
          </p>
        )
      )}
    </div>
  );
}

function MigrationResult({
  job,
  peerName,
}: {
  job: MigrationJobDTO | null;
  peerName: string | null;
}) {
  const report = parseConflictReport(job?.conflictReportJson);
  if (!job) {
    return (
      <p className="text-sm text-muted-foreground py-2">No job information.</p>
    );
  }
  if (job.status === "completed") {
    return (
      <div className="space-y-3 py-2">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
          <div className="min-w-0 text-sm">
            <p className="text-foreground font-medium">
              Migration completed{peerName ? ` to ${peerName}` : ""}.
            </p>
            {job.destProjectId && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Destination project id:{" "}
                <code className="font-mono">{job.destProjectId}</code>
              </p>
            )}
            {job.removeSourceAfterVerify && (
              <p className="text-xs text-muted-foreground mt-0.5">
                The source project was removed from this instance.
              </p>
            )}
          </div>
        </div>
        <ConflictList report={report} />
      </div>
    );
  }
  if (job.status === "aborted") {
    return (
      <div className="flex items-start gap-2 py-2 text-sm">
        <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Migration aborted. Anything already imported on the destination was
          rolled back (best effort).
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-start gap-2 text-sm">
        <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-foreground font-medium">Migration failed.</p>
          {job.errorMessage && (
            <pre className="mt-1 text-xs text-destructive whitespace-pre-wrap break-all font-mono">
              {job.errorMessage}
            </pre>
          )}
        </div>
      </div>
      <ConflictList report={report} />
    </div>
  );
}

function ConflictList({ report }: { report: ReturnType<typeof parseConflictReport> }) {
  if (!report || report.conflicts.length === 0) return null;
  return (
    <details className="rounded-md border border-border bg-card/30">
      <summary className="cursor-pointer text-sm font-medium p-2.5">
        {report.conflicts.length}{" "}
        {report.conflicts.length === 1 ? "conflict" : "conflicts"} resolved during
        import
      </summary>
      <ul className="px-3 pb-3 space-y-1.5">
        {report.conflicts.map((c, i) => (
          <li key={i} className="text-xs">
            <span className="font-mono text-muted-foreground">{c.type}</span>{" "}
            <span className="text-foreground">{c.message}</span>
            {c.detail && (
              <span className="block text-muted-foreground">{c.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
