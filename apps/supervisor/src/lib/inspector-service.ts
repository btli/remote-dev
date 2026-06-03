/**
 * Storage inspector service (remote-dev-jvcx.16) — READ-ONLY browsing of an
 * instance's persistent data volume (PVC `data-rdv-0`) via an EPHEMERAL,
 * self-deleting Kubernetes Job, even when the instance is STOPPED.
 *
 * Mirrors `provisioner-service.ts`: k8s clients are DEPENDENCY-INJECTED
 * ({@link K8sClients}) so this is unit-testable with mocks and never imports a
 * live cluster at module load. Typed errors carry actionable messages.
 *
 * SINGLE-WRITER NOTE (read this before assuming a violation): the reconciler is
 * the sole writer of instance LIFECYCLE state (status / StatefulSet / namespace
 * lifecycle). The inspector Jobs created here are EPHEMERAL, namespaced,
 * read-only, and self-deleting; they NEVER touch lifecycle state. Creating them
 * from the API process is therefore acceptable — exactly analogous to the logs
 * route reading pod logs live. This is NOT a single-writer violation.
 *
 * Mechanism per call:
 *   1. (best-effort) read the instance pod `rdv-0`; if Running, capture its
 *      `spec.nodeName` so an RWO volume already mounted on that node can be
 *      shared read-only.
 *   2. create a one-shot Job `rdv-inspect-<short-uuid>` mounting the PVC
 *      read-only at /inspect; its Node container emits ONE JSON line.
 *   3. poll the Job's pod to completion; read the pod log; parse the JSON line.
 *   4. delete the Job (background propagation; ignore-404) and return.
 *
 * The instance image is Node-based, so the in-pod script is a `node -e`
 * one-liner using fs.readdirSync/statSync + JSON.stringify (correct escaping).
 * The JS is embedded in the Job args (no shell quoting) and the requested path
 * is passed via an env var (no interpolation into the JS source).
 */

import crypto from "node:crypto";
import { ApiException } from "@kubernetes/client-node";
import { namespaceForSlug } from "@/lib/slug";
import { buildInspectorJob, INSPECT_DIR } from "@/lib/provisioner-builders";
import { readProvisionEnv } from "@/controller/reconciler";
import { defaultClients, type K8sClients } from "@/lib/provisioner-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("Inspector");

export { defaultClients };
export type { K8sClients };

/** Cap on directory entries returned per listing (surfaced via `truncated`). */
export const MAX_ENTRIES = 1000;

/** Cap on a single file's size for download (bytes) — 5 MiB. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Total budget to wait for an inspector Job to complete (ms). */
const COMPLETION_BUDGET_MS = 45_000;

/** Budget to wait for the Job's pod to leave Pending (ms) — a stuck mount. */
const PENDING_BUDGET_MS = 20_000;

/** Poll interval while waiting for the Job/pod (ms). */
const POLL_INTERVAL_MS = 1_000;

// ── Typed errors ─────────────────────────────────────────────────────────────

/** Base for all inspector failures (so routes can branch on `instanceof`). */
export class InspectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectorError";
  }
}

/** The Job did not complete within the budget (likely a node-pinned volume). */
export class InspectorTimeoutError extends InspectorError {
  constructor(message: string) {
    super(message);
    this.name = "InspectorTimeoutError";
  }
}

/** The pod stayed Pending past a short budget — the volume could not be mounted. */
export class InspectorPendingError extends InspectorError {
  constructor(message: string) {
    super(message);
    this.name = "InspectorPendingError";
  }
}

/** The pod log was not the single JSON line we expected. */
export class InspectorParseError extends InspectorError {
  constructor(message: string) {
    super(message);
    this.name = "InspectorParseError";
  }
}

/** A path that fails the traversal-safety check (rejected before any Job runs). */
export class InspectorPathError extends InspectorError {
  constructor(message: string) {
    super(message);
    this.name = "InspectorPathError";
  }
}

// ── Path safety ──────────────────────────────────────────────────────────────

/**
 * Normalize a user-supplied path to a RELATIVE path under /inspect, rejecting
 * any `..` traversal or absolute escape. Returns the cleaned relative path
 * (no leading slash; "" for the root). Throws {@link InspectorPathError} on a
 * traversal attempt. The in-pod script ALSO re-validates (defence in depth).
 *
 * Rules: split on `/`, drop empty + `.` segments, REJECT any `..` segment. A
 * leading `/` is allowed (it just anchors to /inspect) but `\0` and `..` are not.
 */
export function safeRelativePath(input: string): string {
  if (input.includes("\0")) {
    throw new InspectorPathError("path contains a null byte");
  }
  const segments = input.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      throw new InspectorPathError(`path traversal ("..") is not allowed: ${input}`);
    }
    out.push(seg);
  }
  return out.join("/");
}

