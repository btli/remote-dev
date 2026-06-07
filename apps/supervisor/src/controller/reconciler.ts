/**
 * Instance reconciler (spec §6.3, §6.4) — the body of the controller's 30s tick.
 *
 * Each tick loads non-terminal instances from the DB and drives each one's state
 * machine off LIVE k8s state, recording every transition in `instance_audit_log`
 * and stamping `lastReconciledAt`:
 *
 *   requested    → claim as `provisioning`, generate a UNIQUE AUTH_SECRET, then
 *                  provisionInstance(...); success stays `provisioning` (next tick
 *                  promotes to ready); a ProvisioningError → `error` (rollback
 *                  already deleted the namespace inside the service).
 *   provisioning → checkInstanceReady: ready → `ready` (+ provisionedAt, baseUrl);
 *                  within the readiness budget but the StatefulSet is MISSING →
 *                  re-run provisionInstance (idempotent self-heal of a crashed/
 *                  partial provision); past the budget → `error` AND delete the
 *                  namespace so no partial objects are orphaned. The budget is
 *                  anchored to the claim write and is NOT reset by ticks. It
 *                  defaults to 6 min and is overridable via
 *                  SUPERVISOR_READINESS_BUDGET_MS — see READINESS_BUDGET_MS.
 *   terminating  → if the namespace is already gone → `deleted` (+ deletedAt);
 *                  otherwise (re)issue the namespace delete.
 *   ready/suspended/error/deleted → no action this PR (suspend scaling is Phase 2).
 *
 * AUTH_SECRET LOCATION (design decision, spec Change 6): the secret is generated
 * HERE in the reconciler at the requested→provisioning step — NOT in the API and
 * NOT stored in the DB. The controller is the only process that ever holds it
 * (it goes straight into the `rdv-<slug>` Secret via provisionInstance), so it
 * never touches the API response, the API process, or the database.
 *
 * RESILIENCE: if the k8s client is unavailable (no cluster in local dev —
 * `defaultClients()`/`getKubeConfig()` throws), the tick logs a warning and
 * returns WITHOUT marking anything `error`. Only an actual ProvisioningError or
 * a real readiness timeout transitions an instance to `error`.
 */

import crypto from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
  instance,
  instanceAuditLog,
  instanceSeed,
  type InstanceRow,
  type InstanceStatus,
} from "@/db/schema";
import { assertTransition } from "@/lib/instance-state";
import {
  resolveDefaultStorageTarget,
  resolvedFromSnapshot,
  type ResolvedStorageTarget,
} from "@/lib/storage";
import {
  provisionInstance as defaultProvisionInstance,
  checkInstanceReady as defaultCheckInstanceReady,
  terminateInstance as defaultTerminateInstance,
  namespaceExists as defaultNamespaceExists,
  getNamespaceLabels as defaultGetNamespaceLabels,
  getStatefulSet as defaultGetStatefulSet,
  setStatefulSetReplicas as defaultSetStatefulSetReplicas,
  setStatefulSetImage as defaultSetStatefulSetImage,
  getPvc as defaultGetPvc,
  resizePvc as defaultResizePvc,
  parseQuantityToBytes,
  defaultClients,
  ProvisioningError,
  type K8sClients,
  type ProvisionOptions,
} from "@/lib/provisioner-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("Reconciler");

/** Default readiness budget when SUPERVISOR_READINESS_BUDGET_MS is unset/invalid (6 min). */
const DEFAULT_READINESS_BUDGET_MS = 360_000;

/**
 * Parse the readiness budget (ms) from `SUPERVISOR_READINESS_BUDGET_MS`.
 *
 * Accepts only a FINITE, POSITIVE integer number of milliseconds; anything else
 * (unset, empty, non-numeric, zero, negative, fractional, NaN/Infinity) falls
 * back to {@link DEFAULT_READINESS_BUDGET_MS}. Exported for unit testing.
 */
export function parseReadinessBudgetMs(
  raw: string | undefined = process.env.SUPERVISOR_READINESS_BUDGET_MS,
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_READINESS_BUDGET_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_READINESS_BUDGET_MS;
  return n;
}

/**
 * Readiness budget: provisioning → error (AND namespace delete) if not ready
 * within this window (§6.3). Anchored to the claim write, NOT reset by ticks.
 *
 * Default 6 min (360_000 ms), overridable via SUPERVISOR_READINESS_BUDGET_MS.
 * Raised from the original 120s (remote-dev-qy7t): a cold fresh-PG instance's
 * create→ready path (large dev-env image pull + Next boot + PG migrate-on-boot
 * + the instance's own waitForSchemaReady, itself fail-open at 120s per PR #358,
 * + terminal-server start) routinely exceeds 120s. Live audit evidence: a
 * SUCCESSFUL provision took 115s (only 5s of headroom) while others hit
 * provision:timeout at ~120-150s and were reaped + namespace-deleted just before
 * they would have become ready. The generous default fixes this with no k8s
 * config change; operators can still tune it via the env var.
 */
