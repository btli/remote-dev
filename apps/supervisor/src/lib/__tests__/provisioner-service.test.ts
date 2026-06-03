import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiException } from "@kubernetes/client-node";

// Mock `pg` so the Postgres dual-backend (Unit 8) DDL path needs no real DB.
// A minimal recording Client (the dedicated DDL idempotency assertions live in
// instance-db.test.ts; here we only need provisionInstance's k8s wiring). The
// shared `pgQueries` array + the Client class are created via vi.hoisted so the
// hoisted vi.mock factory can reference them safely.
const { pgQueries } = vi.hoisted(() => ({ pgQueries: [] as string[] }));
vi.mock("pg", () => {
  class FakePgClient {
    escapeIdentifier(id: string): string {
      return `"${id.replace(/"/g, '""')}"`;
    }
    escapeLiteral(s: string): string {
      return `'${s.replace(/'/g, "''")}'`;
    }
    async connect(): Promise<void> {}
    async query(text: string): Promise<{ rowCount: number; rows: unknown[] }> {
      pgQueries.push(text);
      return { rowCount: 0, rows: [] };
    }
    async end(): Promise<void> {}
  }
  return { Client: FakePgClient };
});

import {
  provisionInstance,
  terminateInstance,
  checkInstanceReady,
  namespaceExists,
  getStatefulSet,
  setStatefulSetReplicas,
  setStatefulSetImage,
  getPvc,
  resizePvc,
  getPodLogs,
  listInstanceEvents,
  parseQuantityToBytes,
  ProvisioningError,
  type K8sClients,
  type ProvisionOptions,
} from "@/lib/provisioner-service";
import type { InstanceRow } from "@/db/schema";

function apiError(code: number): ApiException<unknown> {
  return new ApiException(code, `status ${code}`, {}, {});
}