// ── In-pod scripts (Node one-liners) ─────────────────────────────────────────

/**
 * Node program that lists `${INSPECT_DIR}/${RDV_INSPECT_PATH}` and prints ONE
 * JSON line. Bounds the entry count at {@link MAX_ENTRIES} (truncated=true if
 * exceeded — never silently). Re-validates the path against `..` (defence in
 * depth). On any error emits `{ok:false,error}` and exits 0 so the log is
 * readable. The path comes from an env var — NOT interpolated into this source.
 */
const LIST_SCRIPT = `
const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(INSPECT_DIR)};
const MAX = ${MAX_ENTRIES};
function emit(o){process.stdout.write(JSON.stringify(o)+"\\n");}
try {
  const rel = process.env.RDV_INSPECT_PATH || "";
  if (rel.split("/").includes("..")) { emit({ok:false,error:"path traversal not allowed"}); process.exit(0); }
  const dir = path.join(ROOT, rel);
  const resolved = path.resolve(dir);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) { emit({ok:false,error:"path escapes /inspect"}); process.exit(0); }
  const dirents = fs.readdirSync(resolved, { withFileTypes: true });
  const entries = [];
  let truncated = false;
  for (const d of dirents) {
    if (entries.length >= MAX) { truncated = true; break; }
    let type = "other";
    if (d.isDirectory()) type = "dir";
    else if (d.isFile()) type = "file";
    let size = 0, mtimeMs = 0;
    try { const st = fs.statSync(path.join(resolved, d.name)); size = st.size; mtimeMs = st.mtimeMs; } catch (e) {}
    entries.push({ name: d.name, type, size, mtimeMs });
  }
  emit({ ok: true, path: rel, entries, truncated });
} catch (e) {
  emit({ ok: false, error: String(e && e.message || e) });
}
`;

/**
 * Node program that base64-encodes a SINGLE file at
 * `${INSPECT_DIR}/${RDV_INSPECT_PATH}` IF ≤ {@link MAX_FILE_BYTES}. Emits ONE
 * JSON line: `{ok:true,path,size,base64}` or `{ok:false,error}`. Same path
 * re-validation as the list script.
 */
const READ_SCRIPT = `
const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(INSPECT_DIR)};
const MAX = ${MAX_FILE_BYTES};
function emit(o){process.stdout.write(JSON.stringify(o)+"\\n");}
try {
  const rel = process.env.RDV_INSPECT_PATH || "";
  if (rel.split("/").includes("..")) { emit({ok:false,error:"path traversal not allowed"}); process.exit(0); }
  const file = path.join(ROOT, rel);
  const resolved = path.resolve(file);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) { emit({ok:false,error:"path escapes /inspect"}); process.exit(0); }
  const st = fs.statSync(resolved);
  if (!st.isFile()) { emit({ok:false,error:"not a regular file"}); process.exit(0); }
  if (st.size > MAX) { emit({ok:false,error:"file too large ("+st.size+" bytes); use a terminal"}); process.exit(0); }
  const buf = fs.readFileSync(resolved);
  emit({ ok: true, path: rel, size: st.size, base64: buf.toString("base64") });
} catch (e) {
  emit({ ok: false, error: String(e && e.message || e) });
}
`;

// ── Parsed-result shapes ─────────────────────────────────────────────────────

export type EntryType = "dir" | "file" | "other";

export interface DirEntry {
  name: string;
  type: EntryType;
  size: number;
  mtimeMs: number;
}

export interface VolumeListing {
  path: string;
  entries: DirEntry[];
  truncated: boolean;
}

export interface FileContent {
  path: string;
  size: number;
  /** The raw file bytes. */
  content: Buffer;
}