export const READINESS_BUDGET_MS = parseReadinessBudgetMs();

/**
 * Statuses the reconciler never acts on. `error` and `deleted` are terminal /
 * passive — they need no convergence. `ready` and `suspended` are NOT inactive
 * anymore (Phase 2): the reconciler now converges their StatefulSet to the
 * desired replica count + image + PVC size via {@link reconcileSteadyState}.
 */
const INACTIVE_STATUSES: InstanceStatus[] = ["error", "deleted"];

/**
 * Injectable dependencies — defaulted to the real implementations, overridden in
 * unit tests to mock the DB + provisioner + clock without a cluster.
 */
export interface ReconcilerDeps {
  db: typeof defaultDb;
  provisionInstance: typeof defaultProvisionInstance;
  checkInstanceReady: typeof defaultCheckInstanceReady;
  terminateInstance: typeof defaultTerminateInstance;
  namespaceExists: typeof defaultNamespaceExists;
  // Reads a namespace's labels for the label-gated image auto-roll (tpb5).
  getNamespaceLabels: typeof defaultGetNamespaceLabels;
  // Phase 2 steady-state convergence helpers (injected for unit tests).
  getStatefulSet: typeof defaultGetStatefulSet;
  setStatefulSetReplicas: typeof defaultSetStatefulSetReplicas;
  setStatefulSetImage: typeof defaultSetStatefulSetImage;
  getPvc: typeof defaultGetPvc;
  resizePvc: typeof defaultResizePvc;
  /** Returns the injected k8s clients; THROWS when no cluster is available. */
  getClients: () => K8sClients;
  now: () => Date;
}

function defaultDeps(): ReconcilerDeps {
  return {
    db: defaultDb,
    provisionInstance: defaultProvisionInstance,
    checkInstanceReady: defaultCheckInstanceReady,
    terminateInstance: defaultTerminateInstance,
    namespaceExists: defaultNamespaceExists,
    getNamespaceLabels: defaultGetNamespaceLabels,
    getStatefulSet: defaultGetStatefulSet,
    setStatefulSetReplicas: defaultSetStatefulSetReplicas,
    setStatefulSetImage: defaultSetStatefulSetImage,
    getPvc: defaultGetPvc,
    resizePvc: defaultResizePvc,
    getClients: defaultClients,
    now: () => new Date(),
  };
}

/** Warn-once guard for the dev-only "instances will lack CF Access" notice. */
let warnedMissingCfAccess = false;

/**
 * Parse `SUPERVISOR_INSTANCE_NODE_SELECTOR` — a comma-separated list of
 * `key=value` pairs (e.g. `kubernetes.io/arch=amd64,disktype=ssd`) — into the
 * `Record<string, string>` a pod `nodeSelector` takes (remote-dev-389c).
 *
 * undefined/empty/whitespace → undefined (no pinning). A trailing comma (empty
 * entry) is tolerated. A malformed entry (no `=`, or an empty key) THROWS so a
 * typo surfaces loudly as a per-instance `error` rather than silently skipping
 * the arch pin and letting the pod crashloop on the wrong node.
 */
export function parseNodeSelector(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const selector: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue; // tolerate a trailing comma
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? "" : trimmed.slice(0, eq).trim();
    if (eq === -1 || key === "") {
      throw new Error(
        `SUPERVISOR_INSTANCE_NODE_SELECTOR is malformed (expected key=value,...): ${raw}`,
      );
    }
    selector[key] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(selector).length > 0 ? selector : undefined;
}

/**
 * Validate `SUPERVISOR_INSTANCE_BASELINE_PACKAGES` — an OPTIONAL JSON manifest
 * string injected verbatim into every provisioned instance as RDV_PROVISION_BASELINE
 * (remote-dev-uobt). The instance entrypoint merges it with the per-instance PVC
 * manifest, so the supervisor side only needs to confirm it parses as JSON and
 * pass the ORIGINAL string through unchanged.
 *
 * undefined/empty/whitespace → undefined (no baseline). Malformed JSON THROWS
 * (mirroring {@link parseNodeSelector}) so a typo surfaces loudly as a per-instance
 * `error` rather than silently shipping a broken baseline. Returns the original,
 * untouched string (NOT a re-serialized object) so instances see exactly what the
 * operator configured.
 */
export function parseProvisionBaseline(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === "") return undefined;
  try {
    JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `SUPERVISOR_INSTANCE_BASELINE_PACKAGES is not valid JSON: ${String(err)}`,
    );
  }
  return raw;
}

/**
 * Read the instance image/host/CF-Access config from env (validated lazily).
 *
 * SUPERVISOR_INSTANCE_IMAGE / SUPERVISOR_INSTANCE_HOST are always required.
 *
 * CF_ACCESS_TEAM / CF_ACCESS_AUD are the INSTANCE app's Cloudflare Access tags
 * (distinct from the supervisor's own SUPERVISOR_CF_ACCESS_*). They are baked
 * into each instance's `rdv-shared` Secret; if empty, the provisioned instance
 * cannot enforce CF Access. In production we therefore REQUIRE them (a throw
 * here becomes a per-instance `error`, never a silently auth-broken instance).
 * In dev we allow empty but warn once.
 */