/** A minimal instance row (only fields the provisioner reads). */
function row(slug = "alpha"): InstanceRow {
  return {
    id: "id-1",
    slug,
    displayName: "Alpha",
    ownerId: "owner-1",
    status: "provisioning",
    errorMessage: null,
    namespace: `rdv-${slug}`,
    imageTag: null,
    baseUrl: null,
    storageTargetId: null,
    storageConfigSnapshot: null,
    dbConfigSnapshot: null,
    cpuRequest: null,
    cpuLimit: null,
    memRequest: null,
    memLimit: null,
    storageRequest: "10Gi",
    lastReconciledAt: null,
    provisionedAt: null,
    suspendedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const OPTS: ProvisionOptions = {
  image: "ghcr.io/btli/remote-dev@sha256:abc",
  host: "dev.example.com",
  storage: {
    id: null,
    kind: "storage-class",
    size: "10Gi",
    resiliencyNote: "x",
    configSnapshot: {},
  },
  authSecret: "super-secret-not-logged",
  cfAccess: { team: "t", aud: "a" },
};

/** A spying mock client set; `order` records the sequence of create/delete ops. */
function makeClients(): { clients: K8sClients; order: string[] } {
  const order: string[] = [];
  const clients = {
    core: {
      createNamespace: vi.fn(async () => {
        order.push("namespace");
      }),
      createNamespacedSecret: vi.fn(async ({ body }: { body: { metadata?: { name?: string } } }) => {
        order.push(`secret:${body.metadata?.name}`);
      }),
      createNamespacedService: vi.fn(async () => {
        order.push("service");
      }),
      deleteNamespace: vi.fn(async () => {
        order.push("deleteNamespace");
      }),
      readNamespace: vi.fn(async () => ({})),
      // CNPG superuser secret read (Unit 8); base64 `password` key.
      readNamespacedSecret: vi.fn(async () => ({
        data: { password: Buffer.from("super-pw", "utf8").toString("base64") },
      })),
    },
    apps: {
      createNamespacedStatefulSet: vi.fn(async () => {
        order.push("statefulset");
      }),
      readNamespacedStatefulSet: vi.fn(async () => ({ status: { readyReplicas: 1 } })),
    },
    batch: {
      createNamespacedJob: vi.fn(async () => {
        order.push("job");
      }),
    },
  } as unknown as K8sClients;
  return { clients, order };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionInstance — happy path", () => {
  it("creates objects in the §6.4 order", async () => {
    const { clients, order } = makeClients();
    await provisionInstance(row(), OPTS, clients);
    expect(order).toEqual([
      "namespace",
      "secret:rdv-shared",
      "secret:rdv-alpha",
      "service",
      "statefulset",
    ]);
  });

  it("does NOT dispatch a seed Job in Phase 1 (deferred to jvcx.8)", async () => {
    const { clients, order } = makeClients();
    await provisionInstance(row(), OPTS, clients);
    // Provisioning succeeds without a Job; the batch client is never touched.
    expect(order).not.toContain("job");
    expect(clients.batch.createNamespacedJob).not.toHaveBeenCalled();
  });

  it("back-compat: no imagePullSecret/nodeSelector → no pull Secret, STS has neither field", async () => {
    const { clients, order } = makeClients();
    await provisionInstance(row(), OPTS, clients);
    // Order is exactly the base §6.4 order (no extra image-pull secret).
    expect(order).toEqual([
      "namespace",
      "secret:rdv-shared",
      "secret:rdv-alpha",
      "service",
      "statefulset",
    ]);
    const stsBody = (clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].body;
    expect(stsBody.spec.template.spec.imagePullSecrets).toBeUndefined();
    expect(stsBody.spec.template.spec.nodeSelector).toBeUndefined();
  });
});

describe("provisionInstance — image-pull secret + nodeSelector (remote-dev-2xhg/389c)", () => {
  it("with { name, dockerConfigJson } creates the dockerconfigjson Secret (after ns) AND the STS references it", async () => {
    const { clients, order } = makeClients();
    await provisionInstance(
      row(),
      {
        ...OPTS,
        imagePullSecret: {
          name: "harbor-registry",
          dockerConfigJson: '{"auths":{"harbor.example.com":{"auth":"xxx"}}}',
        },
        nodeSelector: { "kubernetes.io/arch": "amd64" },
      },
      clients,
    );
    // The pull Secret is created right AFTER the namespace, BEFORE rdv-shared.
    expect(order).toEqual([
      "namespace",
      "secret:harbor-registry",
      "secret:rdv-shared",
      "secret:rdv-alpha",
      "service",
      "statefulset",
    ]);
    // The created pull Secret carries the dockerconfigjson body.
    const pullCall = (clients.core.createNamespacedSecret as ReturnType<typeof vi.fn>).mock
      .calls.map((c) => c[0].body)
      .find((b: { metadata?: { name?: string } }) => b.metadata?.name === "harbor-registry");
    expect(pullCall.type).toBe("kubernetes.io/dockerconfigjson");
    expect(pullCall.stringData[".dockerconfigjson"]).toBe(
      '{"auths":{"harbor.example.com":{"auth":"xxx"}}}',
    );
    // The STS references the pull Secret and pins the arch.
    const stsBody = (clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].body;
    expect(stsBody.spec.template.spec.imagePullSecrets).toEqual([
      { name: "harbor-registry" },
    ]);
    expect(stsBody.spec.template.spec.nodeSelector).toEqual({
      "kubernetes.io/arch": "amd64",
    });
  });

  it("with { name } only (no dockerConfigJson) does NOT create a pull Secret but STS still references it", async () => {
    const { clients, order } = makeClients();
    await provisionInstance(
      row(),
      { ...OPTS, imagePullSecret: { name: "harbor-registry" } },
      clients,
    );
    // No image-pull Secret created (operator pre-provisioned it another way).
    expect(order).toEqual([
      "namespace",
      "secret:rdv-shared",
      "secret:rdv-alpha",
      "service",
      "statefulset",
    ]);
    expect(order).not.toContain("secret:harbor-registry");
    // The STS still references imagePullSecrets.
    const stsBody = (clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].body;
    expect(stsBody.spec.template.spec.imagePullSecrets).toEqual([
      { name: "harbor-registry" },
    ]);
  });
});

describe("provisionInstance — provision baseline (remote-dev-uobt)", () => {
  function baselineEnv(clients: K8sClients): string | undefined {
    const stsBody = (
      clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].body;
    const env: Array<{ name: string; value?: string }> =
      stsBody.spec.template.spec.containers[0].env;
    return env.find((e) => e.name === "RDV_PROVISION_BASELINE")?.value;
  }

  it("threads provisionBaseline into the STS env as RDV_PROVISION_BASELINE", async () => {
    const { clients } = makeClients();
    const baseline = '{"apt":["jq"],"npm":["typescript"]}';
    await provisionInstance(row(), { ...OPTS, provisionBaseline: baseline }, clients);
    expect(baselineEnv(clients)).toBe(baseline);
  });

  it("omits RDV_PROVISION_BASELINE when no baseline is provided", async () => {
    const { clients } = makeClients();
    await provisionInstance(row(), OPTS, clients);
    expect(baselineEnv(clients)).toBeUndefined();
  });
});

describe("provisionInstance — Postgres dual-backend (Unit 8)", () => {
  const CNPG_ENV = {
    CNPG_CLUSTER_NAME: "rdv-pg",
    CNPG_RW_HOST: "rdv-pg-rw.cnpg.svc",
    CNPG_POOLER_HOST: "pooler-rdv-pg-rw.cnpg.svc",
    CNPG_POOLER_PORT: "5432",
    CNPG_SUPERUSER_SECRET_NAME: "rdv-pg-superuser",
    CNPG_SUPERUSER_SECRET_NAMESPACE: "cnpg",
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    pgQueries.length = 0;
    for (const [k, v] of Object.entries(CNPG_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(CNPG_ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("bootstraps the DB, creates the rdv-<slug>-db Secret before the Service, and returns the snapshot", async () => {
    const { clients, order } = makeClients();
    const snapshot = await provisionInstance(row(), OPTS, clients);

    // The DDL ran (role/db/grant) against the mocked pg client.
    expect(pgQueries.some((q) => /CREATE ROLE %I/.test(q))).toBe(true);

    // The db Secret is created AFTER the auth secret and BEFORE the Service.
    expect(order).toEqual([
      "namespace",
      "secret:rdv-shared",
      "secret:rdv-alpha",
      "secret:rdv-alpha-db",
      "service",
      "statefulset",
    ]);

    // The db Secret carries a Pooler-pointed DATABASE_URL.
    const dbSecret = (clients.core.createNamespacedSecret as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0].body)
      .find((b: { metadata?: { name?: string } }) => b.metadata?.name === "rdv-alpha-db");
    expect(dbSecret.type).toBe("Opaque");
    expect(dbSecret.stringData.DATABASE_URL).toMatch(
      /^postgresql:\/\/rdv_alpha:.+@pooler-rdv-pg-rw\.cnpg\.svc:5432\/rdv_alpha$/,
    );

    // The StatefulSet reads DATABASE_URL as a secretKeyRef from rdv-alpha-db.
    const stsBody = (clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].body;
    const env: Array<{ name: string; valueFrom?: { secretKeyRef?: { name?: string } } }> =
      stsBody.spec.template.spec.containers[0].env;
    const dbUrlEnv = env.find((e) => e.name === "DATABASE_URL");
    expect(dbUrlEnv?.valueFrom?.secretKeyRef?.name).toBe("rdv-alpha-db");

    // The returned snapshot (persisted by the reconciler) has no password.
    expect(snapshot).toEqual({
      type: "postgres",
      dbName: "rdv_alpha",
      roleName: "rdv_alpha",
      poolerHost: "pooler-rdv-pg-rw.cnpg.svc",
    });
    expect(JSON.stringify(snapshot)).not.toContain("super-pw");
  });

  it("a DB bootstrap failure surfaces as ProvisioningError(database) and rolls back", async () => {
    const { clients, order } = makeClients();
    (clients.core.readNamespacedSecret as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );
    await expect(provisionInstance(row(), OPTS, clients)).rejects.toMatchObject({
      name: "ProvisioningError",
      stage: "database",
    });
    // The DB step is first, so nothing was created; rollback still runs (no-op).
    expect(order).not.toContain("statefulset");
    expect(order).not.toContain("secret:rdv-alpha-db");
  });
});

describe("provisionInstance — rollback on failure", () => {
  it("a Service failure rolls back (deletes namespace) and throws ProvisioningError(service)", async () => {
    const { clients, order } = makeClients();
    (clients.core.createNamespacedService as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );

    await expect(provisionInstance(row(), OPTS, clients)).rejects.toMatchObject({
      name: "ProvisioningError",
      stage: "service",
    });
    // Rollback deleted the namespace; statefulset was never reached.
    expect(order).toContain("deleteNamespace");
    expect(order).not.toContain("statefulset");
    expect(clients.core.deleteNamespace).toHaveBeenCalledOnce();
  });

  it("wraps the cause in ProvisioningError", async () => {
    const { clients } = makeClients();
    (clients.apps.createNamespacedStatefulSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(422),
    );
    const err = await provisionInstance(row(), OPTS, clients).catch((e) => e);
    expect(err).toBeInstanceOf(ProvisioningError);
    expect((err as ProvisioningError).stage).toBe("statefulset");
    expect((err as ProvisioningError).cause).toBeInstanceOf(ApiException);
  });
});

describe("provisionInstance — idempotent 409", () => {
  it("treats 409 AlreadyExists as success per object (retried reconcile)", async () => {
    const { clients, order } = makeClients();
    (clients.core.createNamespace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(409),
    );
    (clients.core.createNamespacedService as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(409),
    );

    // SQLite path (no CNPG env) → returns null, not a snapshot.
    await expect(provisionInstance(row(), OPTS, clients)).resolves.toBeNull();
    // Namespace + service "already existed" but the rest still ran; no rollback.
    expect(order).toContain("statefulset");
    expect(order).not.toContain("deleteNamespace");
  });
});

describe("terminateInstance", () => {
  it("deletes the namespace", async () => {
    const { clients } = makeClients();
    await terminateInstance("alpha", clients);
    expect(clients.core.deleteNamespace).toHaveBeenCalledWith({ name: "rdv-alpha" });
  });

  it("treats 404 NotFound as already-gone (success)", async () => {
    const { clients } = makeClients();
    (clients.core.deleteNamespace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(404),
    );
    await expect(terminateInstance("alpha", clients)).resolves.toBeUndefined();
  });

  it("propagates non-404 errors", async () => {
    const { clients } = makeClients();
    (clients.core.deleteNamespace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );
    await expect(terminateInstance("alpha", clients)).rejects.toBeInstanceOf(ApiException);
  });
});

describe("checkInstanceReady", () => {
  it("ready when readyReplicas>=1", async () => {
    const { clients } = makeClients();
    expect(await checkInstanceReady("alpha", clients)).toEqual({ ready: true });
  });

  it("not ready (with reason) when readyReplicas=0", async () => {
    const { clients } = makeClients();
    (clients.apps.readNamespacedStatefulSet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: { readyReplicas: 0 },
    });
    const res = await checkInstanceReady("alpha", clients);
    expect(res.ready).toBe(false);
    expect(res.reason).toContain("readyReplicas=0");
  });

  it("not ready (statefulset-not-found) on 404", async () => {
    const { clients } = makeClients();
    (clients.apps.readNamespacedStatefulSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(404),
    );
    const res = await checkInstanceReady("alpha", clients);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe("statefulset-not-found");
  });
});

describe("namespaceExists", () => {
  it("true when readNamespace resolves", async () => {
    const { clients } = makeClients();
    expect(await namespaceExists("alpha", clients)).toBe(true);
  });

  it("false on 404", async () => {
    const { clients } = makeClients();
    (clients.core.readNamespace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(404),
    );
    expect(await namespaceExists("alpha", clients)).toBe(false);
  });
});

// ── Phase 2 lifecycle helpers ────────────────────────────────────────────────

/** A spying mock client set for the read/patch lifecycle helpers. */
function makeLifecycleClients(): K8sClients {
  return {
    core: {
      listNamespacedPod: vi.fn(async () => ({
        items: [{ metadata: { name: "rdv-0" } }],
      })),
      readNamespacedPodLog: vi.fn(async () => "line1\nline2\n"),
      listNamespacedEvent: vi.fn(async () => ({ items: [] })),
      readNamespacedPersistentVolumeClaim: vi.fn(async () => ({
        spec: { resources: { requests: { storage: "10Gi" } } },
        status: { capacity: { storage: "10Gi" } },
      })),
      patchNamespacedPersistentVolumeClaim: vi.fn(async () => ({})),
    },
    apps: {
      readNamespacedStatefulSet: vi.fn(async () => ({
        spec: {
          replicas: 1,
          template: { spec: { containers: [{ image: "ghcr.io/x@sha256:abc" }] } },
        },
        status: { readyReplicas: 1 },
      })),
      patchNamespacedStatefulSetScale: vi.fn(async () => ({})),
      patchNamespacedStatefulSet: vi.fn(async () => ({})),
    },
    batch: {},
  } as unknown as K8sClients;
}

describe("getStatefulSet", () => {
  it("returns replicas/readyReplicas/image when present", async () => {
    const clients = makeLifecycleClients();
    const sts = await getStatefulSet("alpha", clients);
    expect(sts).toEqual({
      found: true,
      replicas: 1,
      readyReplicas: 1,
      image: "ghcr.io/x@sha256:abc",
    });
    expect(clients.apps.readNamespacedStatefulSet).toHaveBeenCalledWith({
      name: "rdv",
      namespace: "rdv-alpha",
    });
  });

  it("returns found:false on 404 (not an error)", async () => {
    const clients = makeLifecycleClients();
    (clients.apps.readNamespacedStatefulSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(404),
    );
    expect(await getStatefulSet("alpha", clients)).toEqual({
      found: false,
      replicas: 0,
      readyReplicas: 0,
    });
  });

  it("propagates non-404 read errors", async () => {
    const clients = makeLifecycleClients();
    (clients.apps.readNamespacedStatefulSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );
    await expect(getStatefulSet("alpha", clients)).rejects.toBeInstanceOf(ApiException);
  });
});

describe("setStatefulSetReplicas — exact JSON Patch body", () => {
  it("issues a json-patch replace on /spec/replicas via the scale subresource", async () => {
    const clients = makeLifecycleClients();
    await setStatefulSetReplicas("alpha", 0, clients);
    expect(clients.apps.patchNamespacedStatefulSetScale).toHaveBeenCalledWith({
      name: "rdv",
      namespace: "rdv-alpha",
      body: [{ op: "replace", path: "/spec/replicas", value: 0 }],
    });
  });
});

describe("setStatefulSetImage — exact JSON Patch body", () => {
  it("issues a json-patch replace on container[0] image", async () => {
    const clients = makeLifecycleClients();
    await setStatefulSetImage("alpha", "ghcr.io/x@sha256:new", clients);
    expect(clients.apps.patchNamespacedStatefulSet).toHaveBeenCalledWith({
      name: "rdv",
      namespace: "rdv-alpha",
      body: [
        {
          op: "replace",
          path: "/spec/template/spec/containers/0/image",
          value: "ghcr.io/x@sha256:new",
        },
      ],
    });
  });
});

describe("getPvc / resizePvc", () => {
  it("getPvc reads the bound data-rdv-0 and returns requested + capacity", async () => {
    const clients = makeLifecycleClients();
    const pvc = await getPvc("alpha", clients);
    expect(pvc).toEqual({
      found: true,
      requestedStorage: "10Gi",
      capacityStorage: "10Gi",
    });
    expect(clients.core.readNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name: "data-rdv-0",
      namespace: "rdv-alpha",
    });
  });

  it("getPvc returns found:false on 404", async () => {
    const clients = makeLifecycleClients();
    (
      clients.core.readNamespacedPersistentVolumeClaim as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(apiError(404));
    expect(await getPvc("alpha", clients)).toEqual({ found: false });
  });

  it("resizePvc issues a json-patch replace on the storage request", async () => {
    const clients = makeLifecycleClients();
    await resizePvc("alpha", "20Gi", clients);
    expect(clients.core.patchNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name: "data-rdv-0",
      namespace: "rdv-alpha",
      body: [
        {
          op: "replace",
          path: "/spec/resources/requests/storage",
          value: "20Gi",
        },
      ],
    });
  });
});

describe("getPodLogs", () => {
  it("resolves the pod by label then tails the rdv container log", async () => {
    const clients = makeLifecycleClients();
    const result = await getPodLogs("alpha", { tailLines: 50, previous: false }, clients);
    expect(result).toEqual({ pod: "rdv-0", logs: "line1\nline2\n" });
    expect(clients.core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: "rdv-alpha",
      labelSelector: "rdv.io/slug=alpha",
    });
    expect(clients.core.readNamespacedPodLog).toHaveBeenCalledWith({
      name: "rdv-0",
      namespace: "rdv-alpha",
      container: "rdv",
      tailLines: 50,
      previous: false,
      timestamps: true,
    });
  });

  it("falls back to rdv-0 when the label list is empty", async () => {
    const clients = makeLifecycleClients();
    (clients.core.listNamespacedPod as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
    });
    const result = await getPodLogs("alpha", {}, clients);
    expect(result.pod).toBe("rdv-0");
    expect(clients.core.readNamespacedPodLog).toHaveBeenCalledWith(
      expect.objectContaining({ name: "rdv-0", namespace: "rdv-alpha" }),
    );
  });

  it("falls back to rdv-0 when listNamespacedPod throws (transient list error)", async () => {
    const clients = makeLifecycleClients();
    (clients.core.listNamespacedPod as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );
    const result = await getPodLogs("alpha", {}, clients);
    expect(result.pod).toBe("rdv-0");
    expect(clients.core.readNamespacedPodLog).toHaveBeenCalledWith(
      expect.objectContaining({ name: "rdv-0", namespace: "rdv-alpha" }),
    );
  });

  it("returns { pod:null, logs:'' } when the pod log read 404s (no pod running)", async () => {
    const clients = makeLifecycleClients();
    (clients.core.listNamespacedPod as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
    });
    (clients.core.readNamespacedPodLog as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(404),
    );
    const result = await getPodLogs("alpha", {}, clients);
    expect(result).toEqual({ pod: null, logs: "" });
  });

  it("propagates a non-404 pod log read error", async () => {
    const clients = makeLifecycleClients();
    (clients.core.readNamespacedPodLog as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(500),
    );
    await expect(getPodLogs("alpha", {}, clients)).rejects.toBeInstanceOf(ApiException);
  });
});

