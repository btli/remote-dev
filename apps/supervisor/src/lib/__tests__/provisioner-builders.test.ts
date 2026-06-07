import { describe, it, expect } from "vitest";
import type { V1EnvVar, V1PersistentVolumeClaim } from "@kubernetes/client-node";
import {
  buildNamespace,
  buildSharedSecret,
  buildAuthSecret,
  buildDbSecret,
  buildFcmSecret,
  buildImagePullSecret,
  buildService,
  buildStatefulSet,
  buildInspectorJob,
  buildInstanceEnv,
  authSecretName,
  dbSecretName,
  fcmSecretName,
  MANAGED_BY,
  SERVICE_NAME,
  SHARED_SECRET_NAME,
  HTTP_PORT,
  WS_PORT,
  RUN_AS_ID,
  DATA_DIR,
  INSPECT_DIR,
  INSPECTOR_ROLE,
  FCM_SERVICE_ACCOUNT_MOUNT_DIR,
  FCM_SERVICE_ACCOUNT_MOUNT_PATH,
} from "@/lib/provisioner-builders";

const SLUG = "alpha";

const PVC: V1PersistentVolumeClaim = {
  metadata: { name: "data" },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: { requests: { storage: "10Gi" } },
  },
};

function envByName(env: V1EnvVar[] | undefined, name: string): V1EnvVar | undefined {
  return env?.find((e) => e.name === name);
}

describe("buildNamespace", () => {
  it("names the namespace rdv-<slug> with managed-by + slug labels", () => {
    const ns = buildNamespace(SLUG);
    expect(ns.metadata?.name).toBe("rdv-alpha");
    expect(ns.metadata?.labels?.["managed-by"]).toBe(MANAGED_BY);
    expect(ns.metadata?.labels?.["rdv.io/slug"]).toBe(SLUG);
  });
});

describe("buildSharedSecret", () => {
  it("is rdv-shared in the instance namespace with CF Access tags", () => {
    const s = buildSharedSecret(SLUG, { cfAccessTeam: "myteam", cfAccessAud: "aud123" });
    expect(s.metadata?.name).toBe(SHARED_SECRET_NAME);
    expect(s.metadata?.namespace).toBe("rdv-alpha");
    expect(s.stringData?.CF_ACCESS_TEAM).toBe("myteam");
    expect(s.stringData?.CF_ACCESS_AUD).toBe("aud123");
  });
});

describe("buildAuthSecret", () => {
  it("is named rdv-<slug> and carries AUTH_SECRET", () => {
    const s = buildAuthSecret(SLUG, { authSecret: "s3cret-base64" });
    expect(s.metadata?.name).toBe(authSecretName(SLUG));
    expect(s.metadata?.name).toBe("rdv-alpha");
    expect(s.metadata?.namespace).toBe("rdv-alpha");
    expect(s.stringData?.AUTH_SECRET).toBe("s3cret-base64");
    // No GitHub keys unless provided.
    expect(s.stringData?.GITHUB_CLIENT_ID).toBeUndefined();
  });

  it("includes GitHub creds when provided", () => {
    const s = buildAuthSecret(SLUG, {
      authSecret: "x",
      github: { clientId: "gh-id", clientSecret: "gh-secret" },
    });
    expect(s.stringData?.GITHUB_CLIENT_ID).toBe("gh-id");
    expect(s.stringData?.GITHUB_CLIENT_SECRET).toBe("gh-secret");
  });

  it("includes OIDC_CLIENT_SECRET only when oidc is provided", () => {
    const without = buildAuthSecret(SLUG, { authSecret: "x" });
    expect(without.stringData?.OIDC_CLIENT_SECRET).toBeUndefined();

    const s = buildAuthSecret(SLUG, {
      authSecret: "x",
      oidc: { clientSecret: "oidc-secret" },
    });
    expect(s.stringData?.OIDC_CLIENT_SECRET).toBe("oidc-secret");
  });
});

