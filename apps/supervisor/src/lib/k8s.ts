/**
 * Kubernetes client wrapper.
 *
 * Lazy singleton over `@kubernetes/client-node`. Config is loaded via
 * `kc.loadFromDefault()` (spec §6.1): the in-cluster ServiceAccount token in
 * production, `~/.kube/config` (honouring `KUBECONFIG`) for local dev. No
 * runtime switching.
 *
 * Missing/invalid kubeconfig is handled GRACEFULLY: importing this module never
 * touches the cluster. The config is loaded — and any error thrown — only on
 * the first `getKubeConfig()` / typed-getter call, so the Next.js app and tests
 * can import freely without a cluster present.
 *
 * This module is intentionally JUST a client accessor. Provisioning logic
 * (object builders, reconcile, storage translation) is jvcx.4+ and lives
 * elsewhere.
 */

import {
  KubeConfig,
  CoreV1Api,
  AppsV1Api,
  StorageV1Api,
  BatchV1Api,
} from "@kubernetes/client-node";
import { createLogger } from "@/lib/logger";

const log = createLogger("K8s");

let kubeConfig: KubeConfig | null = null;

/**
 * Get the lazily-initialised KubeConfig. Throws a clear error if no kubeconfig
 * / in-cluster credentials are available.
 */
export function getKubeConfig(): KubeConfig {
  if (kubeConfig) return kubeConfig;

  const kc = new KubeConfig();
  try {
    kc.loadFromDefault();
  } catch (error) {
    log.error("Failed to load Kubernetes config", { error: String(error) });
    throw new Error(
      "Kubernetes config unavailable: loadFromDefault() failed. " +
        "Set KUBECONFIG (local dev) or run in-cluster with a ServiceAccount.",
    );
  }

  // loadFromDefault() can succeed with no usable context (e.g. empty kubeconfig).
  // Fail loudly here rather than letting a later API call throw opaquely.
  if (!kc.getCurrentCluster()) {
    throw new Error(
      "Kubernetes config has no current cluster/context. " +
        "Set KUBECONFIG (local dev) or run in-cluster with a ServiceAccount.",
    );
  }

  kubeConfig = kc;
  return kubeConfig;
}

/** Core API (namespaces, services, secrets, pods, PVCs, nodes, events). */
export function getCoreV1Api(): CoreV1Api {
  return getKubeConfig().makeApiClient(CoreV1Api);
}

/** Apps API (StatefulSets / Deployments). */
export function getAppsV1Api(): AppsV1Api {
  return getKubeConfig().makeApiClient(AppsV1Api);
}

/** Storage API (StorageClasses — storage discovery, jvcx.5). */
export function getStorageV1Api(): StorageV1Api {
  return getKubeConfig().makeApiClient(StorageV1Api);
}

/** Batch API (Jobs — first-boot seed Job, jvcx.4). */
export function getBatchV1Api(): BatchV1Api {
  return getKubeConfig().makeApiClient(BatchV1Api);
}

/** Reset the cached config. Test-only seam. */
export function resetKubeConfigForTesting(): void {
  kubeConfig = null;
}
