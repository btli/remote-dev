import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiException } from "@kubernetes/client-node";
import {
  provisionInstance,
  terminateInstance,
  checkInstanceReady,
  namespaceExists,
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

    await expect(provisionInstance(row(), OPTS, clients)).resolves.toBeUndefined();
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