export function readProvisionEnv(): {
  image: string;
  host: string;
  cfAccess: { team: string; aud: string };
  github?: { clientId: string; clientSecret: string };
  oidc?: { issuer: string; clientId: string; clientSecret: string; name: string };
  fcm?: { projectId: string; serviceAccountJson: string };
  imagePullSecret?: { name: string; dockerConfigJson?: string };
  nodeSelector?: Record<string, string>;
  provisionBaseline?: string;
} {
  const image = process.env.SUPERVISOR_INSTANCE_IMAGE;
  const host = process.env.SUPERVISOR_INSTANCE_HOST;
  if (!image) throw new Error("SUPERVISOR_INSTANCE_IMAGE is not set");
  if (!host) throw new Error("SUPERVISOR_INSTANCE_HOST is not set");

  const team = process.env.CF_ACCESS_TEAM ?? "";
  const aud = process.env.CF_ACCESS_AUD ?? "";
  if (!team || !aud) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CF_ACCESS_TEAM and CF_ACCESS_AUD are required in production " +
          "(provisioned instances would otherwise be unable to enforce Cloudflare Access)",
      );
    }
    if (!warnedMissingCfAccess) {
      warnedMissingCfAccess = true;
      log.warn(
        "CF_ACCESS_TEAM/CF_ACCESS_AUD not set; provisioned instances will lack Cloudflare Access (dev only)",
      );
    }
  }

  const github =
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        }
      : undefined;

  // Optional OIDC (e.g. Authentik) injected into every provisioned instance so
  // instances are loginable via the IdP on the LAN (the base app's src/auth.ts
  // reads OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET, label OIDC_NAME). Present
  // ONLY when issuer + clientId + clientSecret are all set; NAME defaults to
  // "Authentik". The clientSecret is a SECRET — never logged.
  const oidc =
    process.env.SUPERVISOR_INSTANCE_OIDC_ISSUER &&
    process.env.SUPERVISOR_INSTANCE_OIDC_CLIENT_ID &&
    process.env.SUPERVISOR_INSTANCE_OIDC_CLIENT_SECRET
      ? {
          issuer: process.env.SUPERVISOR_INSTANCE_OIDC_ISSUER,
          clientId: process.env.SUPERVISOR_INSTANCE_OIDC_CLIENT_ID,
          clientSecret: process.env.SUPERVISOR_INSTANCE_OIDC_CLIENT_SECRET,
          name: process.env.SUPERVISOR_INSTANCE_OIDC_NAME || "Authentik",
        }
      : undefined;

  // Optional Firebase/FCM creds injected so provisioned instances can SEND FCM
  // push (remote-dev-wnl4). The instance's container.ts enables FcmPushGateway
  // only when BOTH FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_PATH are set, so this
  // is ALL-OR-NOTHING (mirrors the OIDC gate above): present ONLY when BOTH
  // SUPERVISOR_INSTANCE_FCM_PROJECT_ID and ..._FCM_SERVICE_ACCOUNT_JSON are set;
  // when either is missing, no FCM is injected. The service-account JSON is a
  // SECRET — never logged (it becomes a mounted Secret file in the instance).
  const fcm =
    process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID &&
    process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON
      ? {
          projectId: process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID,
          serviceAccountJson:
            process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON,
        }
      : undefined;

  // Optional image-pull credential for PRIVATE instance images (remote-dev-2xhg).
  // The dockerconfigjson is a SECRET — never logged. A dockerconfigjson with no
  // name can be neither created nor referenced, so that combination throws loud.
  const pullSecretName = process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME;
  const pullDockerConfigJson =
    process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON;
  if (pullDockerConfigJson && !pullSecretName) {
    throw new Error(
      "SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON is set but " +
        "SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME is not",
    );
  }
  const imagePullSecret = pullSecretName
    ? { name: pullSecretName, dockerConfigJson: pullDockerConfigJson || undefined }
    : undefined;

  // Optional pod nodeSelector pinning instance pods to compatible nodes on a
  // mixed-arch cluster (remote-dev-389c). Malformed → throws (caught upstream).
  const nodeSelector = parseNodeSelector(
    process.env.SUPERVISOR_INSTANCE_NODE_SELECTOR,
  );

  // Optional supervisor-wide package baseline injected into every instance
  // (remote-dev-uobt). Malformed JSON → throws (caught upstream).
  const provisionBaseline = parseProvisionBaseline(
    process.env.SUPERVISOR_INSTANCE_BASELINE_PACKAGES,
  );

  return {
    image,
    host,
    cfAccess: { team, aud },
    github,
    oidc,
    fcm,
    imagePullSecret,
    nodeSelector,
    provisionBaseline,
  };
}