describe("listInstanceEvents", () => {
  it("maps events to the DTO and sorts newest first", async () => {
    const clients = makeLifecycleClients();
    (clients.core.listNamespacedEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        {
          type: "Normal",
          reason: "Scheduled",
          message: "older",
          count: 1,
          lastTimestamp: new Date("2026-05-31T00:00:00Z"),
          involvedObject: { kind: "Pod", name: "rdv-0" },
        },
        {
          type: "Warning",
          reason: "BackOff",
          message: "newer",
          count: 3,
          lastTimestamp: new Date("2026-05-31T01:00:00Z"),
          involvedObject: { kind: "Pod", name: "rdv-0" },
        },
      ],
    });
    const events = await listInstanceEvents("alpha", clients);
    expect(events[0]).toMatchObject({
      type: "Warning",
      reason: "BackOff",
      message: "newer",
      count: 3,
      involvedObject: "Pod/rdv-0",
    });
    expect(events[1]?.message).toBe("older");
    expect(clients.core.listNamespacedEvent).toHaveBeenCalledWith({
      namespace: "rdv-alpha",
      limit: 100,
    });
  });

  it("returns an empty array when there are no events", async () => {
    const clients = makeLifecycleClients();
    expect(await listInstanceEvents("alpha", clients)).toEqual([]);
  });
});

