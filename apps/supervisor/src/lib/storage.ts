/**
 * Storage target resolution → PVC template (spec §7).
 *
 * jvcx.4 ships ONLY the minimal default resolver + the `toVolumeClaimTemplate`
 * translation interface. jvcx.5 will add:
 *   - `discoverStorageTargets()` — list StorageClasses + schedulable nodes (one
 *     `local-path on <node>` option each) + merged `registered_storage_target` rows.
 *   - `resolveStorageTarget(id)` — resolve a chosen target id to a
 *     ResolvedStorageTarget using the full 4-backend table (local-path /
 *     storage-class / nfs / cloud-csi), with per-backend resiliency notes and
 *     node affinity.
 * For now only the cluster-default resolver exists, and `POST /api/instances`
 * uses it when no `storageTargetId` is supplied.
 */

import type { V1PersistentVolumeClaim } from "@kubernetes/client-node";
import type { StorageTargetKind } from "@/db/schema";

/** Fallback request size when neither env nor caller supplies one. */
const FALLBACK_STORAGE_SIZE = "10Gi";

/** The PVC name used inside a StatefulSet's volumeClaimTemplates. */
export const DATA_VOLUME_NAME = "data";

/**
 * A resolved storage target: everything needed to build a PVC template plus the
 * snapshot we persist on the instance row so later target edits/deletes don't
 * corrupt existing instances (§7).
 */
export interface ResolvedStorageTarget {
  /** Registered target id, or null for the cluster default. */
  id: string | null;
  kind: StorageTargetKind;
  /** undefined → use the cluster's default StorageClass. */
  storageClassName?: string;
  /** e.g. "10Gi". */
  size: string;
  /** local-path node affinity hostname (jvcx.5 sets this for node-pinned targets). */
  nodeHostname?: string;
  resiliencyNote: string;
  /** Persisted verbatim into `instance.storageConfigSnapshot`. */
  configSnapshot: Record<string, unknown>;
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
 * Kind is reported as `storage-class` (a named or default dynamic provisioner);
 * jvcx.5 refines this when registered/local-path targets are selectable.
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

/**
 * Translate a resolved storage target into a StatefulSet `volumeClaimTemplate`.
 *
 * Always:
 *   - `metadata.name = "data"` (mounted at /var/lib/rdv by the StatefulSet builder)
 *   - `accessModes: ["ReadWriteOnce"]` (single-writer instance)
 *   - `resources.requests.storage = t.size`
 *   - `storageClassName` only when set (undefined ⇒ cluster default SC)
 *
 * When `nodeHostname` is present (local-path, jvcx.5), pin the volume to that
 * node via a `volume.kubernetes.io/selected-node` annotation — the rancher
 * local-path provisioner honours this to place the host directory on the named
 * node so the data follows the pod's node affinity.
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
              "volume.kubernetes.io/selected-node": t.nodeHostname,
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