/** Record an audit-log row + apply the status change (asserting legality). */
async function transition(
  deps: ReconcilerDeps,
  row: InstanceRow,
  to: InstanceStatus,
  action: string,
  extra: Partial<typeof instance.$inferInsert> = {},
  metadata?: Record<string, unknown>,
): Promise<void> {
  assertTransition(row.status, to);
  const now = deps.now();
  await deps.db
    .update(instance)
    .set({ status: to, lastReconciledAt: now, updatedAt: now, ...extra })
    .where(eq(instance.id, row.id));
  await deps.db.insert(instanceAuditLog).values({
    instanceId: row.id,
    actorId: null,
    actorEmail: "reconciler",
    action,
    previousStatus: row.status,
    newStatus: to,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
  log.info("instance transition", {
    slug: row.slug,
    from: row.status,
    to,
    action,
  });
}

/**
 * Record an audit row for a steady-state action that does NOT change the
 * instance status (scale / image rollout / resize). Status stays put, so
 * previousStatus === newStatus === row.status. Crucially this does NOT touch
 * the `instance` row (no `lastReconciledAt` write) so the convergence loop never
 * mutates the row on a pure no-op tick — only when an action was actually
 * issued does this audit row get written.
 */
async function auditAction(
  deps: ReconcilerDeps,
  row: InstanceRow,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await deps.db.insert(instanceAuditLog).values({
    instanceId: row.id,
    actorId: null,
    actorEmail: "reconciler",
    action,
    previousStatus: row.status,
    newStatus: row.status,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
  log.info("instance steady-state action", {
    slug: row.slug,
    status: row.status,
    action,
  });
}

/**
 * Build the PVC source for an instance from its SNAPSHOT (authoritative, §7).
 * The snapshot was written at create time by `resolveStorageTarget`, so the
 * reconciler rebuilds the PVC template from it WITHOUT re-querying the cluster —
 * a later edit/delete of the target can't change an existing instance's volume.
 *
 * Falls back to the cluster default only when the snapshot is absent/empty/
 * malformed (older rows from before storage targets, or a corrupt snapshot).
 */
function storageFromRow(row: InstanceRow): ResolvedStorageTarget {
  const raw = row.storageConfigSnapshot;
  if (raw && raw.trim() !== "") {
    try {
      const snapshot = JSON.parse(raw) as Record<string, unknown>;
      return resolvedFromSnapshot(snapshot);
    } catch (err) {
      log.warn("storageConfigSnapshot unusable; falling back to cluster default", {
        slug: row.slug,
        error: String(err),
      });
    }
  }
  return resolveDefaultStorageTarget(row.storageRequest ?? undefined);
}

/**
 * Read + parse the instance's first-boot authorized emails (remote-dev-sb98).
 *
 * They live in the one-to-one `instance_seed` row (written by POST /api/instances
 * when the caller supplied `authorizedEmails`), stored as a JSON string array.
 * Returns undefined when there is no seed row / no emails (so the StatefulSet gets
 * no AUTHORIZED_USERS env at all — back-compat for instances created without it).
 *
 * A malformed/unreadable seed row is NON-FATAL: log + return undefined rather than
 * fail provisioning over seed metadata. The emails then flow into the StatefulSet's
 * plain AUTHORIZED_USERS env; the instance seeds `authorized_users` from it at boot.
 */
async function readSeedEmails(
  deps: ReconcilerDeps,
  row: InstanceRow,
): Promise<string[] | undefined> {
  let seed: { authorizedEmails: string | null } | undefined;
  try {
    seed = await deps.db.query.instanceSeed.findFirst({
      where: eq(instanceSeed.instanceId, row.id),
    });
  } catch (err) {
    log.warn("failed to read instance_seed; provisioning without AUTHORIZED_USERS", {
      slug: row.slug,
      error: String(err),
    });
    return undefined;
  }
  if (!seed?.authorizedEmails) return undefined;
  try {
    const parsed: unknown = JSON.parse(seed.authorizedEmails);
    if (!Array.isArray(parsed)) return undefined;
    const emails = parsed.filter(
      (e): e is string => typeof e === "string" && e.trim().length > 0,
    );
    return emails.length > 0 ? emails : undefined;
  } catch (err) {
    log.warn("instance_seed.authorizedEmails is not valid JSON; skipping seed", {
      slug: row.slug,
      error: String(err),
    });
    return undefined;
  }
}

/**
 * Build the provisioning options for an instance (shared by the initial
 * `requested→provisioning` claim and the within-budget self-heal re-provision).
 * Generates a fresh UNIQUE AUTH_SECRET each call (never logged, never persisted).
 *
 * Storage is rebuilt from the row's authoritative `storageConfigSnapshot`
 * (see {@link storageFromRow}), NOT re-resolved live.
 *
 * First-boot authorized emails (remote-dev-sb98) are read from the `instance_seed`
 * row and ride in `authorizedEmails` → the StatefulSet's plain AUTHORIZED_USERS env
 * → the instance's boot-time seed. Reading them is idempotent across the self-heal
 * re-provision (the StatefulSet's AUTHORIZED_USERS just stays the same).
 */
async function buildProvisionOptions(
  deps: ReconcilerDeps,
  row: InstanceRow,
): Promise<ProvisionOptions> {
  const env = readProvisionEnv();
  const storage = storageFromRow(row);
  const authorizedEmails = await readSeedEmails(deps, row);
  return {
    image: env.image,
    host: env.host,
    storage,
    // UNIQUE AUTH_SECRET, generated HERE (never logged, never persisted).
    authSecret: crypto.randomBytes(32).toString("base64"),
    cfAccess: env.cfAccess,
    github: env.github,
    oidc: env.oidc,
    fcm: env.fcm,
    imagePullSecret: env.imagePullSecret,
    nodeSelector: env.nodeSelector,
    provisionBaseline: env.provisionBaseline,
    authorizedEmails,
  };
}

/**
 * Provision an instance and transition to `error` on failure. Shared by the
 * initial claim and the self-heal path. Returns true if provisioning succeeded
 * (caller leaves the row `provisioning` to be promoted to ready next tick).
 *
 * `row` MUST already be in `provisioning` (the claim happened) — on failure we
 * transition `provisioning → error`.
 */
async function attemptProvision(
  deps: ReconcilerDeps,
  row: InstanceRow,
  clients: K8sClients,
): Promise<boolean> {
  let opts: ProvisionOptions;
  try {
    opts = await buildProvisionOptions(deps, row);
  } catch (err) {
    // Misconfiguration (missing image/host/CF tags). Deterministic — won't
    // self-heal without operator action; mark error.
    await transition(deps, row, "error", "provision:failed", {
      errorMessage: String(err),
    });
    return false;
  }

  try {
    const dbConfigSnapshot = await deps.provisionInstance(row, opts, clients);
    // Postgres dual-backend (Unit 8): persist the instance's DB config snapshot
    // returned by the provisioner (the k8s/CNPG single writer doesn't own the DB
    // row). Write ONLY when it is non-null AND not already stored — so the
    // within-budget self-heal re-provision (which re-runs attemptProvision after
    // the snapshot was already persisted) does NOT bump `updatedAt` and reset the
    // readiness deadline. On the SQLite path (null) we never write.
    if (dbConfigSnapshot) {
      const serialized = JSON.stringify(dbConfigSnapshot);
      if (row.dbConfigSnapshot !== serialized) {
        try {
          await deps.db
            .update(instance)
            .set({ dbConfigSnapshot: serialized })
            .where(eq(instance.id, row.id));
        } catch (persistErr) {
          // The k8s objects AND the CNPG database already EXIST (provisionInstance
          // succeeded) — we just failed to record the snapshot. Do NOT rethrow:
          // tearing down a live, running instance over a metadata-write blip would
          // be far worse than a missing snapshot (it self-heals on a later tick,
          // since the snapshot is re-derived and re-written when it still differs).
          // Log LOUDLY so the live-but-unrecorded state is visible for manual repair.
          log.error(
            "CRITICAL: k8s objects and CNPG database EXIST but dbConfigSnapshot was " +
              "not persisted; reconcile may need manual repair",
            { slug: row.slug, instanceId: row.id, error: String(persistErr) },
          );
        }
      }
    }
    return true;
  } catch (err) {
    if (err instanceof ProvisioningError) {
      await transition(
        deps,
        row,
        "error",
        "provision:failed",
        { errorMessage: `provisioning failed at ${err.stage}` },
        { stage: err.stage },
      );
      return false;
    }
    await transition(deps, row, "error", "provision:failed", {
      errorMessage: String(err),
    });
    return false;
  }
}

/** requested → provisioning (claim) → provision. */
async function reconcileRequested(
  deps: ReconcilerDeps,
  row: InstanceRow,
  clients: K8sClients,
): Promise<void> {
  // Claim the row first so a crash mid-provision doesn't re-run from `requested`.
  // This claim write is the STABLE timeout anchor (`updatedAt`) for the
  // READINESS_BUDGET_MS window — reconcileProvisioning must not bump it on later
  // ticks.
  await transition(deps, row, "provisioning", "provision:start");
  const claimed: InstanceRow = { ...row, status: "provisioning" };
  await attemptProvision(deps, claimed, clients);
}

/**
 * provisioning →
 *   ready    when readyReplicas≥1;
 *   error    when past READINESS_BUDGET_MS (AND clean up — delete the namespace so
 *            a partial/failed provision leaves no orphaned k8s objects);
 *   (self-heal) when within budget but the StatefulSet is missing — re-run
 *            provisionInstance (idempotent, 409=success) to finish a crashed or
 *            partial provision instead of passively waiting for the timeout.
 *
 * The budget is measured from the `requested→provisioning` claim write
 * (`updatedAt`). This function MUST NOT write to the row on a non-transition
 * tick, or it would keep resetting its own deadline.
 */
async function reconcileProvisioning(
  deps: ReconcilerDeps,
  row: InstanceRow,
  clients: K8sClients,
): Promise<void> {
  const { ready, reason } = await deps.checkInstanceReady(row.slug, clients);
  if (ready) {
    const host = process.env.SUPERVISOR_INSTANCE_HOST || undefined;
    const baseUrl = host ? `https://${host}/${row.slug}` : null;
    await transition(deps, row, "ready", "ready", {
      provisionedAt: deps.now(),
      ...(baseUrl ? { baseUrl } : {}),
    });
    return;
  }

  // Not ready — measure against the STABLE claim-time anchor (`updatedAt`,
  // written by requested→provisioning; createdAt as a defensive fallback).
  const since = (row.updatedAt ?? row.createdAt).getTime();
  const age = deps.now().getTime() - since;

  if (age > READINESS_BUDGET_MS) {
    // Timed out. Mark error AND tear down the (partial) namespace so nothing is
    // orphaned in the cluster. Best-effort cleanup — log if it fails.
    try {
      await deps.terminateInstance(row.slug, clients);
    } catch (err) {
      log.error("timeout cleanup (namespace delete) failed", {
        slug: row.slug,
        error: String(err),
      });
    }
    await transition(
      deps,
      row,
      "error",
      "provision:timeout",
      { errorMessage: `not ready within ${READINESS_BUDGET_MS}ms (${reason ?? "unknown"})` },
      { reason, ageMs: age },
    );
    return;
  }

  // Within budget but the StatefulSet is absent → a crash between the claim and
  // provisionInstance completing left a partial/missing provision. Re-run it
  // (idempotent) to self-heal instead of waiting out the timeout. This does NOT
  // bump `updatedAt` (attemptProvision only writes on error), so the deadline
  // is preserved.
  if (reason === "statefulset-not-found") {
    log.info("self-healing partial provision (statefulset missing)", {
      slug: row.slug,
      ageMs: age,
    });
    await attemptProvision(deps, row, clients);
    return;
  }

  // Otherwise: still coming up within budget. No write — preserve the deadline.
  log.debug("instance still provisioning", { slug: row.slug, reason, ageMs: age });
}

/** terminating → deleted (once the namespace is gone). */
async function reconcileTerminating(
  deps: ReconcilerDeps,
  row: InstanceRow,
  clients: K8sClients,
): Promise<void> {
  // Check existence FIRST so we don't re-issue a deleteNamespace API write on
  // every 30s tick while k8s finalizers run.
  const stillThere = await deps.namespaceExists(row.slug, clients);
  if (!stillThere) {
    await transition(deps, row, "deleted", "delete", { deletedAt: deps.now() });
    return;
  }
  // Namespace still present — (re)issue the delete to drive it toward gone.
  // deleteNamespace is idempotent for an already-terminating namespace.
  await deps.terminateInstance(row.slug, clients);
  log.debug("namespace still terminating", { slug: row.slug });
}

/**
 * Steady-state convergence for `ready` (desiredReplicas=1) and `suspended`
 * (desiredReplicas=0) — spec §6.3/§9/§15 B3.
 *
 * Converges the LIVE StatefulSet toward the row's desired spec:
 *   0. (opt-in, tpb5) label-gated image auto-roll — when SUPERVISOR_INSTANCE_IMAGE
 *      is set AND the instance namespace carries `rdv.io/auto-update=true`, sync
 *      row.imageTag to the global image (persisted + audited `image:autoroll`)
 *      so step 2 rolls the StatefulSet this tick. Default (no label / ≠"true")
 *      auto-rolls NOTHING. The label read is NON-FATAL (failure → log + skip,
 *      converge next tick) and is skipped entirely when the env var is unset.
 *   1. replicas → desiredReplicas (scale subresource patch). A `suspended`
 *      instance is scaled to 0 (PVC retained); a `ready` one to 1. Because
 *      `/api/internal/routes` only serves `status === "ready"`, suspending an
 *      instance also drops it from the router allowlist with no allowlist code
 *      change. On resume the slug re-appears in the allowlist immediately while
 *      the pod takes ~10–30 s to pass its readiness probe → a brief 502/503
 *      window through the router. This blip is ACCEPTED (same class as the §9
 *      image-rollout blip); the future mitigation is router-side Endpoints
 *      readiness (§15 M4), out of scope here.
 *   2. image → row.imageTag when set and the running image differs (rolling
 *      update; audit `image:rollout`).
 *   3. storage → grow-only resize when row.storageRequest parses STRICTLY
 *      larger than the bound PVC's current request (audit `resize`). A patch
 *      rejection (e.g. a StorageClass without allowVolumeExpansion) is caught,
 *      logged, and audited `resize:failed` — it MUST NOT throw or kill the
 *      instance.
 *
 * This NEVER changes the instance status, NEVER deletes the namespace, and
 * (apart from step 0's deliberate imageTag pin on an actual auto-roll) never
 * writes the `instance` row on a pure no-op tick (only audit rows are written,
 * and only when an action was actually issued — mirroring reconcileProvisioning's
 * "must not write on a non-transition tick"). A transient `getStatefulSet` read
 * failure → log + return (no error/no delete).
 */
export async function reconcileSteadyState(
  deps: ReconcilerDeps,
  row: InstanceRow,
  clients: K8sClients,
  desiredReplicas: number,
): Promise<void> {
  let sts;
  try {
    sts = await deps.getStatefulSet(row.slug, clients);
  } catch (err) {
    // Transient read failure — do NOT error or delete; converge next tick.
    log.warn("steady-state getStatefulSet failed; will retry next tick", {
      slug: row.slug,
      status: row.status,
      error: String(err),
    });
    return;
  }

  if (!sts.found) {
    // Nothing to converge (namespace/STS not present). Don't error/delete — a
    // terminating/just-deleted instance can legitimately have no STS.
    log.debug("steady-state: statefulset not found; nothing to converge", {
      slug: row.slug,
      status: row.status,
    });
    return;
  }

  // 0. Label-gated image auto-roll (tpb5). An EXISTING instance pins its image
  //    via row.imageTag, so a global SUPERVISOR_INSTANCE_IMAGE bump does NOT
  //    reach it on its own. When (and ONLY when) SUPERVISOR_INSTANCE_IMAGE is
  //    set AND the instance's NAMESPACE carries the operator-set opt-in label
  //    `rdv.io/auto-update=true`, sync row.imageTag to the global image so the
  //    image-rollout block below (step 2) actuates the StatefulSet update THIS
  //    tick. Default (label absent or ≠ "true") = NOTHING auto-rolls — current
  //    behavior is preserved exactly. The reconciler only READS the label
  //    (`kubectl label ns rdv-<slug> rdv.io/auto-update=true` is the opt-in).
  //
  //    Reading the label is NON-FATAL: a transient API failure logs + skips the
  //    auto-roll (it converges next tick) and NEVER throws/errors/reaps. The
  //    label read is skipped entirely when SUPERVISOR_INSTANCE_IMAGE is unset so
  //    we don't add a per-tick API call to deployments that don't use it. This
  //    runs for both `ready` and `suspended` instances (both reach here); a
  //    suspended instance simply syncs its image at replicas=0 — harmless, the
  //    new image takes effect when it next scales up.
  const envImage = process.env.SUPERVISOR_INSTANCE_IMAGE;
  if (envImage && envImage !== row.imageTag) {
    let labels: Record<string, string> | undefined;
    try {
      labels = await deps.getNamespaceLabels(row.namespace, clients);
    } catch (err) {
      // Non-fatal: skip the auto-roll this tick and converge later. Must NOT
      // transition the instance to error or tear anything down.
      log.warn("steady-state getNamespaceLabels failed; skipping image auto-roll this tick", {
        slug: row.slug,
        namespace: row.namespace,
        status: row.status,
        error: String(err),
      });
      labels = undefined;
    }
    if (labels?.["rdv.io/auto-update"] === "true") {
      const fromImageTag = row.imageTag;
      // Persist the new pin so the row stays in sync even across restarts; then
      // mutate the in-memory row so step 2 rolls the StatefulSet this same tick.
      await deps.db
        .update(instance)
        .set({ imageTag: envImage, updatedAt: deps.now() })
        .where(eq(instance.id, row.id));
      row.imageTag = envImage;
      await auditAction(deps, row, "image:autoroll", {
        from: fromImageTag,
        to: envImage,
      });
    }
  }

  // 1. Replicas convergence (only when they actually differ).
  if (sts.replicas !== desiredReplicas) {
    await deps.setStatefulSetReplicas(row.slug, desiredReplicas, clients);
    await auditAction(deps, row, "scale", {
      from: sts.replicas,
      to: desiredReplicas,
    });
  }

  // 2. Image rollout (only when a desired image is set AND the live image is
  //    known AND it differs). When the API response omits container[0].image
  //    (sts.image === undefined) we cannot tell whether it differs, so we do
  //    NOT patch — otherwise a missing-image read would trigger a spurious
  //    rollout + audit on every tick.
  if (row.imageTag && sts.image !== undefined && sts.image !== row.imageTag) {
    await deps.setStatefulSetImage(row.slug, row.imageTag, clients);
    await auditAction(deps, row, "image:rollout", {
      from: sts.image,
      to: row.imageTag,
    });
  }

  // 3. Grow-only PVC resize (only when the desired request is STRICTLY larger
  //    than the bound PVC's current request).
  if (row.storageRequest) {
    const desiredBytes = parseQuantityToBytes(row.storageRequest);
    if (desiredBytes !== null) {
      let pvc;
      try {
        pvc = await deps.getPvc(row.slug, clients);
      } catch (err) {
        // Transient PVC read failure — skip resize this tick; retry later.
        log.warn("steady-state getPvc failed; skipping resize this tick", {
          slug: row.slug,
          error: String(err),
        });
        pvc = undefined;
      }
      if (pvc?.found) {
        const currentBytes = parseQuantityToBytes(pvc.requestedStorage);
        if (currentBytes !== null && desiredBytes > currentBytes) {
          try {
            await deps.resizePvc(row.slug, row.storageRequest, clients);
            await auditAction(deps, row, "resize", {
              from: pvc.requestedStorage ?? null,
              to: row.storageRequest,
            });
          } catch (err) {
            // A SC without allowVolumeExpansion (or any expansion rejection)
            // must NOT kill the instance — audit the failure and move on.
            log.error("pvc resize rejected; instance left running", {
              slug: row.slug,
              from: pvc.requestedStorage ?? null,
              to: row.storageRequest,
              error: String(err),
            });
            await auditAction(deps, row, "resize:failed", {
              from: pvc.requestedStorage ?? null,
              to: row.storageRequest,
              error: String(err),
            });
          }
        }
      }
    }
  }
}

/**
 * Run one reconcile pass. Loads non-terminal instances and advances each.
 *
 * If the k8s client is unavailable, logs a warning and returns early WITHOUT
 * marking anything error (transient/local-dev — not a provisioning failure).
 */
export async function reconcileInstances(
  deps: ReconcilerDeps = defaultDeps(),
): Promise<void> {
  // Load instances that still need driving (everything except terminal/passive).
  const rows = await deps.db
    .select()
    .from(instance)
    .where(
      and(
        notInArray(instance.status, INACTIVE_STATUSES),
        // `deleted` is in INACTIVE_STATUSES; nothing else to add.
      ),
    );

  if (rows.length === 0) {
    log.debug("no instances to reconcile");
    return;
  }

  // Acquire clients ONCE. If the cluster is unreachable, bail without erroring
  // any instance (resilience requirement).
  let clients: K8sClients;
  try {
    clients = deps.getClients();
  } catch (err) {
    log.warn("k8s client unavailable; skipping reconcile tick", {
      error: String(err),
      pending: rows.length,
    });
    return;
  }

  for (const row of rows) {
    try {
      switch (row.status) {
        case "requested":
          await reconcileRequested(deps, row, clients);
          break;
        case "provisioning":
          await reconcileProvisioning(deps, row, clients);
          break;
        case "terminating":
          await reconcileTerminating(deps, row, clients);
          break;
        case "ready":
          // Converge the StatefulSet toward 1 replica + desired image/size.
          await reconcileSteadyState(deps, row, clients, 1);
          break;
        case "suspended":
          // Converge the StatefulSet toward 0 replicas (PVC retained).
          await reconcileSteadyState(deps, row, clients, 0);
          break;
        default:
          // error/deleted are filtered out by INACTIVE_STATUSES; anything else
          // is a no-op.
          break;
      }
    } catch (err) {
      // Per-instance failure must not abort the whole tick or crash the process.
      log.error("error reconciling instance", {
        slug: row.slug,
        status: row.status,
        error: String(err),
      });
    }
  }

  // [oyej] Warm-pool arm (epic remote-dev-oyej.8) — runs after the per-instance
  // loop. Isolated so a warm-pool error never aborts the instance reconcile.
  try {
    await reconcileWarmPool();
  } catch (err) {
    log.error("error reconciling warm pool", { error: String(err) });
  }
}

/**
 * [oyej] Warm-pool reconciler arm (epic remote-dev-oyej.8). Pre-warms toward
 * `SUPERVISOR_WARM_POOL_SIZE` (default 0 = disabled), promotes pooled instances
 * whose paired instance reached `ready` (provisioning → ready + TTL), and GCs
 * unclaimed `ready` envs past their TTL. Each step is resilient on its own — it
 * REUSES jvcx's create/terminate primitives (it does not re-implement them).
 */
export async function reconcileWarmPool(): Promise<void> {
  const size = Number(process.env.SUPERVISOR_WARM_POOL_SIZE ?? "0");
  if (!Number.isFinite(size) || size <= 0) return; // disabled

  const warmPool = await import("@/lib/warm-pool");
  try {
    await warmPool.prewarm(size);
  } catch (err) {
    log.warn("warm-pool prewarm failed this tick", { error: String(err) });
  }
  try {
    const promoted = await warmPool.promoteReady();
    if (promoted > 0) log.info("warm-pool promoted ready instances", { promoted });
  } catch (err) {
    log.warn("warm-pool promote failed this tick", { error: String(err) });
  }
  try {
    const gc = await warmPool.gcExpired();
    if (gc > 0) log.info("warm-pool GC'd expired envs", { gc });
  } catch (err) {
    log.warn("warm-pool gc failed this tick", { error: String(err) });
  }
}