describe("parseQuantityToBytes", () => {
  it("parses binary IEC suffixes", () => {
    expect(parseQuantityToBytes("1Ki")).toBe(1024);
    expect(parseQuantityToBytes("1Mi")).toBe(1024 ** 2);
    expect(parseQuantityToBytes("10Gi")).toBe(10 * 1024 ** 3);
    expect(parseQuantityToBytes("2Ti")).toBe(2 * 1024 ** 4);
  });

  it("parses a plain byte count (no suffix)", () => {
    expect(parseQuantityToBytes("1024")).toBe(1024);
  });

  it("parses fractional quantities", () => {
    expect(parseQuantityToBytes("1.5Gi")).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it("orders grow-only comparisons correctly (20Gi > 10Gi)", () => {
    const a = parseQuantityToBytes("20Gi")!;
    const b = parseQuantityToBytes("10Gi")!;
    expect(a).toBeGreaterThan(b);
  });

  it("treats equal sizes as equal", () => {
    expect(parseQuantityToBytes("10Gi")).toBe(parseQuantityToBytes("10Gi"));
  });

  it("returns null for zero (a zero-size PVC request is meaningless)", () => {
    expect(parseQuantityToBytes("0")).toBeNull();
    expect(parseQuantityToBytes("0Gi")).toBeNull();
    expect(parseQuantityToBytes("0.0Mi")).toBeNull();
  });

  it("returns null for malformed / unsupported / negative values", () => {
    expect(parseQuantityToBytes("")).toBeNull();
    expect(parseQuantityToBytes("abc")).toBeNull();
    expect(parseQuantityToBytes("10GB")).toBeNull(); // decimal SI not supported
    expect(parseQuantityToBytes("10 Gi")).toBeNull();
    expect(parseQuantityToBytes(null)).toBeNull();
    expect(parseQuantityToBytes(undefined)).toBeNull();
  });
});