describe("buildDbSecret (Postgres dual-backend, Unit 8)", () => {
  it("is an Opaque Secret named rdv-<slug>-db in the instance namespace with instance labels", () => {
    const s = buildDbSecret(SLUG, {
      host: "pooler-rdv-pg-rw.cnpg-clusters.svc.cluster.local",
      port: 5432,
      dbName: "rdv_alpha",
      roleName: "rdv_alpha",
      password: "p@ss/word",
    });
    expect(s.type).toBe("Opaque");
    expect(s.metadata?.name).toBe(dbSecretName(SLUG));
    expect(s.metadata?.name).toBe("rdv-alpha-db");
    expect(s.metadata?.namespace).toBe("rdv-alpha");
    expect(s.metadata?.labels?.["managed-by"]).toBe(MANAGED_BY);
    expect(s.metadata?.labels?.["rdv.io/slug"]).toBe(SLUG);
  });

  it("builds a postgresql:// DATABASE_URL with URL-encoded role/password/db", () => {
    const s = buildDbSecret(SLUG, {
      host: "pooler.cnpg.svc",
      port: "5432",
      dbName: "rdv_alpha",
      roleName: "rdv_alpha",
      // A password with reserved URL chars must be percent-encoded.
      password: "p@ss:w/ord?",
    });
    expect(s.stringData?.DATABASE_URL).toBe(
      "postgresql://rdv_alpha:p%40ss%3Aw%2Ford%3F@pooler.cnpg.svc:5432/rdv_alpha",
    );
  });
});

describe("buildFcmSecret (FCM push provisioning, remote-dev-wnl4)", () => {
  it("is an Opaque Secret named rdv-<slug>-fcm in the instance namespace with instance labels", () => {
    const s = buildFcmSecret(SLUG, { serviceAccountJson: '{"type":"service_account"}' });
    expect(s.type).toBe("Opaque");
    expect(s.metadata?.name).toBe(fcmSecretName(SLUG));
    expect(s.metadata?.name).toBe("rdv-alpha-fcm");
    expect(s.metadata?.namespace).toBe("rdv-alpha");
    expect(s.metadata?.labels?.["managed-by"]).toBe(MANAGED_BY);
    expect(s.metadata?.labels?.["rdv.io/slug"]).toBe(SLUG);
  });

  it("stores the service-account JSON verbatim under the service-account.json key", () => {
    const json =
      '{"type":"service_account","project_id":"my-fb","private_key":"-----BEGIN-----"}';
    const s = buildFcmSecret(SLUG, { serviceAccountJson: json });
    expect(s.stringData?.["service-account.json"]).toBe(json);
    // No other keys leak in.
    expect(Object.keys(s.stringData ?? {})).toEqual(["service-account.json"]);
  });
});

describe("buildImagePullSecret", () => {
  it("is a dockerconfigjson Secret named opts.name in the instance namespace (remote-dev-2xhg)", () => {
    const s = buildImagePullSecret(SLUG, {
      name: "harbor-registry",
      dockerConfigJson: '{"auths":{"harbor.example.com":{"auth":"xxx"}}}',
    });
    expect(s.type).toBe("kubernetes.io/dockerconfigjson");
    expect(s.metadata?.name).toBe("harbor-registry");
    expect(s.metadata?.namespace).toBe("rdv-alpha");
    expect(s.metadata?.labels?.["managed-by"]).toBe(MANAGED_BY);
    expect(s.metadata?.labels?.["rdv.io/slug"]).toBe(SLUG);
    expect(s.stringData?.[".dockerconfigjson"]).toBe(
      '{"auths":{"harbor.example.com":{"auth":"xxx"}}}',
    );
  });
});

