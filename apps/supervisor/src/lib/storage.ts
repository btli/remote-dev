/**
 * Storage target resolution → PVC template (spec §7).
 *
 * Three layers:
 *   1. {@link resolveDefaultStorageTarget} — the cluster-default resolver (env
 *      driven). Used when no `storageTargetId` is supplied.
 *   2. {@link discoverStorageTargets} — LIVE discovery: StorageClasses + each
 *      schedulable node (local-path) + merged `registered_storage_target` rows,
 *      surfaced as {@link StorageTargetOption}s for the create-instance dropdown.
 *   3. {@link resolveStorageTarget} — resolve a chosen option id (the stable
 *      id scheme below) to a {@link ResolvedStorageTarget} via the 4-backend §7
 *      translation table; {@link resolvedFromSnapshot} rebuilds the same shape
 *      from a persisted `instance.storageConfigSnapshot` WITHOUT touching the
 *      cluster (the snapshot is authoritative — later target edits/deletes must
 *      not change an existing instance's volume).
 *
 * Option id scheme (round-trips a selected dropdown option):
 *   - `default`        → the cluster default StorageClass (env-driven).
 *   - `sc:<name>`      → a discovered StorageClass.
 *   - `node:<host>`    → local-path pinned to node `<host>`.
 *   - `reg:<uuid>`     → a `registered_storage_target` row (NFS / custom).
 */

import type {
  V1PersistentVolumeClaim,
  CoreV1Api,
  StorageV1Api,
} from "@kubernetes/client-node";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { registeredStorageTarget } from "@/db/schema";
import type { StorageTargetKind } from "@/db/schema";
import { getCoreV1Api, getStorageV1Api } from "@/lib/k8s";
import { createLogger } from "@/lib/logger";

const log = createLogger("Storage");

/** Fallback request size when neither env nor caller supplies one. */
const FALLBACK_STORAGE_SIZE = "10Gi";

/** The PVC name used inside a StatefulSet's volumeClaimTemplates. */
export const DATA_VOLUME_NAME = "data";

/** Annotation k8s sets on the default StorageClass. */
const DEFAULT_SC_ANNOTATION = "storageclass.kubernetes.io/is-default-class";

/** Annotation the rancher local-path provisioner honours to pin a PVC's node. */
const SELECTED_NODE_ANNOTATION = "volume.kubernetes.io/selected-node";

/** StorageClass name the rancher local-path provisioner ships with. */
const LOCAL_PATH_SC = "local-path";

/** Longhorn's CSI provisioner — replicated, survives node loss. */
const LONGHORN_PROVISIONER = "driver.longhorn.io";

/**
 * Known cloud CSI provisioners. A volume from one of these reattaches on node
 * loss within its AZ (cross-AZ is a manual recovery — see §8.5).
 */
const CLOUD_CSI_PROVISIONERS: ReadonlySet<string> = new Set([
  "ebs.csi.aws.com",
  "pd.csi.storage.gke.io",
  "disk.csi.azure.com",
]);

/** Control-plane node labels — these nodes are skipped for local-path options. */
const CONTROL_PLANE_LABELS = [
  "node-role.kubernetes.io/control-plane",
  "node-role.kubernetes.io/master",
];

/** Resiliency notes surfaced in the dropdown (§7). */
const RESILIENCY = {
  longhorn: "Replicated (Longhorn); survives node loss.",
  cloudCsi: "Cloud volume; reattaches on node loss within its AZ.",
  storageClassGeneric:
    "Dynamic StorageClass; resiliency depends on the backing provisioner.",
  localPath:
    "Node-pinned (local-path); NO replication — data is lost if the node is lost.",
} as const;

/** A discoverable / selectable storage option for the create-instance dropdown. */
export interface StorageTargetOption {
  /** Stable option id: "default" | "sc:<name>" | "node:<host>" | "reg:<uuid>". */
  id: string;
  /** Human label for the dropdown. */
  name: string;
  kind: StorageTargetKind;
  /** Surfaced in the dropdown so the operator sees the trade-off (§7). */
  resiliencyNote: string;
  isDefault: boolean;
}

/**
 * A resolved storage target: everything needed to build a PVC template plus the
 * snapshot we persist on the instance row so later target edits/deletes don't
 * corrupt existing instances (§7).
 */