/** Injectable timing seam for fast unit tests (no real waits). */
export interface InspectorDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function defaultInspectorDeps(): InspectorDeps {
  return {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}

function statusCode(err: unknown): number | undefined {
  return err instanceof ApiException ? err.code : undefined;
}

function isNotFound(err: unknown): boolean {
  return statusCode(err) === 404;
}

/** A short, DNS-safe job-name suffix. */
function shortId(): string {
  return crypto.randomUUID().split("-")[0];
}

// ── Core: dispatch a Job, poll, read its log, clean up ───────────────────────

/**
 * Read the instance pod's nodeName IF it is Running (best-effort). Returns
 * undefined when no pod / not running / any read error — the caller then omits
 * nodeName (NFS schedules anywhere; node-pinned local-path relies on PV
 * nodeAffinity, which surfaces as a Pending/timeout the caller maps to a clear
 * "Start it to browse" message).
 */
async function runningNodeName(
  slug: string,
  clients: K8sClients,
): Promise<string | undefined> {
  const namespace = namespaceForSlug(slug);
  try {
    const pod = await clients.core.readNamespacedPod({ name: "rdv-0", namespace });
    if (pod.status?.phase === "Running") return pod.spec?.nodeName ?? undefined;
    return undefined;
  } catch {
    return undefined;
  }
}

/** The terminal-or-still-running state of a Job's pod, distilled for polling. */
interface JobPodState {
  /** Job succeeded (pod completed). */
  succeeded: boolean;
  /** Job failed (backoffLimit 0 → one failed pod). */
  failed: boolean;
  /** The pod is still Pending (likely an unmountable / node-pinned volume). */
  pending: boolean;
  /** The resolved pod name, when one exists. */
  podName?: string;
}

/** Inspect a Job + its pod by label and distil the polling state. */
async function readJobPodState(
  namespace: string,
  jobName: string,
  clients: K8sClients,
): Promise<JobPodState> {
  // The Job's pods carry the controller-uid; we find them by the job-name label
  // k8s sets automatically (`job-name=<jobName>`).
  let podName: string | undefined;
  let pending = false;
  let podSucceeded = false;
  let podFailed = false;
  try {
    const pods = await clients.core.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });
    const pod = pods.items[0];
    podName = pod?.metadata?.name;
    const phase = pod?.status?.phase;
    pending = phase === "Pending";
    podSucceeded = phase === "Succeeded";
    podFailed = phase === "Failed";
  } catch (err) {
    log.debug("inspector listNamespacedPod failed (will retry)", {
      jobName,
      error: String(err),
    });
  }

  // The Job status is authoritative for completion; the pod phase covers the
  // brief window before the Job controller updates its counters.
  let jobSucceeded = false;
  let jobFailed = false;
  try {
    const job = await clients.batch.readNamespacedJob({ name: jobName, namespace });
    jobSucceeded = (job.status?.succeeded ?? 0) >= 1;
    jobFailed = (job.status?.failed ?? 0) >= 1;
  } catch (err) {
    log.debug("inspector readNamespacedJob failed (will retry)", {
      jobName,
      error: String(err),
    });
  }

  return {
    succeeded: jobSucceeded || podSucceeded,
    failed: jobFailed || podFailed,
    pending,
    podName,
  };
}

/** Delete the Job (background propagation so its pod is GC'd); ignore 404. */
async function deleteJob(
  namespace: string,
  jobName: string,
  clients: K8sClients,
): Promise<void> {
  try {
    await clients.batch.deleteNamespacedJob({
      name: jobName,
      namespace,
      propagationPolicy: "Background",
    });
  } catch (err) {
    if (isNotFound(err)) return;
    log.warn("inspector Job cleanup failed (leaked; TTL will GC)", {
      jobName,
      error: String(err),
    });
  }
}

/**
 * Dispatch an inspector Job running `script` with `relPath` in env, poll to
 * completion, read the single JSON line from its pod log, and clean up. Returns
 * the PARSED JSON object (the caller validates `ok` + shape). Throws the typed
 * inspector errors on timeout / pending / parse failure.
 */
async function runInspectorJob(
  slug: string,
  script: string,
  relPath: string,
  clients: K8sClients,
  deps: InspectorDeps,
): Promise<Record<string, unknown>> {
  const namespace = namespaceForSlug(slug);
  const env = readProvisionEnv();
  const jobName = `rdv-inspect-${shortId()}`;

  const nodeName = await runningNodeName(slug, clients);

  const job = buildInspectorJob({
    slug,
    name: jobName,
    image: env.image,
    imagePullSecretName: env.imagePullSecret?.name,
    nodeName,
    // node -e <script>; the requested path rides in env (RDV_INSPECT_PATH), never
    // interpolated into the JS source. The container's WORKDIR/user is the image
    // default; the script only reads under /inspect.
    command: ["node", "-e", script],
  });
  // Inject the path env onto the container (the builder leaves env unset).
  const container = job.spec?.template?.spec?.containers?.[0];
  if (container) {
    container.env = [{ name: "RDV_INSPECT_PATH", value: relPath }];
  }

  log.info("dispatching inspector Job", { slug, jobName, path: relPath, nodeName });

  try {
    await clients.batch.createNamespacedJob({ namespace, body: job });
  } catch (err) {
    // A failed create is fatal for this request; clean up best-effort and rethrow
    // as a generic InspectorError so the route degrades (it never 500s on cluster
    // issues — see the route).
    await deleteJob(namespace, jobName, clients);
    throw new InspectorError(`could not create inspector job: ${String(err)}`);
  }

  try {
    const start = deps.now();
    let sawNonPending = false;
    for (;;) {
      const state = await readJobPodState(namespace, jobName, clients);

      if (state.succeeded) {
        return await readJobResult(namespace, jobName, state.podName, clients);
      }
      if (state.failed) {
        // backoffLimit 0 → a failed pod is final. Read whatever it logged (the
        // script emits ok:false + exits 0 on its own errors, so a hard Failed
        // here is usually an image / scheduling problem).
        throw new InspectorError("inspector job failed");
      }

      if (!state.pending) sawNonPending = true;

      const elapsed = deps.now() - start;
      // A pod stuck Pending past the short budget → unmountable volume. The most
      // common cause is a node-pinned (local-path) volume while the instance is
      // STOPPED; tell the operator to Start it.
      if (state.pending && !sawNonPending && elapsed > PENDING_BUDGET_MS) {
        throw new InspectorPendingError(
          "Could not mount the volume — if the workspace is STOPPED and its " +
            "storage is node-pinned, Start it to browse.",
        );
      }
      if (elapsed > COMPLETION_BUDGET_MS) {
        throw new InspectorTimeoutError(
          "Inspector did not finish in time — the volume may be node-pinned " +
            "while the workspace is stopped; Start it and retry.",
        );
      }
      await deps.sleep(POLL_INTERVAL_MS);
    }
  } finally {
    // Always clean up — success or failure (the TTL is only a backstop).
    await deleteJob(namespace, jobName, clients);
  }
}