describe("buildService", () => {
  it("is named rdv (headless) with http=6001 + ws=6002 and slug selector", () => {
    const svc = buildService(SLUG);
    expect(svc.metadata?.name).toBe(SERVICE_NAME);
    expect(svc.metadata?.name).toBe("rdv");
    expect(svc.metadata?.namespace).toBe("rdv-alpha");
    expect(svc.spec?.clusterIP).toBe("None"); // headless governing service
    expect(svc.spec?.selector?.["rdv.io/slug"]).toBe(SLUG);

    const http = svc.spec?.ports?.find((p) => p.name === "http");
    const ws = svc.spec?.ports?.find((p) => p.name === "ws");
    expect(http?.port).toBe(HTTP_PORT);
    expect(http?.port).toBe(6001);
    expect(ws?.port).toBe(WS_PORT);
    expect(ws?.port).toBe(6002);
    // targetPort references the container port NAMES (Fix 7).
    expect(http?.targetPort).toBe("http");
    expect(ws?.targetPort).toBe("ws");
  });

  it("targetPort names match the StatefulSet container port names", () => {
    const svc = buildService(SLUG);
    const sts = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
    });
    const containerPortNames = sts.spec?.template.spec?.containers[0].ports
      ?.map((p) => p.name)
      .sort();
    const targetPorts = svc.spec?.ports?.map((p) => p.targetPort).sort();
    expect(targetPorts).toEqual(containerPortNames);
    expect(targetPorts).toEqual(["http", "ws"]);
  });
});

describe("buildInstanceEnv", () => {
  it("returns the EXACT §6.4 non-secret env", () => {
    const env = buildInstanceEnv(SLUG, { host: "dev.example.com" });
    expect(env).toEqual({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "alpha",
      RDV_DATA_DIR: "/var/lib/rdv",
      PORT: "6001",
      TERMINAL_PORT: "6002",
      NEXT_PUBLIC_TERMINAL_PORT: "6002",
      AUTH_URL: "https://dev.example.com/alpha",
      ENABLE_LOCAL_CREDENTIALS: "false",
    });
  });

  it("omits OIDC env unless oidc is provided", () => {
    const env = buildInstanceEnv(SLUG, { host: "dev.example.com" });
    expect(env.OIDC_ISSUER).toBeUndefined();
    expect(env.OIDC_CLIENT_ID).toBeUndefined();
    expect(env.OIDC_NAME).toBeUndefined();
    expect(env.NEXT_PUBLIC_OIDC_NAME).toBeUndefined();
    expect(env.AUTH_TRUST_HOST).toBeUndefined();
    // The client SECRET is NEVER a non-secret env value.
    expect(env.OIDC_CLIENT_SECRET).toBeUndefined();
  });

  it("injects the non-secret OIDC config + AUTH_TRUST_HOST when oidc is set", () => {
    const env = buildInstanceEnv(SLUG, {
      host: "dev.example.com",
      oidc: {
        issuer: "https://authentik.example.com/application/o/rdv-instances/",
        clientId: "oidc-client-id",
        name: "Authentik",
      },
    });
    expect(env.OIDC_ISSUER).toBe(
      "https://authentik.example.com/application/o/rdv-instances/",
    );
    expect(env.OIDC_CLIENT_ID).toBe("oidc-client-id");
    expect(env.OIDC_NAME).toBe("Authentik");
    expect(env.NEXT_PUBLIC_OIDC_NAME).toBe("Authentik");
    expect(env.AUTH_TRUST_HOST).toBe("true");
    // The client SECRET must NOT leak into the non-secret env.
    expect(env.OIDC_CLIENT_SECRET).toBeUndefined();
  });

  it("omits FCM env unless fcm is provided (remote-dev-wnl4)", () => {
    const env = buildInstanceEnv(SLUG, { host: "dev.example.com" });
    expect(env.FCM_PROJECT_ID).toBeUndefined();
    expect(env.FCM_SERVICE_ACCOUNT_PATH).toBeUndefined();
  });

  it("sets FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_PATH only when fcm is set (remote-dev-wnl4)", () => {
    const env = buildInstanceEnv(SLUG, {
      host: "dev.example.com",
      fcm: {
        projectId: "my-firebase-project",
        serviceAccountJson: '{"type":"service_account"}',
      },
    });
    expect(env.FCM_PROJECT_ID).toBe("my-firebase-project");
    // The PATH is the in-container mount location (non-secret); the JSON itself
    // must NEVER appear in the non-secret env.
    expect(env.FCM_SERVICE_ACCOUNT_PATH).toBe(FCM_SERVICE_ACCOUNT_MOUNT_PATH);
    expect(env.FCM_SERVICE_ACCOUNT_PATH).toBe("/etc/rdv-fcm/service-account.json");
    expect(JSON.stringify(env)).not.toContain("service_account");
  });

  it("omits RDV_PROVISION_BASELINE unless a baseline is provided (remote-dev-uobt)", () => {
    const env = buildInstanceEnv(SLUG, { host: "dev.example.com" });
    expect(env.RDV_PROVISION_BASELINE).toBeUndefined();
  });

  it("injects RDV_PROVISION_BASELINE verbatim when provisionBaseline is set (remote-dev-uobt)", () => {
    const baseline = '{"npm":["typescript"],"pip":["ruff"]}';
    const env = buildInstanceEnv(SLUG, {
      host: "dev.example.com",
      provisionBaseline: baseline,
    });
    expect(env.RDV_PROVISION_BASELINE).toBe(baseline);
  });
});

