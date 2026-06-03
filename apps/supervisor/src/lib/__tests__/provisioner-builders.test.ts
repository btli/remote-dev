import { describe, it, expect } from "vitest";
import type { V1EnvVar, V1PersistentVolumeClaim } from "@kubernetes/client-node";
import {
  buildNamespace,
  buildSharedSecret,
  buildAuthSecret,
  buildImagePullSecret,
  buildService,
  buildStatefulSet,
  buildSeedJob,
  buildInspectorJob,
  buildInstanceEnv,
  authSecretName,
  MANAGED_BY,
  SERVICE_NAME,
  SHARED_SECRET_NAME,
  HTTP_PORT,
  WS_PORT,
  RUN_AS_ID,
  DATA_DIR,
  INSPECT_DIR,
  INSPECTOR_ROLE,
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
});

describe("buildSeedJob", () => {
  it("builds a Job named rdv-<slug>-seed with AUTHORIZED_USERS", () => {
    const job = buildSeedJob(SLUG, {
      authorizedEmails: ["a@example.com", "b@example.com"],
      image: "img",
    });
    expect(job.metadata?.name).toBe("rdv-alpha-seed");
    expect(job.metadata?.namespace).toBe("rdv-alpha");
    const c = job.spec?.template.spec?.containers[0];
    expect(c?.command).toEqual(["bun", "run", "db:seed"]);
    const authd = c?.env?.find((e) => e.name === "AUTHORIZED_USERS");
    expect(authd?.value).toBe("a@example.com,b@example.com");
    expect(job.spec?.template.spec?.restartPolicy).toBe("Never");
  });

  it("applies imagePullSecrets + nodeSelector identically to the StatefulSet (remote-dev-2xhg/389c)", () => {
    const job = buildSeedJob(SLUG, {
      authorizedEmails: ["a@example.com"],
      image: "img",
      imagePullSecretName: "harbor-registry",
      nodeSelector: { "kubernetes.io/arch": "amd64" },
    });
    expect(job.spec?.template.spec?.imagePullSecrets).toEqual([
      { name: "harbor-registry" },
    ]);
    expect(job.spec?.template.spec?.nodeSelector).toEqual({
      "kubernetes.io/arch": "amd64",
    });

    // Omitted when unset (output unchanged for existing callers).
    const plain = buildSeedJob(SLUG, { authorizedEmails: ["a@example.com"], image: "img" });
    expect(plain.spec?.template.spec?.imagePullSecrets).toBeUndefined();
    expect(plain.spec?.template.spec?.nodeSelector).toBeUndefined();
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