/** Read the completed Job's pod log and parse the single JSON line. */
async function readJobResult(
  namespace: string,
  jobName: string,
  podName: string | undefined,
  clients: K8sClients,
): Promise<Record<string, unknown>> {
  let name = podName;
  if (!name) {
    // Resolve the pod by the job-name label if the poll loop didn't capture it.
    try {
      const pods = await clients.core.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      name = pods.items[0]?.metadata?.name;
    } catch {
      // fall through to the no-pod error below
    }
  }
  if (!name) {
    throw new InspectorParseError("inspector pod not found after completion");
  }

  let raw: string;
  try {
    raw = await clients.core.readNamespacedPodLog({ name, namespace, container: "inspect" });
  } catch (err) {
    throw new InspectorParseError(`could not read inspector log: ${String(err)}`);
  }

  // The script prints EXACTLY one JSON line; take the last non-empty line to be
  // robust against any stray stdout the runtime might prepend.
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .pop();
  if (!line) {
    throw new InspectorParseError("inspector produced no output");
  }
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    throw new InspectorParseError(`inspector output was not valid JSON: ${String(err)}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * List a directory under the instance's data volume. `path` is user-supplied
 * (validated + normalized here AND in the pod). Returns the listing or throws a
 * typed inspector error.
 */
export async function listVolume(
  slug: string,
  path: string,
  clients: K8sClients = defaultClients(),
  deps: InspectorDeps = defaultInspectorDeps(),
): Promise<VolumeListing> {
  const rel = safeRelativePath(path);
  const result = await runInspectorJob(slug, LIST_SCRIPT, rel, clients, deps);

  if (result.ok !== true) {
    throw new InspectorError(
      typeof result.error === "string" ? result.error : "inspector reported an error",
    );
  }
  const entriesRaw = Array.isArray(result.entries) ? result.entries : [];
  const entries: DirEntry[] = entriesRaw.map((e) => {
    const o = e as Record<string, unknown>;
    const t = o.type;
    const type: EntryType = t === "dir" || t === "file" ? t : "other";
    return {
      name: String(o.name ?? ""),
      type,
      size: typeof o.size === "number" ? o.size : 0,
      mtimeMs: typeof o.mtimeMs === "number" ? o.mtimeMs : 0,
    };
  });
  return {
    path: typeof result.path === "string" ? result.path : rel,
    entries,
    truncated: result.truncated === true,
  };
}

/**
 * Read a SINGLE file under the instance's data volume (≤ {@link MAX_FILE_BYTES}).
 * Returns the bytes + metadata or throws a typed inspector error (a too-large
 * file surfaces as an InspectorError with the in-pod "file too large" message).
 */
export async function readFile(
  slug: string,
  path: string,
  clients: K8sClients = defaultClients(),
  deps: InspectorDeps = defaultInspectorDeps(),
): Promise<FileContent> {
  const rel = safeRelativePath(path);
  const result = await runInspectorJob(slug, READ_SCRIPT, rel, clients, deps);

  if (result.ok !== true) {
    throw new InspectorError(
      typeof result.error === "string" ? result.error : "inspector reported an error",
    );
  }
  if (typeof result.base64 !== "string") {
    throw new InspectorParseError("inspector returned no file content");
  }
  return {
    path: typeof result.path === "string" ? result.path : rel,
    size: typeof result.size === "number" ? result.size : 0,
    content: Buffer.from(result.base64, "base64"),
  };
}
