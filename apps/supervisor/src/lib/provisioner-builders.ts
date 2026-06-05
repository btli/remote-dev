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
 * secret-backed env (AUTH_SECRET, CF_ACCESS_*, GITHUB_*, OIDC_CLIENT_SECRET) is
 * wired as `valueFrom.secretKeyRef` in `buildStatefulSet`, NEVER inlined as
 * plaintext.
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

/** Read-only mount point the inspector Job mounts the data PVC at (§ storage browser). */
export const INSPECT_DIR = "/inspect";

/**
 * Directory the per-instance FCM service-account Secret is mounted into, and the
 * absolute path the file lands at inside the container. The DIRECTORY is the
 * volumeMount target (so the secret's single `service-account.json` key becomes
 * the file `/etc/rdv-fcm/service-account.json`); the FILE path is injected as the
 * non-secret env `FCM_SERVICE_ACCOUNT_PATH` so the instance's container.ts enables
 * FcmPushGateway (it reads FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_PATH).
 */
export const FCM_SERVICE_ACCOUNT_MOUNT_DIR = "/etc/rdv-fcm";
export const FCM_SERVICE_ACCOUNT_MOUNT_PATH = `${FCM_SERVICE_ACCOUNT_MOUNT_DIR}/service-account.json`;

/** StatefulSet termination grace (matches the app's graceful tmux shutdown). */
const TERMINATION_GRACE_SECONDS = 30;

/** Per-instance secret name == the slug-prefixed name (`rdv-<slug>`). */
export function authSecretName(slug: string): string {
  return `rdv-${slug}`;
}

/**
 * Per-instance DATABASE_URL secret name (`rdv-<slug>-db`). Created only on the
 * Postgres dual-backend path (Unit 8); the StatefulSet reads DATABASE_URL from
 * it as a secretKeyRef when `withDatabase` is set.
 */
export function dbSecretName(slug: string): string {
  return `rdv-${slug}-db`;
}

/**
 * Per-instance FCM service-account secret name (`rdv-<slug>-fcm`). Created only
 * when the supervisor is configured to inject FCM credentials; the StatefulSet
 * mounts it (read-only) at {@link FCM_SERVICE_ACCOUNT_MOUNT_DIR} when `withFcm`.
 */
export function fcmSecretName(slug: string): string {
  return `rdv-${slug}-fcm`;
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
 * OAuth creds + optional OIDC client secret). AUTH_SECRET is the only isolation
 * guarantee for the `__Host-` CSRF cookie (§10), so it must be unique per
 * instance.
 *
 * SECURITY: callers MUST NOT log the returned object, `opts.authSecret`, or
 * `opts.oidc.clientSecret`.
 */
