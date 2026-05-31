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
 *                  within the 120s budget but the StatefulSet is MISSING → re-run
 *                  provisionInstance (idempotent self-heal of a crashed/partial
 *                  provision); past the 120s budget → `error` AND delete the
 *                  namespace so no partial objects are orphaned. The budget is
 *                  anchored to the claim write and is NOT reset by ticks.
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
  type InstanceRow,
  type InstanceStatus,
} from "@/db/schema";
import { assertTransition } from "@/lib/instance-state";
import { resolveDefaultStorageTarget } from "@/lib/storage";
import {
  provisionInstance as defaultProvisionInstance,
  checkInstanceReady as defaultCheckInstanceReady,
  terminateInstance as defaultTerminateInstance,
  namespaceExists as defaultNamespaceExists,
  defaultClients,
  ProvisioningError,
  type K8sClients,
  type ProvisionOptions,
} from "@/lib/provisioner-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("Reconciler");

/** Readiness budget: provisioning → error if not ready within this window (§6.3). */
export const READINESS_BUDGET_MS = 120_000;

/** Statuses the reconciler never acts on (terminal / passive this PR). */
const INACTIVE_STATUSES: InstanceStatus[] = [
  "ready",
  "suspended",
  "error",
  "deleted",
];

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
    getClients: defaultClients,
    now: () => new Date(),
  };
}

/** Warn-once guard for the dev-only "instances will lack CF Access" notice. */
let warnedMissingCfAccess = false;

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

  return { image, host, cfAccess: { team, aud }, github };
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
 * Build the provisioning options for an instance (shared by the initial
 * `requested→provisioning` claim and the within-budget self-heal re-provision).
 * Generates a fresh UNIQUE AUTH_SECRET each call (never logged, never persisted).
 *
 * NOTE: `authorizedEmails`/seed handling is intentionally NOT wired in here —
 * the seed Job dispatch is deferred to Phase 2 (jvcx.8), see provisionInstance.
 */
function buildProvisionOptions(row: InstanceRow): ProvisionOptions {
  const env = readProvisionEnv();
  // Storage: snapshot is already on the row; re-resolve the default for the PVC
  // template (jvcx.5 will resolve by storageTargetId from the snapshot).
  const storage = resolveDefaultStorageTarget(row.storageRequest ?? undefined);
  return {
    image: env.image,
    host: env.host,
    storage,
    // UNIQUE AUTH_SECRET, generated HERE (never logged, never persisted).
    authSecret: crypto.randomBytes(32).toString("base64"),
    cfAccess: env.cfAccess,
    github: env.github,
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
    opts = buildProvisionOptions(row);
  } catch (err) {
    // Misconfiguration (missing image/host/CF tags). Deterministic — won't
    // self-heal without operator action; mark error.
    await transition(deps, row, "error", "provision:failed", {
      errorMessage: String(err),
    });
    return false;
  }

  try {
    await deps.provisionInstance(row, opts, clients);
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
  // This claim write is the STABLE timeout anchor (`updatedAt`) for the 120s
  // readiness budget — reconcileProvisioning must not bump it on later ticks.
  await transition(deps, row, "provisioning", "provision:start");
  const claimed: InstanceRow = { ...row, status: "provisioning" };
  await attemptProvision(deps, claimed, clients);
}

/**
 * provisioning →
 *   ready    when readyReplicas≥1;
 *   error    when past the 120s budget (AND clean up — delete the namespace so a
 *            partial/failed provision leaves no orphaned k8s objects);
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
        default:
          // ready/suspended/error/deleted handled by INACTIVE_STATUSES filter;
          // anything else is a no-op this PR.
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
}