describe("buildStatefulSet", () => {
  const sts = buildStatefulSet(SLUG, {
    image: "ghcr.io/btli/remote-dev@sha256:abc",
    env: buildInstanceEnv(SLUG, { host: "dev.example.com" }),
    volumeClaimTemplate: PVC,
  });
  const container = sts.spec?.template.spec?.containers[0];

  it("has replicas 1 and serviceName rdv", () => {
    expect(sts.spec?.replicas).toBe(1);
    expect(sts.spec?.serviceName).toBe("rdv");
    expect(sts.metadata?.namespace).toBe("rdv-alpha");
  });

  it("uses the slug selector + pod labels", () => {
    expect(sts.spec?.selector.matchLabels?.["rdv.io/slug"]).toBe(SLUG);
    expect(sts.spec?.template.metadata?.labels?.["rdv.io/slug"]).toBe(SLUG);
  });

  it("runs the rdv container on 6001 + 6002", () => {
    expect(container?.name).toBe("rdv");
    expect(container?.image).toBe("ghcr.io/btli/remote-dev@sha256:abc");
    const ports = container?.ports?.map((p) => p.containerPort).sort();
    expect(ports).toEqual([6001, 6002]);
  });

  it("sets fsGroup/runAsUser=10001 and grace=30s", () => {
    expect(sts.spec?.template.spec?.securityContext?.fsGroup).toBe(RUN_AS_ID);
    expect(sts.spec?.template.spec?.securityContext?.runAsUser).toBe(RUN_AS_ID);
    expect(sts.spec?.template.spec?.securityContext?.fsGroup).toBe(10001);
    expect(sts.spec?.template.spec?.terminationGracePeriodSeconds).toBe(30);
  });

  it("probes hit /<slug>/api/readyz + /healthz on 6001", () => {
    expect(container?.readinessProbe?.httpGet?.path).toBe("/alpha/api/readyz");
    expect(container?.readinessProbe?.httpGet?.port).toBe(6001);
    expect(container?.livenessProbe?.httpGet?.path).toBe("/alpha/api/healthz");
    expect(container?.livenessProbe?.httpGet?.port).toBe(6001);
  });

  it("inlines the non-secret env incl. RDV_BASE_PATH=/<slug>", () => {
    expect(envByName(container?.env, "RDV_BASE_PATH")?.value).toBe("/alpha");
    expect(envByName(container?.env, "AUTH_URL")?.value).toBe(
      "https://dev.example.com/alpha",
    );
    expect(envByName(container?.env, "ENABLE_LOCAL_CREDENTIALS")?.value).toBe("false");
  });

  it("wires AUTH_SECRET + CF_ACCESS_* as secretKeyRefs (NOT inline values)", () => {
    const authSecretEnv = envByName(container?.env, "AUTH_SECRET");
    expect(authSecretEnv?.value).toBeUndefined();
    expect(authSecretEnv?.valueFrom?.secretKeyRef?.name).toBe("rdv-alpha");
    expect(authSecretEnv?.valueFrom?.secretKeyRef?.key).toBe("AUTH_SECRET");

    const team = envByName(container?.env, "CF_ACCESS_TEAM");
    expect(team?.valueFrom?.secretKeyRef?.name).toBe(SHARED_SECRET_NAME);
    const aud = envByName(container?.env, "CF_ACCESS_AUD");
    expect(aud?.valueFrom?.secretKeyRef?.name).toBe(SHARED_SECRET_NAME);
  });

  it("omits GITHUB_* unless withGithub", () => {
    expect(envByName(container?.env, "GITHUB_CLIENT_ID")).toBeUndefined();
    const withGh = buildStatefulSet(SLUG, {
      image: "img",
      env: buildInstanceEnv(SLUG, { host: "h" }),
      volumeClaimTemplate: PVC,
      withGithub: true,
    });
    const ghEnv = withGh.spec?.template.spec?.containers[0].env;
    const ghId = ghEnv?.find((e) => e.name === "GITHUB_CLIENT_ID");
    expect(ghId?.valueFrom?.secretKeyRef?.name).toBe("rdv-alpha");
    expect(ghId?.valueFrom?.secretKeyRef?.optional).toBe(true);
  });

  it("wires OIDC_CLIENT_SECRET as a secretKeyRef only when withOidc", () => {
    // Default options (top-of-describe `sts`) have no OIDC.
    expect(envByName(container?.env, "OIDC_CLIENT_SECRET")).toBeUndefined();

    const withOidc = buildStatefulSet(SLUG, {
      image: "img",
      env: buildInstanceEnv(SLUG, { host: "h" }),
      volumeClaimTemplate: PVC,
      withOidc: true,
    });
    const oidcEnv = withOidc.spec?.template.spec?.containers[0].env;
    const secret = oidcEnv?.find((e) => e.name === "OIDC_CLIENT_SECRET");
    // Secret-backed, never an inline value.
    expect(secret?.value).toBeUndefined();
    expect(secret?.valueFrom?.secretKeyRef?.name).toBe("rdv-alpha");
    expect(secret?.valueFrom?.secretKeyRef?.key).toBe("OIDC_CLIENT_SECRET");
  });

  it("wires DATABASE_URL as a secretKeyRef only when withDatabase (Unit 8)", () => {
    // Default options (top-of-describe `sts`) have no database → no DATABASE_URL.
    expect(envByName(container?.env, "DATABASE_URL")).toBeUndefined();

    const withDb = buildStatefulSet(SLUG, {
      image: "img",
      env: buildInstanceEnv(SLUG, { host: "h" }),
      volumeClaimTemplate: PVC,
      withDatabase: true,
    });
    const dbEnv = withDb.spec?.template.spec?.containers[0].env;
    const databaseUrl = dbEnv?.find((e) => e.name === "DATABASE_URL");
    // Secret-backed (never an inline value), sourced from rdv-<slug>-db.
    expect(databaseUrl?.value).toBeUndefined();
    expect(databaseUrl?.valueFrom?.secretKeyRef?.name).toBe(dbSecretName(SLUG));
    expect(databaseUrl?.valueFrom?.secretKeyRef?.name).toBe("rdv-alpha-db");
    expect(databaseUrl?.valueFrom?.secretKeyRef?.key).toBe("DATABASE_URL");
  });

  it("adds the fcm volume + read-only mount ONLY when withFcm (remote-dev-wnl4)", () => {
    // Default options (top-of-describe `sts`) have no FCM → no fcm volume/mount,
    // and (since the data volume rides in volumeClaimTemplates) NO pod `volumes`.
    expect(container?.volumeMounts?.find((m) => m.name === "fcm")).toBeUndefined();
    expect(sts.spec?.template.spec?.volumes).toBeUndefined();

    const withFcm = buildStatefulSet(SLUG, {
      image: "img",
      env: buildInstanceEnv(SLUG, { host: "h" }),
      volumeClaimTemplate: PVC,
      withFcm: true,
    });
    const fcmContainer = withFcm.spec?.template.spec?.containers[0];
    // Read-only volumeMount at the DIRECTORY so service-account.json lands at
    // FCM_SERVICE_ACCOUNT_PATH.
    const fcmMount = fcmContainer?.volumeMounts?.find((m) => m.name === "fcm");
    expect(fcmMount?.mountPath).toBe(FCM_SERVICE_ACCOUNT_MOUNT_DIR);
    expect(fcmMount?.mountPath).toBe("/etc/rdv-fcm");
    expect(fcmMount?.readOnly).toBe(true);
    // The data mount is still present.
    expect(fcmContainer?.volumeMounts?.find((m) => m.name === "data")?.mountPath).toBe(
      DATA_DIR,
    );
    // Pod-level fcm volume sources the rdv-<slug>-fcm Secret.
    const fcmVolume = withFcm.spec?.template.spec?.volumes?.find((v) => v.name === "fcm");
    expect(fcmVolume?.secret?.secretName).toBe(fcmSecretName(SLUG));
    expect(fcmVolume?.secret?.secretName).toBe("rdv-alpha-fcm");
  });

  it("mounts the data volume at /var/lib/rdv and includes the volumeClaimTemplate", () => {
    const mount = container?.volumeMounts?.find((m) => m.name === "data");
    expect(mount?.mountPath).toBe(DATA_DIR);
    expect(mount?.mountPath).toBe("/var/lib/rdv");
    expect(sts.spec?.volumeClaimTemplates?.[0]?.metadata?.name).toBe("data");
  });

  it("attaches resources when provided", () => {
    const withRes = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      resources: { requests: { cpu: "250m" }, limits: { cpu: "1" } },
    });
    expect(withRes.spec?.template.spec?.containers[0].resources?.requests?.cpu).toBe("250m");
  });

  it("references imagePullSecrets only when imagePullSecretName is set (remote-dev-2xhg)", () => {
    // Default options (the top-of-describe `sts`) carry no pull secret.
    expect(sts.spec?.template.spec?.imagePullSecrets).toBeUndefined();

    const withPull = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      imagePullSecretName: "harbor-registry",
    });
    expect(withPull.spec?.template.spec?.imagePullSecrets).toEqual([
      { name: "harbor-registry" },
    ]);
  });

  it("sets nodeSelector only when non-empty (remote-dev-389c)", () => {
    // Default options carry no nodeSelector.
    expect(sts.spec?.template.spec?.nodeSelector).toBeUndefined();

    const withSelector = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      nodeSelector: { "kubernetes.io/arch": "amd64" },
    });
    expect(withSelector.spec?.template.spec?.nodeSelector).toEqual({
      "kubernetes.io/arch": "amd64",
    });

    // An empty selector is treated as "no pinning" (output unchanged).
    const withEmpty = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      nodeSelector: {},
    });
    expect(withEmpty.spec?.template.spec?.nodeSelector).toBeUndefined();
  });

  it("sets AUTHORIZED_USERS (plain, joined) only when authorizedEmails is non-empty (remote-dev-sb98)", () => {
    // Default options (the top-of-describe `sts`) carry no authorizedEmails.
    expect(envByName(container?.env, "AUTHORIZED_USERS")).toBeUndefined();

    const withEmails = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      authorizedEmails: ["a@example.com", "b@example.com"],
    });
    const authd = envByName(
      withEmails.spec?.template.spec?.containers[0].env,
      "AUTHORIZED_USERS",
    );
    // PLAIN inline value (emails are not secrets), comma-joined — NOT a secretKeyRef.
    expect(authd?.value).toBe("a@example.com,b@example.com");
    expect(authd?.valueFrom).toBeUndefined();

    // An empty list adds no env (output unchanged for non-seeded instances).
    const withEmpty = buildStatefulSet(SLUG, {
      image: "img",
      env: {},
      volumeClaimTemplate: PVC,
      authorizedEmails: [],
    });
    expect(
      envByName(withEmpty.spec?.template.spec?.containers[0].env, "AUTHORIZED_USERS"),
    ).toBeUndefined();
  });
});

