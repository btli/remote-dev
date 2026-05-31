/**
 * Kubernetes object builders for an instance (spec §6.4, §15 B2).
 *
 * These are PURE functions returning typed `@kubernetes/client-node` objects.
 * They make NO API calls, so they are trivially unit-testable. The orchestration
 * (create order, rollback, readiness) lives in `provisioner-service.ts`.
 *
 * Namespace model (§15 B2): ONE namespace per instance, `rdv-<slug>`, containing
 * a Service named `rdv` → DNS `rdv.rdv-<slug>.svc.cluster.local`. The slug also
 * names the namespace; pod/Service selectors use the `rdv.io/slug` label.
 *
 * Env injection (§6.4): non-secret env is set inline via `buildInstanceEnv`;
 * secret-backed env (AUTH_SECRET, CF_ACCESS_*, GITHUB_*) is wired as
 * `valueFrom.secretKeyRef` in `buildStatefulSet`, NEVER inlined as plaintext.
 */

import type {
  V1Namespace,
  V1Secret,
  V1Service,
  V1StatefulSet,
  V1Job,
  V1PersistentVolumeClaim,
  V1EnvVar,
  V1ResourceRequirements,
} from "@kubernetes/client-node";
import { namespaceForSlug } from "@/lib/slug";

/** Standard label every supervisor-managed object carries. */
export const MANAGED_BY = "rdv-supervisor";

/** Service name inside each instance namespace (§15 B2). */
export const SERVICE_NAME = "rdv";

/** Shared (CF Access) secret name inside the instance namespace. */
export const SHARED_SECRET_NAME = "rdv-shared";

/** Container ports (match the instance image / `/internal/routes`). */
export const HTTP_PORT = 6001;
export const WS_PORT = 6002;

/** Pod runs as a fixed non-root uid/gid (matches the instance image). */
export const RUN_AS_ID = 10001;

/** RDV_DATA_DIR — the PVC mount point inside the container. */
export const DATA_DIR = "/var/lib/rdv";

/** StatefulSet termination grace (matches the app's graceful tmux shutdown). */
const TERMINATION_GRACE_SECONDS = 30;

/** Per-instance secret name == the slug-prefixed name (`rdv-<slug>`). */
export function authSecretName(slug: string): string {
  return `rdv-${slug}`;
}

/** Labels shared by all objects for an instance. */
function instanceLabels(slug: string): Record<string, string> {
  return {
    "managed-by": MANAGED_BY,
    "rdv.io/slug": slug,
  };
}

/** Pod / Service selector label (the bit StatefulSet pods are matched on). */
function selectorLabels(slug: string): Record<string, string> {
  return { "rdv.io/slug": slug };
}

/**
 * V1Namespace `rdv-<slug>` labelled for ownership + slug.
 */