export interface ResolvedStorageTarget {
  /** The option id this was resolved from, or null for the cluster default. */
  id: string | null;
  kind: StorageTargetKind;
  /** undefined → use the cluster's default StorageClass. */
  storageClassName?: string;
  /** e.g. "10Gi". */
  size: string;
  /** local-path node affinity hostname (set for node-pinned targets). */
  nodeHostname?: string;
  resiliencyNote: string;
  /** Persisted verbatim into `instance.storageConfigSnapshot`. */
  configSnapshot: Record<string, unknown>;
}

/** The clients storage discovery / resolution needs, injected for testability. */
export interface StorageClients {
  core: Pick<CoreV1Api, "listNode">;
  storage: Pick<StorageV1Api, "listStorageClass">;
}

/** Real clients (lazy; throws if no cluster — callers handle that). */
export function defaultStorageClients(): StorageClients {
  return { core: getCoreV1Api(), storage: getStorageV1Api() };
}

/** Typed error for an unknown / unresolvable option id (API maps to 400/404). */
export class StorageTargetResolutionError extends Error {
  constructor(
    readonly code: "UNKNOWN_ID" | "NOT_FOUND" | "MALFORMED_SNAPSHOT",
    message: string,
  ) {
    super(message);
    this.name = "StorageTargetResolutionError";
  }
}

/**
 * Resolve the cluster-default storage target.
 *
 * Honors:
 *   - SUPERVISOR_DEFAULT_STORAGE_CLASS (optional) — undefined leaves
 *     `storageClassName` unset so the cluster's default StorageClass is used.
 *   - SUPERVISOR_DEFAULT_STORAGE_SIZE (optional) — falls back to the caller's
 *     `size`, then to "10Gi".
 *
 * Kind is reported as `storage-class` (a named or default dynamic provisioner).
 */
export function resolveDefaultStorageTarget(
  size?: string,
): ResolvedStorageTarget {
  const storageClassName =
    process.env.SUPERVISOR_DEFAULT_STORAGE_CLASS || undefined;
  const resolvedSize =
    process.env.SUPERVISOR_DEFAULT_STORAGE_SIZE || size || FALLBACK_STORAGE_SIZE;

  const resiliencyNote = storageClassName
    ? `Cluster StorageClass "${storageClassName}" (default supervisor target). Resiliency depends on the backing provisioner.`
    : "Cluster default StorageClass (no SUPERVISOR_DEFAULT_STORAGE_CLASS set). Resiliency depends on the backing provisioner.";

  return {
    id: null,
    kind: "storage-class",
    storageClassName,
    size: resolvedSize,
    resiliencyNote,
    configSnapshot: {
      kind: "storage-class",
      storageClassName: storageClassName ?? null,
      size: resolvedSize,
      isDefault: true,
    },
  };
}

/** Classify a StorageClass provisioner → (kind, resiliencyNote). */
function classifyProvisioner(provisioner: string | undefined): {
  kind: StorageTargetKind;
  resiliencyNote: string;
} {
  if (provisioner === LONGHORN_PROVISIONER) {
    return { kind: "storage-class", resiliencyNote: RESILIENCY.longhorn };
  }
  if (provisioner && CLOUD_CSI_PROVISIONERS.has(provisioner)) {
    return { kind: "cloud-csi", resiliencyNote: RESILIENCY.cloudCsi };
  }
  return {
    kind: "storage-class",
    resiliencyNote: RESILIENCY.storageClassGeneric,
  };
}

