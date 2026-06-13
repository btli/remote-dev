/**
 * Client-side types + pure formatting helpers for the server-to-server
 * project migration UI (stage 3).
 *
 * The DTO interfaces mirror the stage-1 API responses with Date fields
 * serialized to ISO strings (NextResponse.json serializes Date → string):
 *   - GET  /api/peers                     → { peers: PeerInstanceDTO[] }
 *   - GET  /api/peers/:id/capabilities    → { capabilities: PeerCapabilitiesDTO }
 *   - GET  /api/migrations[?projectId=]   → { jobs: MigrationJobDTO[] } (createdAt ASC)
 *   - GET  /api/migrations/:id            → { job: MigrationJobDTO }
 *   - POST /api/migrations                → 202 { jobId, status }
 *   - POST /api/migrations/size-preview   → SizePreviewDTO (stage 2 — may 404)
 */
import type {
  MigrationJobStatus,
  MigrationWorkingTreeMode,
} from "@/types/migration";

/** Capabilities advertised by a peer's GET /api/migration/capabilities. */
export interface PeerCapabilitiesDTO {
  version: number;
  maxChunkBytes: number;
  appVersion: string;
}

/** Masked, API-safe view of a registered peer instance. */
export interface PeerInstanceDTO {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  cfAccessClientId: string | null;
  hasCfAccessSecret: boolean;
  capabilities: PeerCapabilitiesDTO | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** SOURCE-side migration job row as returned by /api/migrations[/:id]. */
export interface MigrationJobDTO {
  id: string;
  projectId: string;
  peerInstanceId: string | null;
  status: MigrationJobStatus;
  workingTreeMode: MigrationWorkingTreeMode;
  includeDotEnv: boolean;
  includeAgentCreds: boolean;
  includeSshKeys: boolean;
  includeAgentSettings: boolean;
  includeChannelHistory: boolean;
  removeSourceAfterVerify: boolean;
  sizeEstimateBytes: number | null;
  bytesTransferred: number;
  destProjectId: string | null;
  conflictReportJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/migrations/size-preview response (stage 2 — degrade on 404). */
export interface SizePreviewDTO {
  workingTreeBytes: number;
  profilesBytes: number;
  agentSettingsBytes: number;
  totalBytes: number;
  warning?: string;
}

/** One entry of the conflict report persisted on the job row. */
export interface ConflictEntry {
  type: string;
  message: string;
  detail?: string;
}

/**
 * Shape of `conflictReportJson` as persisted by the source-side runner:
 * `{ conflicts, rowCounts, verify }` (see migration-service startJob).
 */
export interface ParsedConflictReport {
  conflicts: ConflictEntry[];
  rowCounts: Record<string, number>;
  verify?: {
    ok: boolean;
    rowCounts: Record<string, number>;
    missingPaths: string[];
  };
}

const TERMINAL_STATUSES: ReadonlySet<MigrationJobStatus> = new Set([
  "completed",
  "failed",
  "aborted",
]);

/** True when the job can no longer change state (stop polling). */
export function isTerminalMigrationStatus(status: MigrationJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Human phase label for a job status (progress step + job list). */
export function migrationPhaseLabel(status: MigrationJobStatus): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Transferring database rows";
    case "db_done":
      return "Database transferred";
    case "files_done":
      return "Files transferred";
    case "verifying":
      return "Verifying on destination";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "aborted":
      return "Aborted";
  }
}

/** Short labels for the working-tree mode radio + job list. */
export function workingTreeModeLabel(mode: MigrationWorkingTreeMode): string {
  switch (mode) {
    case "full_tar":
      return "Full copy";
    case "git_essentials":
      return "Git clone + essentials";
    case "none":
      return "No files";
  }
}

/**
 * Format a byte count for display ("1.2 GB"). Returns "—" for null /
 * undefined / negative values so call sites can pass optional fields through.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${unit}`;
}

/**
 * Determinate progress percent (0–100) when both byte counters are usable,
 * else null (callers fall back to an indeterminate presentation).
 */
export function migrationProgressPercent(
  bytesTransferred: number,
  sizeEstimateBytes: number | null,
): number | null {
  if (
    sizeEstimateBytes == null ||
    !Number.isFinite(sizeEstimateBytes) ||
    sizeEstimateBytes <= 0 ||
    bytesTransferred < 0
  ) {
    return null;
  }
  return Math.min(100, Math.round((bytesTransferred / sizeEstimateBytes) * 100));
}

/** Safe-parse the persisted conflict report. Null on absent/garbage JSON. */
export function parseConflictReport(
  raw: string | null | undefined,
): ParsedConflictReport | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Partial<ParsedConflictReport>;
    return {
      conflicts: Array.isArray(obj.conflicts) ? obj.conflicts : [],
      rowCounts:
        typeof obj.rowCounts === "object" && obj.rowCounts !== null
          ? obj.rowCounts
          : {},
      verify: obj.verify,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a displayable message from an API error response. Handles both
 * `errorResponse` strings ({ error: "msg" }) and zod issue arrays
 * ({ error: [{ message }] }).
 */
export async function readApiError(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (typeof data === "object" && data !== null && "error" in data) {
      const err = (data as { error: unknown }).error;
      if (typeof err === "string") return err;
      if (Array.isArray(err)) {
        const first = err[0] as { message?: unknown } | undefined;
        if (first && typeof first.message === "string") return first.message;
      }
    }
  } catch {
    // Non-JSON body — fall through to the fallback.
  }
  return `${fallback} (HTTP ${res.status})`;
}