export function buildNamespace(slug: string): V1Namespace {
  return {
    metadata: {
      name: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
  };
}

/**
 * V1Secret `rdv-shared` — Cloudflare Access tags shared across the instance's
 * pods. Values are passed as plaintext to `stringData` (the API server stores
 * them base64; we never read them back).
 */
export function buildSharedSecret(
  slug: string,
  opts: { cfAccessTeam: string; cfAccessAud: string },
): V1Secret {
  return {
    metadata: {
      name: SHARED_SECRET_NAME,
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    type: "Opaque",
    stringData: {
      CF_ACCESS_TEAM: opts.cfAccessTeam,
      CF_ACCESS_AUD: opts.cfAccessAud,
    },
  };
}

/**
 * V1Secret `rdv-<slug>` — the instance's UNIQUE AUTH_SECRET (+ optional GitHub
 * OAuth creds). AUTH_SECRET is the only isolation guarantee for the `__Host-`
 * CSRF cookie (§10), so it must be unique per instance.
 *
 * SECURITY: callers MUST NOT log the returned object or `opts.authSecret`.
 */
export function buildAuthSecret(
  slug: string,
  opts: {
    authSecret: string;
    github?: { clientId: string; clientSecret: string };
  },
): V1Secret {
  const stringData: Record<string, string> = {
    AUTH_SECRET: opts.authSecret,
  };
  if (opts.github) {
    stringData.GITHUB_CLIENT_ID = opts.github.clientId;
    stringData.GITHUB_CLIENT_SECRET = opts.github.clientSecret;
  }
  return {
    metadata: {
      name: authSecretName(slug),
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    type: "Opaque",
    stringData,
  };
}

/**
 * V1Service named `rdv` — the StatefulSet's governing service.
 *
 * Headless (`clusterIP: None`) is the conventional choice for a StatefulSet's
 * `serviceName`: it gives each pod a stable DNS name and the per-instance DNS
 * `rdv.rdv-<slug>.svc.cluster.local` resolves directly to the (single) pod's IP.
 * Since the instance is exactly 1 replica, a headless service routes the
 * supervisor router's traffic to that pod with no kube-proxy hop — a ClusterIP
 * would also work, but headless avoids an unnecessary virtual IP and is the
 * idiomatic StatefulSet governing service. We pick headless.
 */
export function buildService(slug: string): V1Service {
  return {
    metadata: {
      name: SERVICE_NAME,
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    spec: {
      clusterIP: "None",
      selector: selectorLabels(slug),
      // targetPort references the container port NAMES (robust to port changes);
      // buildStatefulSet names its container ports "http"(6001) and "ws"(6002).
      ports: [
        { name: "http", port: HTTP_PORT, targetPort: "http" },
        { name: "ws", port: WS_PORT, targetPort: "ws" },
      ],
    },
  };
}

/**
 * The exact NON-SECRET env injected per instance (spec §6.4).
 *
 * Secret-backed vars (AUTH_SECRET, CF_ACCESS_*, GITHUB_*) are NOT here — they are
 * wired as secretKeyRefs in {@link buildStatefulSet}.
 */
export function buildInstanceEnv(
  slug: string,
  opts: { host: string },
): Record<string, string> {
  return {
    RDV_BASE_PATH: `/${slug}`,
    RDV_INSTANCE_SLUG: slug,
    RDV_DATA_DIR: DATA_DIR,
    PORT: String(HTTP_PORT),
    TERMINAL_PORT: String(WS_PORT),
    NEXT_PUBLIC_TERMINAL_PORT: String(WS_PORT),
    AUTH_URL: `https://${opts.host}/${slug}`,
    ENABLE_LOCAL_CREDENTIALS: "false",
  };
}

/** Convert a plain env record into V1EnvVar[] (stable, sorted by name). */
function toEnvVars(env: Record<string, string>): V1EnvVar[] {
  return Object.keys(env)
    .sort()
    .map((name) => ({ name, value: env[name] }));
}

/** secretKeyRef env var (value sourced from a Secret key). */
function secretEnv(
  name: string,
  secretName: string,
  key: string,
  optional = false,
): V1EnvVar {
  return {
    name,
    valueFrom: {
      secretKeyRef: { name: secretName, key, optional },
    },
  };
}

export interface BuildStatefulSetOptions {
  image: string;
  /** Non-secret env (from buildInstanceEnv). */
  env: Record<string, string>;
  /** From storage.toVolumeClaimTemplate (metadata.name === "data"). */
  volumeClaimTemplate: V1PersistentVolumeClaim;
  resources?: V1ResourceRequirements;
  /** Wire GITHUB_* secretKeyRefs (optional) when the instance has GitHub creds. */
  withGithub?: boolean;
}

/**
 * V1StatefulSet for an instance: 1 replica, governing Service `rdv`, single
 * `rdv` container on 6001 + 6002, fixed non-root securityContext, readiness +
 * liveness probes at the instance's basePath, and a `data` PVC mounted at
 * /var/lib/rdv.
 *
 * Secret-backed env is appended as secretKeyRefs (AUTH_SECRET from `rdv-<slug>`;
 * CF_ACCESS_* from `rdv-shared`; GITHUB_* optional from `rdv-<slug>`).
 */
export function buildStatefulSet(
  slug: string,
  opts: BuildStatefulSetOptions,
): V1StatefulSet {
  const ns = namespaceForSlug(slug);
  const basePath = `/${slug}`;

  const env: V1EnvVar[] = [
    ...toEnvVars(opts.env),
    // Unique per-instance AUTH_SECRET.
    secretEnv("AUTH_SECRET", authSecretName(slug), "AUTH_SECRET"),
    // Shared Cloudflare Access tags.
    secretEnv("CF_ACCESS_TEAM", SHARED_SECRET_NAME, "CF_ACCESS_TEAM"),
    secretEnv("CF_ACCESS_AUD", SHARED_SECRET_NAME, "CF_ACCESS_AUD"),
  ];
  if (opts.withGithub) {
    env.push(
      secretEnv("GITHUB_CLIENT_ID", authSecretName(slug), "GITHUB_CLIENT_ID", true),
      secretEnv(
        "GITHUB_CLIENT_SECRET",
        authSecretName(slug),
        "GITHUB_CLIENT_SECRET",
        true,
      ),
    );
  }

  return {
    metadata: {
      name: SERVICE_NAME,
      namespace: ns,
      labels: instanceLabels(slug),
    },
    spec: {
      replicas: 1,
      serviceName: SERVICE_NAME,
      selector: { matchLabels: selectorLabels(slug) },
      template: {
        metadata: { labels: instanceLabels(slug) },
        spec: {
          securityContext: {
            fsGroup: RUN_AS_ID,
            runAsUser: RUN_AS_ID,
            runAsNonRoot: true,
          },
          terminationGracePeriodSeconds: TERMINATION_GRACE_SECONDS,
          containers: [
            {
              name: SERVICE_NAME,
              image: opts.image,
              ports: [
                { name: "http", containerPort: HTTP_PORT },
                { name: "ws", containerPort: WS_PORT },
              ],
              env,
              ...(opts.resources ? { resources: opts.resources } : {}),
              // Probes hit the pod's OWN basePath (it serves under /<slug>).
              readinessProbe: {
                httpGet: { path: `${basePath}/api/readyz`, port: HTTP_PORT },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 3,
                failureThreshold: 6,
              },
              livenessProbe: {
                httpGet: { path: `${basePath}/api/healthz`, port: HTTP_PORT },
                initialDelaySeconds: 15,
                periodSeconds: 20,
                timeoutSeconds: 3,
                failureThreshold: 3,
              },
              volumeMounts: [{ name: "data", mountPath: DATA_DIR }],
            },
          ],
        },
      },
      volumeClaimTemplates: [opts.volumeClaimTemplate],
    },
  };
}

/**
 * V1Job — first-boot seed (a `bun run db:seed`-style run that authorises the
 * given emails on the fresh instance DB). Minimal: runs the instance image with
 * the seed command + AUTHORIZED_USERS, mounts nothing (it talks to the instance
 * over its in-namespace Service), and does not retry forever.
 *
 * RBAC: dispatching/cleaning up this Job needs `batch/jobs: create,get,list,delete`
 * on the Supervisor ServiceAccount (§15 B3). The ClusterRole/RBAC yaml is jvcx.7;
 * this builder only constructs the object.
 */
export function buildSeedJob(
  slug: string,
  opts: { authorizedEmails: string[]; image: string },
): V1Job {
  const ns = namespaceForSlug(slug);
  return {
    metadata: {
      name: `rdv-${slug}-seed`,
      namespace: ns,
      labels: instanceLabels(slug),
    },
    spec: {
      backoffLimit: 3,
      // Clean up the Job object an hour after it finishes.
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: instanceLabels(slug) },
        spec: {
          restartPolicy: "Never",
          securityContext: {
            fsGroup: RUN_AS_ID,
            runAsUser: RUN_AS_ID,
            runAsNonRoot: true,
          },
          containers: [
            {
              name: "seed",
              image: opts.image,
              command: ["bun", "run", "db:seed"],
              env: [
                {
                  name: "AUTHORIZED_USERS",
                  value: opts.authorizedEmails.join(","),
                },
                { name: "RDV_INSTANCE_SLUG", value: slug },
                { name: "RDV_DATA_DIR", value: DATA_DIR },
              ],
            },
          ],
        },
      },
    },
  };
}