/** True if a node is a control-plane node (skipped for local-path options). */
function isControlPlaneNode(labels: Record<string, string> | undefined, taints: { key: string; effect: string }[] | undefined): boolean {
  if (labels) {
    for (const label of CONTROL_PLANE_LABELS) {
      if (label in labels) return true;
    }
  }
  if (taints) {
    for (const t of taints) {
      if (
        CONTROL_PLANE_LABELS.includes(t.key) &&
        t.effect === "NoSchedule"
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Live discovery of selectable storage targets (§7).
 *
 *  - StorageClasses → one `sc:<name>` option each (Longhorn → replicated note,
 *    a known cloud CSI provisioner → cloud-csi kind, else a generic note). The
 *    SC annotated as default is flagged `isDefault`.
 *  - Schedulable nodes (control-plane nodes skipped) → one `node:<host>`
 *    local-path option each.
 *  - `registered_storage_target` rows → `reg:<id>` options (NFS / custom).
 *  - The `default` cluster option is ALWAYS included first.
 *
 * Resilient: if a k8s list call fails (e.g. no cluster in local dev), it logs a
 * warning and degrades to `default` + any registered rows rather than throwing,
 * so the dropdown still renders.
 */
export async function discoverStorageTargets(
  clients?: StorageClients,
  database = defaultDb,
): Promise<StorageTargetOption[]> {
  const def = resolveDefaultStorageTarget();

  // Discovered StorageClass + node options are gathered separately so we can
  // decide the synthetic `default` option's `isDefault` honestly: it should be
  // the default ONLY when no discovered StorageClass is the cluster-annotated
  // default — otherwise the form (which selects the first `isDefault`) would
  // always pick the generic `default` over the real annotated SC.
  const scNodeOptions: StorageTargetOption[] = [];
  let hasAnnotatedDefault = false;

  // K8s discovery — best-effort. A failure degrades to default + registered.
  let resolved: StorageClients | null = null;
  try {
    resolved = clients ?? defaultStorageClients();
  } catch (err) {
    log.warn("k8s clients unavailable; storage discovery degraded to default + registered", {
      error: String(err),
    });
  }

  if (resolved) {
    // StorageClasses.
    try {
      const scList = await resolved.storage.listStorageClass();
      for (const sc of scList.items) {
        const name = sc.metadata?.name;
        if (!name) continue;
        const { kind, resiliencyNote } = classifyProvisioner(sc.provisioner);
        const isDefault =
          sc.metadata?.annotations?.[DEFAULT_SC_ANNOTATION] === "true";
        if (isDefault) hasAnnotatedDefault = true;
        scNodeOptions.push({
          id: `sc:${name}`,
          name: `StorageClass: ${name}${isDefault ? " (default)" : ""}`,
          kind,
          resiliencyNote,
          isDefault,
        });
      }
    } catch (err) {
      log.warn("listStorageClass failed; skipping StorageClass options", {
        error: String(err),
      });
    }

    // Nodes (local-path, skip control-plane).
    try {
      const nodeList = await resolved.core.listNode();
      for (const node of nodeList.items) {
        const host = node.metadata?.name;
        if (!host) continue;
        if (isControlPlaneNode(node.metadata?.labels, node.spec?.taints)) {
          continue;
        }
        scNodeOptions.push({
          id: `node:${host}`,
          name: `Local path on node: ${host}`,
          kind: "local-path",
          resiliencyNote: RESILIENCY.localPath,
          isDefault: false,
        });
      }
    } catch (err) {
      log.warn("listNode failed; skipping local-path node options", {
        error: String(err),
      });
    }
  }

  // The synthetic cluster-default option is ALWAYS first; it is the default only
  // when no discovered SC carries the cluster default-class annotation.
  const options: StorageTargetOption[] = [
    {
      id: "default",
      name: def.storageClassName
        ? `Cluster default (${def.storageClassName})`
        : "Cluster default StorageClass",
      kind: "storage-class",
      resiliencyNote: def.resiliencyNote,
      isDefault: !hasAnnotatedDefault,
    },
    ...scNodeOptions,
  ];

  // Registered targets (NFS / custom) — always merged (no cluster needed).
  try {
    const rows = await database.select().from(registeredStorageTarget);
    for (const row of rows) {
      options.push({
        id: `reg:${row.id}`,
        name: row.name,
        kind: row.kind,
        resiliencyNote:
          row.resiliencyNote ??
          "Registered storage target; resiliency depends on the backing storage.",
        isDefault: row.isDefault,
      });
    }
  } catch (err) {
    log.warn("registered_storage_target query failed; skipping registered options", {
      error: String(err),
    });
  }

  return options;
}

/** Resolve a `sc:<name>` id by looking the StorageClass up live for its kind. */
async function resolveStorageClassId(
  name: string,
  size: string,
  clients: StorageClients,
): Promise<ResolvedStorageTarget> {
  let provisioner: string | undefined;
  try {
    const scList = await clients.storage.listStorageClass();
    provisioner = scList.items.find((sc) => sc.metadata?.name === name)
      ?.provisioner;
  } catch (err) {
    // Couldn't read the SC; proceed with a generic note (the SC name is still
    // valid as a PVC reference — a missing SC fails later at PVC binding).
    log.warn("listStorageClass failed while resolving sc:<name>; using generic note", {
      name,
      error: String(err),
    });
  }
  const { kind, resiliencyNote } = classifyProvisioner(provisioner);
  return {
    id: `sc:${name}`,
    kind,
    storageClassName: name,
    size,
    resiliencyNote,
    configSnapshot: {
      kind,
      storageClassName: name,
      size,
    },
  };
}

/** Resolve a registered `reg:<uuid>` id from the DB row. */
async function resolveRegisteredId(
  uuid: string,
  size: string,
  database: typeof defaultDb,
): Promise<ResolvedStorageTarget> {
  const row = await database.query.registeredStorageTarget.findFirst({
    where: eq(registeredStorageTarget.id, uuid),
  });
  if (!row) {
    throw new StorageTargetResolutionError(
      "NOT_FOUND",
      `Registered storage target "${uuid}" not found`,
    );
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    throw new StorageTargetResolutionError(
      "MALFORMED_SNAPSHOT",
      `Registered storage target "${uuid}" has malformed config JSON`,
    );
  }

  // For NFS we use the dynamic nfs-subdir-external-provisioner StorageClass
  // named in the row's config (§15 B3 — a dynamic SC, NOT a static PV).
  const storageClassName =
    typeof config.storageClassName === "string"
      ? config.storageClassName
      : undefined;

  // A registered target whose kind expects a StorageClass but lacks one is
  // unusable (it would yield a PVC with no SC → the cluster default, not the
  // intended backend). Warn loudly; POST validation should have rejected it.
  if (
    (row.kind === "nfs" ||
      row.kind === "storage-class" ||
      row.kind === "cloud-csi") &&
    !storageClassName
  ) {
    log.warn(
      "registered storage target is missing a storageClassName; PVC will fall back to the cluster default SC",
      { id: uuid, kind: row.kind },
    );
  }

  return {
    id: `reg:${uuid}`,
    kind: row.kind,
    storageClassName,
    size,
    resiliencyNote:
      row.resiliencyNote ??
      "Registered storage target; resiliency depends on the backing storage.",
    // The snapshot is the row's config plus the resolved fields — the
    // authoritative record so a later edit/delete of the row can't change the
    // instance's volume. The explicit fields (kind/storageClassName/size) are
    // spread LAST so a stray key in `config` can never override them.
    configSnapshot: {
      ...config,
      kind: row.kind,
      storageClassName,
      size,
    },
  };
}

/**
 * Resolve a chosen storage-target option id to a {@link ResolvedStorageTarget}
 * via the §7 4-backend table.
 *
 *   - `default` / null → {@link resolveDefaultStorageTarget}.
 *   - `sc:<name>`      → storage-class (or cloud-csi per the live provisioner).
 *   - `node:<host>`    → local-path pinned to the node.
 *   - `reg:<uuid>`     → the registered row's config (NFS uses its dynamic SC).
 *
 * Throws {@link StorageTargetResolutionError} for an unknown id form or a
 * missing registered row (the API maps these to 400 / 404).
 */
export async function resolveStorageTarget(
  id: string | null,
  size?: string,
  clients?: StorageClients,
  database = defaultDb,
): Promise<ResolvedStorageTarget> {
  if (id === null || id === "" || id === "default") {
    return resolveDefaultStorageTarget(size);
  }

  const resolvedSize =
    process.env.SUPERVISOR_DEFAULT_STORAGE_SIZE || size || FALLBACK_STORAGE_SIZE;

  if (id.startsWith("sc:")) {
    const name = id.slice("sc:".length);
    if (!name) {
      throw new StorageTargetResolutionError(
        "UNKNOWN_ID",
        `Malformed StorageClass id "${id}"`,
      );
    }
    // Client acquisition may fail when no cluster is reachable (e.g. the API
    // process in local dev). Degrade to a generic classification rather than
    // failing the whole request — the SC name is still a valid PVC reference.
    let resolvedClients: StorageClients | null = null;
    try {
      resolvedClients = clients ?? defaultStorageClients();
    } catch (err) {
      log.warn("k8s clients unavailable while resolving sc:<name>; using generic note", {
        name,
        error: String(err),
      });
    }
    if (!resolvedClients) {
      const { kind, resiliencyNote } = classifyProvisioner(undefined);
      return {
        id: `sc:${name}`,
        kind,
        storageClassName: name,
        size: resolvedSize,
        resiliencyNote,
        configSnapshot: { kind, storageClassName: name, size: resolvedSize },
      };
    }
    return resolveStorageClassId(name, resolvedSize, resolvedClients);
  }

  if (id.startsWith("node:")) {
    const host = id.slice("node:".length);
    if (!host) {
      throw new StorageTargetResolutionError(
        "UNKNOWN_ID",
        `Malformed node id "${id}"`,
      );
    }
    return {
      id,
      kind: "local-path",
      storageClassName: LOCAL_PATH_SC,
      nodeHostname: host,
      size: resolvedSize,
      resiliencyNote: RESILIENCY.localPath,
      configSnapshot: {
        kind: "local-path",
        storageClassName: LOCAL_PATH_SC,
        nodeHostname: host,
        size: resolvedSize,
      },
    };
  }

  if (id.startsWith("reg:")) {
    const uuid = id.slice("reg:".length);
    if (!uuid) {
      throw new StorageTargetResolutionError(
        "UNKNOWN_ID",
        `Malformed registered-target id "${id}"`,
      );
    }
    return resolveRegisteredId(uuid, resolvedSize, database);
  }

  throw new StorageTargetResolutionError(
    "UNKNOWN_ID",
    `Unknown storage target id "${id}"`,
  );
}

/**
 * Rebuild a {@link ResolvedStorageTarget} from a persisted
 * `instance.storageConfigSnapshot` WITHOUT touching the cluster. The snapshot is
 * authoritative (§7): the reconciler builds the PVC template from this so a
 * later edit/delete of a storage target never changes an existing instance's
 * volume.
 *
 * Recognises the shape written by every resolver above:
 *   { kind, storageClassName?, nodeHostname?, size, ... }
 *
 * The returned `id` is intentionally `null`: a snapshot-rebuilt target is not
 * tied to a live option id (the original `sc:`/`node:`/`reg:` id is not part of
 * the snapshot, and a `reg:` row may since have been edited/deleted). It is used
 * only to build the PVC template — never written back to `instance.storageTargetId`.
 */
export function resolvedFromSnapshot(
  snapshot: Record<string, unknown>,
): ResolvedStorageTarget {
  const kind = snapshot.kind;
  if (
    kind !== "local-path" &&
    kind !== "storage-class" &&
    kind !== "nfs" &&
    kind !== "cloud-csi"
  ) {
    throw new StorageTargetResolutionError(
      "MALFORMED_SNAPSHOT",
      `Storage snapshot has invalid kind "${String(kind)}"`,
    );
  }

  const size =
    typeof snapshot.size === "string" && snapshot.size
      ? snapshot.size
      : FALLBACK_STORAGE_SIZE;
  const storageClassName =
    typeof snapshot.storageClassName === "string" && snapshot.storageClassName
      ? snapshot.storageClassName
      : undefined;
  const nodeHostname =
    typeof snapshot.nodeHostname === "string" && snapshot.nodeHostname
      ? snapshot.nodeHostname
      : undefined;

  let resiliencyNote: string;
  if (kind === "local-path") resiliencyNote = RESILIENCY.localPath;
  else if (kind === "cloud-csi") resiliencyNote = RESILIENCY.cloudCsi;
  else if (kind === "nfs")
    resiliencyNote = "Off-cluster (NFS); availability depends on the NFS server.";
  else resiliencyNote = RESILIENCY.storageClassGeneric;

  return {
    id: null,
    kind,
    storageClassName,
    nodeHostname,
    size,
    resiliencyNote,
    // Round-trip the snapshot verbatim (it stays authoritative).
    configSnapshot: snapshot,
  };
}

/**
 * Translate a resolved storage target into a StatefulSet `volumeClaimTemplate`.
 *
 * Always:
 *   - `metadata.name = "data"` (mounted at /var/lib/rdv by the StatefulSet builder)
 *   - `accessModes: ["ReadWriteOnce"]` (single-writer instance)
 *   - `resources.requests.storage = t.size`
 *   - `storageClassName` only when set (undefined ⇒ cluster default SC)
 *
 * When `nodeHostname` is present (local-path), pin the volume to that node via a
 * `volume.kubernetes.io/selected-node` annotation — the rancher local-path
 * provisioner honours this to place the host directory on the named node so the
 * data follows the pod's node affinity.
 *
 * NFS uses the dynamic `nfs-subdir-external-provisioner` StorageClass (§15 B3),
 * so it needs nothing beyond `storageClassName` here — no static PV wiring.
 */
export function toVolumeClaimTemplate(
  t: ResolvedStorageTarget,
): V1PersistentVolumeClaim {
  const pvc: V1PersistentVolumeClaim = {
    metadata: {
      name: DATA_VOLUME_NAME,
      ...(t.nodeHostname
        ? {
            annotations: {
              [SELECTED_NODE_ANNOTATION]: t.nodeHostname,
            },
          }
        : {}),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: { storage: t.size },
      },
      ...(t.storageClassName ? { storageClassName: t.storageClassName } : {}),
    },
  };
  return pvc;
}