describe("buildInspectorJob (storage browser, jvcx.16)", () => {
  const base = {
    slug: SLUG,
    name: "rdv-inspect-abc12345",
    image: "ghcr.io/btli/remote-dev@sha256:abc",
    command: ["node", "-e", "process.stdout.write('{}')"],
  };

  it("is a one-shot, read-only, self-deleting Job in the instance namespace", () => {
    const job = buildInspectorJob(base);
    expect(job.metadata?.name).toBe("rdv-inspect-abc12345");
    expect(job.metadata?.namespace).toBe("rdv-alpha");
    // No retries, hard deadline, TTL backstop, restartPolicy Never.
    expect(job.spec?.backoffLimit).toBe(0);
    expect(job.spec?.activeDeadlineSeconds).toBeGreaterThan(0);
    expect(job.spec?.ttlSecondsAfterFinished).toBeGreaterThan(0);
    expect(job.spec?.template.spec?.restartPolicy).toBe("Never");
  });

  it("labels the Job managed-by + rdv-role:inspector + rdv-slug (NOT rdv.io/slug)", () => {
    const job = buildInspectorJob(base);
    const labels = job.metadata?.labels ?? {};
    expect(labels["managed-by"]).toBe(MANAGED_BY);
    expect(labels["rdv-role"]).toBe(INSPECTOR_ROLE);
    expect(labels["rdv-slug"]).toBe(SLUG);
    // Must NOT carry the Service selector label, or it'd receive instance traffic.
    expect(labels["rdv.io/slug"]).toBeUndefined();
  });

  it("mounts the bound data-rdv-0 PVC READ-ONLY at /inspect (mount + source both readOnly)", () => {
    const job = buildInspectorJob(base);
    const c = job.spec?.template.spec?.containers?.[0];
    expect(c?.image).toBe(base.image);
    expect(c?.command).toEqual(base.command);
    expect(c?.volumeMounts).toEqual([
      { name: "data", mountPath: INSPECT_DIR, readOnly: true },
    ]);
    const vol = job.spec?.template.spec?.volumes?.[0];
    expect(vol?.name).toBe("data");
    expect(vol?.persistentVolumeClaim).toEqual({
      claimName: "data-rdv-0",
      readOnly: true,
    });
  });

  it("runs as the fixed non-root uid/gid", () => {
    const job = buildInspectorJob(base);
    expect(job.spec?.template.spec?.securityContext).toMatchObject({
      runAsUser: RUN_AS_ID,
      runAsNonRoot: true,
    });
  });

  it("pins nodeName ONLY when provided (RWO share with a running pod)", () => {
    const pinned = buildInspectorJob({ ...base, nodeName: "node-7" });
    expect(pinned.spec?.template.spec?.nodeName).toBe("node-7");
    const unpinned = buildInspectorJob(base);
    expect(unpinned.spec?.template.spec?.nodeName).toBeUndefined();
  });

  it("references an imagePullSecret only when provided", () => {
    const withPull = buildInspectorJob({ ...base, imagePullSecretName: "harbor-registry" });
    expect(withPull.spec?.template.spec?.imagePullSecrets).toEqual([
      { name: "harbor-registry" },
    ]);
    expect(buildInspectorJob(base).spec?.template.spec?.imagePullSecrets).toBeUndefined();
  });
});