export function buildAuthSecret(
  slug: string,
  opts: {
    authSecret: string;
    github?: { clientId: string; clientSecret: string };
    oidc?: { clientSecret: string };
  },
): V1Secret {
  const stringData: Record<string, string> = {
    AUTH_SECRET: opts.authSecret,
  };
  if (opts.github) {
    stringData.GITHUB_CLIENT_ID = opts.github.clientId;
    stringData.GITHUB_CLIENT_SECRET = opts.github.clientSecret;
  }
  if (opts.oidc) {
    stringData.OIDC_CLIENT_SECRET = opts.oidc.clientSecret;
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
 * V1Secret `rdv-<slug>-db` — the per-instance DATABASE_URL for the Postgres
 * dual-backend path (Unit 8). Carries a single `DATABASE_URL` key pointed at the
 * CNPG PgBouncer Pooler (NOT the RW Service — the app uses transaction pooling),
 * which the StatefulSet reads as a secretKeyRef (see `withDatabase` in
 * {@link buildStatefulSet}). Created ONLY when the supervisor runs on Postgres
 * and the instance was bootstrapped with its own database; the SQLite path never
 * creates this Secret.
 *
 * SECURITY: callers MUST NOT log the returned object or `opts.password` — the
 * URL embeds the role password.
 */
export function buildDbSecret(
  slug: string,
  opts: {
    host: string;
    port: number | string;
    dbName: string;
    roleName: string;
    password: string;
  },
): V1Secret {
  const url =
    `postgresql://${encodeURIComponent(opts.roleName)}:` +
    `${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/` +
    `${encodeURIComponent(opts.dbName)}`;
  return {
    metadata: {
      name: dbSecretName(slug),
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    type: "Opaque",
    stringData: {
      DATABASE_URL: url,
    },
  };
}

/**
 * V1Secret `rdv-<slug>-fcm` — the per-instance Firebase/FCM service-account JSON,
 * so the instance can SEND FCM push (the app's container.ts enables FcmPushGateway
 * only when BOTH FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_PATH are set). The JSON is
 * stored under the single key `service-account.json`; the StatefulSet mounts it
 * read-only at {@link FCM_SERVICE_ACCOUNT_MOUNT_DIR} so the file lands at
 * {@link FCM_SERVICE_ACCOUNT_MOUNT_PATH}. Created ONLY when the supervisor is
 * configured with FCM creds (else no FCM Secret / mount / env at all).
 *
 * SECURITY: callers MUST NOT log the returned object or `opts.serviceAccountJson`.
 */
export function buildFcmSecret(
  slug: string,
  opts: { serviceAccountJson: string },
): V1Secret {
  return {
    metadata: {
      name: fcmSecretName(slug),
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    type: "Opaque",
    stringData: {
      "service-account.json": opts.serviceAccountJson,
    },
  };
}

/**
 * V1Secret of `type: kubernetes.io/dockerconfigjson` — a per-instance image-pull
 * credential for PRIVATE instance images (spec §15 B2; remote-dev-2xhg). Created
 * in the instance namespace and referenced from the pod's `imagePullSecrets` so a
 * private-registry instance image can be pulled. `opts.name` is the Secret name
 * the StatefulSet references (e.g. `harbor-registry`); `opts.dockerConfigJson` is
 * the raw `.dockerconfigjson` (a `{ "auths": { … } }` JSON string).
 *
 * SECURITY: callers MUST NOT log the returned object or `opts.dockerConfigJson`.
 */
export function buildImagePullSecret(
  slug: string,
  opts: { name: string; dockerConfigJson: string },
): V1Secret {
  return {
    metadata: {
      name: opts.name,
      namespace: namespaceForSlug(slug),
      labels: instanceLabels(slug),
    },
    type: "kubernetes.io/dockerconfigjson",
    stringData: {
      ".dockerconfigjson": opts.dockerConfigJson,
    },
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
 * Secret-backed vars (AUTH_SECRET, CF_ACCESS_*, GITHUB_*, OIDC_CLIENT_SECRET) are
 * NOT here — they are wired as secretKeyRefs in {@link buildStatefulSet}.
 *
 * When `opts.oidc` is set, the NON-SECRET OIDC config (issuer, client id, display
 * name) is injected so the instance registers the OIDC provider and shows the
 * "Sign in with <name>" button (the base app's src/auth.ts reads these). The
 * OIDC client SECRET is deliberately NOT here — it is a secretKeyRef. We also set
 * AUTH_TRUST_HOST=true because NextAuth sits behind the supervisor router /
 * Traefik and must trust the forwarded host to build correct callback URLs.
 *
 * When `opts.provisionBaseline` is set, the supervisor-wide package baseline
 * (a JSON manifest string) is injected as RDV_PROVISION_BASELINE (remote-dev-uobt)
 * so the instance entrypoint can merge it with the per-instance PVC manifest at
 * boot. Spread in ONLY when set so existing callers/tests stay byte-identical.
 *
 * When `opts.fcm` is set, the NON-SECRET FCM config is injected so the instance
 * can SEND FCM push: FCM_PROJECT_ID (the Firebase project id) and
 * FCM_SERVICE_ACCOUNT_PATH (the in-container path the FCM service-account Secret
 * is mounted at — itself non-secret, just a mount location). The service-account
 * JSON is NOT here — it is a mounted Secret file (see {@link buildFcmSecret} /
 * the `withFcm` volume in {@link buildStatefulSet}). The instance's container.ts
 * enables FcmPushGateway only when BOTH vars are set. Added ONLY when set so
 * existing callers/tests stay byte-identical.
 */
export function buildInstanceEnv(
  slug: string,
  opts: {
    host: string;
    oidc?: { issuer: string; clientId: string; name: string };
    provisionBaseline?: string;
    fcm?: { projectId: string; serviceAccountJson: string };
  },
): Record<string, string> {
  const env: Record<string, string> = {
    RDV_BASE_PATH: `/${slug}`,
    RDV_INSTANCE_SLUG: slug,
    RDV_DATA_DIR: DATA_DIR,
    PORT: String(HTTP_PORT),
    TERMINAL_PORT: String(WS_PORT),
    NEXT_PUBLIC_TERMINAL_PORT: String(WS_PORT),
    AUTH_URL: `https://${opts.host}/${slug}`,
    ENABLE_LOCAL_CREDENTIALS: "false",
  };
  if (opts.oidc) {
    env.OIDC_ISSUER = opts.oidc.issuer;
    env.OIDC_CLIENT_ID = opts.oidc.clientId;
    env.OIDC_NAME = opts.oidc.name;
    env.NEXT_PUBLIC_OIDC_NAME = opts.oidc.name;
    // NextAuth behind the router/Traefik must trust the forwarded host.
    env.AUTH_TRUST_HOST = "true";
  }
  if (opts.provisionBaseline) {
    env.RDV_PROVISION_BASELINE = opts.provisionBaseline;
  }
  if (opts.fcm) {
    env.FCM_PROJECT_ID = opts.fcm.projectId;
    // The service-account JSON is a mounted Secret file; this is just where it
    // lands inside the container (non-secret mount path).
    env.FCM_SERVICE_ACCOUNT_PATH = FCM_SERVICE_ACCOUNT_MOUNT_PATH;
  }
  return env;
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
  /**
   * Wire the OIDC_CLIENT_SECRET secretKeyRef (optional) when the instance has
   * OIDC creds. The non-secret OIDC config (issuer/client id/name) rides in
   * `env` via buildInstanceEnv; only the client SECRET is secret-backed.
   */
  withOidc?: boolean;
  /**
   * Wire the DATABASE_URL secretKeyRef (Postgres dual-backend, Unit 8) sourced
   * from the per-instance `rdv-<slug>-db` Secret. Set ONLY when the supervisor
   * runs on Postgres and the instance was bootstrapped with its own CNPG
   * database; omitted on the SQLite path (the instance uses its per-PVC
   * sqlite.db). The non-secret env is unchanged — DATABASE_URL is secret-backed.
   */
  withDatabase?: boolean;
  /**
   * Mount the per-instance FCM service-account Secret (`rdv-<slug>-fcm`) read-only
   * at {@link FCM_SERVICE_ACCOUNT_MOUNT_DIR} so the instance can SEND FCM push.
   * Set from `!!opts.fcm` by the caller (mirrors how `withOidc` is plumbed). The
   * non-secret FCM env (FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_PATH) rides in `env`
   * via buildInstanceEnv; the service-account JSON is the mounted Secret file.
   * Omitted when unset, preserving current output for non-FCM instances.
   */
  withFcm?: boolean;
  /**
   * Name of an image-pull Secret in the instance namespace, referenced in the
   * pod's `imagePullSecrets` (private-registry instance images; remote-dev-2xhg).
   * Omitted when unset, preserving current output for public-registry instances.
   */
  imagePullSecretName?: string;
  /**
   * Pod nodeSelector pinning the instance to compatible nodes (e.g.
   * `{ "kubernetes.io/arch": "amd64" }` for amd64-only images on a mixed-arch
   * cluster; remote-dev-389c). Omitted when unset/empty.
   */
  nodeSelector?: Record<string, string>;
}

/**
 * V1StatefulSet for an instance: 1 replica, governing Service `rdv`, single
 * `rdv` container on 6001 + 6002, fixed non-root securityContext, readiness +
 * liveness probes at the instance's basePath, and a `data` PVC mounted at
 * /var/lib/rdv.
 *
 * Secret-backed env is appended as secretKeyRefs (AUTH_SECRET from `rdv-<slug>`;
 * CF_ACCESS_* from `rdv-shared`; GITHUB_* + OIDC_CLIENT_SECRET optional from
 * `rdv-<slug>`).
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
  if (opts.withOidc) {
    env.push(
      secretEnv("OIDC_CLIENT_SECRET", authSecretName(slug), "OIDC_CLIENT_SECRET"),
    );
  }
  if (opts.withDatabase) {
    // Postgres dual-backend (Unit 8): DATABASE_URL comes from the per-instance
    // `rdv-<slug>-db` Secret (Pooler-pointed). Pushed only on the Postgres path.
    env.push(secretEnv("DATABASE_URL", dbSecretName(slug), "DATABASE_URL"));
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
          // Private-registry pull (remote-dev-2xhg) + mixed-arch pinning
          // (remote-dev-389c). Both are spread in ONLY when set so existing
          // public-registry/any-arch callers get byte-identical output.
          ...(opts.imagePullSecretName
            ? { imagePullSecrets: [{ name: opts.imagePullSecretName }] }
            : {}),
          ...(opts.nodeSelector && Object.keys(opts.nodeSelector).length > 0
            ? { nodeSelector: opts.nodeSelector }
            : {}),
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
              volumeMounts: [
                { name: "data", mountPath: DATA_DIR },
                // FCM service-account Secret mounted read-only at the DIRECTORY so
                // the `service-account.json` key lands at FCM_SERVICE_ACCOUNT_PATH.
                // Spread in ONLY when withFcm so non-FCM specs are byte-identical.
                // readOnlyRootFilesystem allows this — it's its own mount, not the
                // root fs.
                ...(opts.withFcm
                  ? [
                      {
                        name: "fcm",
                        mountPath: FCM_SERVICE_ACCOUNT_MOUNT_DIR,
                        readOnly: true,
                      },
                    ]
                  : []),
              ],
            },
          ],
          // Pod-level volumes (the `data` volume comes from volumeClaimTemplates).
          // The FCM secret volume is added ONLY when withFcm, so the spec is
          // unchanged (no `volumes` field at all) for non-FCM instances.
          ...(opts.withFcm
            ? {
                volumes: [
                  {
                    name: "fcm",
                    secret: { secretName: fcmSecretName(slug) },
                  },
                ],
              }
            : {}),
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
  opts: {
    authorizedEmails: string[];
    image: string;
    /**
     * Same private-registry pull (remote-dev-2xhg) + mixed-arch pinning
     * (remote-dev-389c) as the StatefulSet: the seed Job runs the SAME instance
     * image on the SAME arch, so it must pull/pin identically if ever dispatched.
     */
    imagePullSecretName?: string;
    nodeSelector?: Record<string, string>;
    /**
     * Postgres dual-backend (Unit 8): wire the DATABASE_URL secretKeyRef from the
     * per-instance `rdv-<slug>-db` Secret so the seed run targets the instance's
     * CNPG database instead of a sqlite.db. Omitted on the SQLite path.
     */
    withDatabase?: boolean;
  },
): V1Job {
  const ns = namespaceForSlug(slug);
  const env: V1EnvVar[] = [
    { name: "AUTHORIZED_USERS", value: opts.authorizedEmails.join(",") },
    { name: "RDV_INSTANCE_SLUG", value: slug },
    { name: "RDV_DATA_DIR", value: DATA_DIR },
  ];
  if (opts.withDatabase) {
    env.push(secretEnv("DATABASE_URL", dbSecretName(slug), "DATABASE_URL"));
  }
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
          // Spread in ONLY when set (see buildStatefulSet) so an undispatched /
          // public-registry seed Job's output is unchanged.
          ...(opts.imagePullSecretName
            ? { imagePullSecrets: [{ name: opts.imagePullSecretName }] }
            : {}),
          ...(opts.nodeSelector && Object.keys(opts.nodeSelector).length > 0
            ? { nodeSelector: opts.nodeSelector }
            : {}),
          containers: [
            {
              name: "seed",
              image: opts.image,
              command: ["bun", "run", "db:seed"],
              env,
            },
          ],
        },
      },
    },
  };
}

/** Role label marking an object as an ephemeral storage-inspector. */
export const INSPECTOR_ROLE = "inspector";

/**
 * Labels every inspector Job/pod carries: the standard managed-by, the
 * `rdv-role: inspector` marker (so a label selector can find/clean them), and
 * `rdv-slug: <slug>` (note the bare key — NOT the `rdv.io/slug` the StatefulSet
 * uses — so an inspector pod is NEVER matched by the headless Service selector
 * and can't receive instance traffic).
 */
export function inspectorLabels(slug: string): Record<string, string> {
  return {
    "managed-by": MANAGED_BY,
    "rdv-role": INSPECTOR_ROLE,
    "rdv-slug": slug,
  };
}

export interface BuildInspectorJobOptions {
  /** Instance slug — names the namespace + the `rdv-slug` label. */
  slug: string;
  /** Job name (e.g. `rdv-inspect-<short-uuid>`) — caller-supplied for cleanup. */
  name: string;
  /** Instance image (readProvisionEnv().image) — Node-based; runs the script. */
  image: string;
  /** The container command/args that emit ONE JSON line to stdout. */
  command: string[];
  /** Optional private-registry pull Secret (reuse the instance's). */
  imagePullSecretName?: string;
  /**
   * When the instance pod is RUNNING and holds an RWO volume, pin the inspector
   * to its node so a read-only mount can share it. Omitted when the instance is
   * stopped (rely on PV nodeAffinity for node-pinned local-path; NFS schedules
   * anywhere).
   */
  nodeName?: string;
}

/**
 * V1Job — an EPHEMERAL, self-deleting, read-only storage inspector
 * (remote-dev-jvcx.16). It mounts the instance's bound data PVC `data-rdv-0`
 * READ-ONLY at {@link INSPECT_DIR} and runs a short script (the instance image
 * is Node-based) that emits exactly one JSON line describing a listing or a
 * single file's bytes, then exits.
 *
 * Single-writer note: this Job does NOT touch instance LIFECYCLE state
 * (status/StatefulSet/namespace lifecycle) — it is namespaced, ephemeral, and
 * self-deleting, so creating it from the API process is acceptable (analogous to
 * the logs route's read). It is NOT a single-writer violation.
 *
 * Hardening: `backoffLimit: 0` (no retries — a failure is final), `restartPolicy:
 * Never`, `activeDeadlineSeconds` (kills a stuck Job), and `ttlSecondsAfterFinished`
 * as a backstop so a leaked Job is GC'd even if explicit cleanup is missed. Both
 * the volumeMount AND the PVC volume source are `readOnly: true` (defence in
 * depth — the mount can never write through to the workspace).
 */
export function buildInspectorJob(opts: BuildInspectorJobOptions): V1Job {
  // The StatefulSet's volumeClaimTemplate binds `<volume>-<sts>-<ordinal>` for
  // the sole replica → `data-rdv-0`. Defined locally to keep this builder pure
  // (no import of the db-backed storage module).
  const PVC_NAME = "data-rdv-0";
  const labels = inspectorLabels(opts.slug);
  return {
    metadata: {
      name: opts.name,
      namespace: namespaceForSlug(opts.slug),
      labels,
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 60,
      // Backstop GC in case explicit cleanup is missed (the service deletes the
      // Job after reading its log; this is belt-and-suspenders).
      ttlSecondsAfterFinished: 120,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          securityContext: {
            fsGroup: RUN_AS_ID,
            runAsUser: RUN_AS_ID,
            runAsNonRoot: true,
          },
          ...(opts.imagePullSecretName
            ? { imagePullSecrets: [{ name: opts.imagePullSecretName }] }
            : {}),
          // Pin to the instance pod's node ONLY when it is running (RWO share).
          ...(opts.nodeName ? { nodeName: opts.nodeName } : {}),
          containers: [
            {
              name: "inspect",
              image: opts.image,
              command: opts.command,
              // Read-only mount (defence in depth: also readOnly on the source).
              volumeMounts: [
                { name: "data", mountPath: INSPECT_DIR, readOnly: true },
              ],
            },
          ],
          volumes: [
            {
              name: "data",
              persistentVolumeClaim: { claimName: PVC_NAME, readOnly: true },
            },
          ],
        },
      },
    },
  };
}
