import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reconcileInstances,
  readProvisionEnv,
  parseNodeSelector,
  parseProvisionBaseline,
  parseReadinessBudgetMs,
  READINESS_BUDGET_MS,
  type ReconcilerDeps,
} from "@/controller/reconciler";
import { ProvisioningError } from "@/lib/provisioner-service";
import type { ProvisionOptions } from "@/lib/provisioner-service";
import type { InstanceRow, InstanceStatus } from "@/db/schema";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

/**
 * Minimal fake Drizzle db. Records update().set() payloads + insert().values()
 * payloads so we can assert state transitions + audit rows without a real DB.
 *
 * Call shapes used by the reconciler:
 *   db.select().from(t).where(cond)        → Promise<InstanceRow[]>  (instance load)
 *   db.update(t).set(v).where(c)           → thenable (returns [] )
 *   db.insert(t).values(v)                 → thenable
 *   db.query.instanceSeed.findFirst({...}) → seed row | undefined
 */
interface UpdateCapture {
  set: Record<string, unknown>;
}
interface InsertCapture {
  values: Record<string, unknown>;
}

function makeDb(rows: InstanceRow[], seed?: { authorizedEmails?: string | null }) {
  const updates: UpdateCapture[] = [];
  const inserts: InsertCapture[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push({ set });
          return Promise.resolve([{ ...rows[0], ...set }]);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ values });
        return Promise.resolve(undefined);
      },
    }),
    query: {
      instanceSeed: {
        findFirst: async () => (seed ? seed : undefined),
      },
    },
  };

  return { db: db as unknown as ReconcilerDeps["db"], updates, inserts };
}

function row(status: InstanceStatus, overrides: Partial<InstanceRow> = {}): InstanceRow {
  const now = new Date();
  return {
    id: "id-1",
    slug: "alpha",
    displayName: "Alpha",
    ownerId: "owner-1",
    status,
    errorMessage: null,
    namespace: "rdv-alpha",
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstanceRow;
}

const fakeClients = {} as ReturnType<ReconcilerDeps["getClients"]>;

function baseDeps(over: Partial<ReconcilerDeps>): ReconcilerDeps {
  return {
    db: makeDb([]).db,
    // SQLite path: provisionInstance returns null (no per-instance CNPG DB).
    provisionInstance: vi.fn(async () => null),
    checkInstanceReady: vi.fn(async () => ({ ready: true })),
    terminateInstance: vi.fn(async () => undefined),
    namespaceExists: vi.fn(async () => false),
    // Default to NO labels → the label-gated image auto-roll (tpb5) is off, so
    // every existing test preserves its pre-tpb5 behavior even though the global
    // beforeEach sets SUPERVISOR_INSTANCE_IMAGE.
    getNamespaceLabels: vi.fn(async () => ({}) as Record<string, string>),
    // Phase 2 steady-state deps — default to "nothing to converge" so existing
    // requested/provisioning/terminating tests are unaffected.
    getStatefulSet: vi.fn(async () => ({
      found: true,
      replicas: 1,
      readyReplicas: 1,
      image: undefined,
    })),
    setStatefulSetReplicas: vi.fn(async () => undefined),
    setStatefulSetImage: vi.fn(async () => undefined),
    getPvc: vi.fn(async () => ({ found: true, requestedStorage: "10Gi" })),
    resizePvc: vi.fn(async () => undefined),
    getClients: () => fakeClients,
    now: () => new Date("2026-05-31T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/x@sha256:abc";
  process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
});

afterEach(() => {
  delete process.env.SUPERVISOR_INSTANCE_IMAGE;
  delete process.env.SUPERVISOR_INSTANCE_HOST;
  delete process.env.CF_ACCESS_TEAM;
  delete process.env.CF_ACCESS_AUD;
  delete process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME;
  delete process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON;
  delete process.env.SUPERVISOR_INSTANCE_NODE_SELECTOR;
  delete process.env.SUPERVISOR_INSTANCE_BASELINE_PACKAGES;
  delete process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID;
  delete process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON;
  setNodeEnv(ORIGINAL_NODE_ENV);
  vi.clearAllMocks();
});

describe("reconcileInstances — requested → provisioning", () => {
  it("claims (provisioning) then calls provisionInstance; stays provisioning on success", async () => {
    const { db, updates } = makeDb([row("requested")]);
    const provisionInstance = vi.fn(async () => null);
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    // First update is the claim → provisioning.
    expect(updates[0]?.set.status).toBe("provisioning");
    expect(provisionInstance).toHaveBeenCalledOnce();
    // No error transition.
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  // Typed mock so `.mock.calls[i][1]` is a ProvisionOptions (a bare
  // `vi.fn(async () => null)` infers zero params, hiding opts.authorizedEmails).
  const seedProvisionMock = () =>
    vi.fn(async (_row: InstanceRow, _opts: ProvisionOptions) => null);

  it("passes the instance_seed authorizedEmails into provisionInstance (remote-dev-sb98)", async () => {
    // A seed row carrying a JSON email array → opts.authorizedEmails populated
    // (these become the StatefulSet's AUTHORIZED_USERS env → boot-time seed).
    const { db } = makeDb([row("requested")], {
      authorizedEmails: JSON.stringify(["a@example.com", "b@example.com"]),
    });
    const provisionInstance = seedProvisionMock();
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    const opts = provisionInstance.mock.calls[0]?.[1];
    expect(opts?.authorizedEmails).toEqual(["a@example.com", "b@example.com"]);
  });

  it("leaves authorizedEmails undefined when there is no instance_seed row", async () => {
    // makeDb without a seed arg → findFirst returns undefined.
    const { db } = makeDb([row("requested")]);
    const provisionInstance = seedProvisionMock();
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    const opts = provisionInstance.mock.calls[0]?.[1];
    expect(opts?.authorizedEmails).toBeUndefined();
  });

  it("treats a malformed instance_seed.authorizedEmails as no seed (non-fatal)", async () => {
    // Invalid JSON must NOT fail provisioning — it just yields no AUTHORIZED_USERS.
    const { db, updates } = makeDb([row("requested")], {
      authorizedEmails: "not-json",
    });
    const provisionInstance = seedProvisionMock();
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    const opts = provisionInstance.mock.calls[0]?.[1];
    expect(opts?.authorizedEmails).toBeUndefined();
    // Provisioning still proceeds (no error transition).
    expect(provisionInstance).toHaveBeenCalledOnce();
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  it("DROPS a comma-bearing seed entry but keeps the valid remainder (remote-dev-sb98)", async () => {
    // A comma inside an entry would split into extra authorized users via the env
    // round-trip — the lenient normalizer drops it; provisioning continues.
    const { db, updates } = makeDb([row("requested")], {
      authorizedEmails: JSON.stringify([
        "ok@example.com",
        "evil@example.com,extra@example.com",
        "ok2@example.com",
      ]),
    });
    const provisionInstance = seedProvisionMock();
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    const opts = provisionInstance.mock.calls[0]?.[1];
    expect(opts?.authorizedEmails).toEqual(["ok@example.com", "ok2@example.com"]);
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  it("caps seed emails at 100 entries at the reconciler read", async () => {
    const many = Array.from({ length: 150 }, (_, i) => `u${i}@example.com`);
    const { db } = makeDb([row("requested")], {
      authorizedEmails: JSON.stringify(many),
    });
    const provisionInstance = seedProvisionMock();
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    const opts = provisionInstance.mock.calls[0]?.[1];
    expect(opts?.authorizedEmails).toHaveLength(100);
  });

  it("persists dbConfigSnapshot when provisionInstance returns one (Postgres, Unit 8)", async () => {
    const { db, updates } = makeDb([row("requested")]);
    const snapshot = {
      type: "postgres" as const,
      dbName: "rdv_alpha",
      roleName: "rdv_alpha",
      poolerHost: "pooler.cnpg.svc",
    };
    const provisionInstance = vi.fn(async () => snapshot);
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    // One of the row writes sets dbConfigSnapshot to the serialized snapshot.
    const dbWrite = updates.find((u) => "dbConfigSnapshot" in u.set);
    expect(dbWrite?.set.dbConfigSnapshot).toBe(JSON.stringify(snapshot));
  });

  it("does NOT write dbConfigSnapshot on the SQLite path (provisionInstance → null)", async () => {
    const { db, updates } = makeDb([row("requested")]);
    // baseDeps default provisionInstance returns null (SQLite path).
    await reconcileInstances(baseDeps({ db }));
    expect(updates.some((u) => "dbConfigSnapshot" in u.set)).toBe(false);
  });

  it("does NOT re-write dbConfigSnapshot when the row already carries it (self-heal preserves the deadline)", async () => {
    const snapshot = {
      type: "postgres" as const,
      dbName: "rdv_alpha",
      roleName: "rdv_alpha",
      poolerHost: "pooler.cnpg.svc",
    };
    // Row already has the snapshot AND is mid-provisioning → a self-heal tick.
    const { db, updates } = makeDb([
      row("provisioning", { dbConfigSnapshot: JSON.stringify(snapshot) }),
    ]);
    const provisionInstance = vi.fn(async () => snapshot);
    // Within budget + STS missing triggers the self-heal re-provision.
    const checkInstanceReady = vi.fn(async () => ({
      ready: false,
      reason: "statefulset-not-found",
    }));
    await reconcileInstances(baseDeps({ db, provisionInstance, checkInstanceReady }));

    expect(provisionInstance).toHaveBeenCalledOnce();
    // No dbConfigSnapshot write (already stored) → updatedAt is not bumped.
    expect(updates.some((u) => "dbConfigSnapshot" in u.set)).toBe(false);
  });

  it("generates an AUTH_SECRET and passes it to provisionInstance (never persisted)", async () => {
    const { db, updates } = makeDb([row("requested")]);
    let seenSecret: string | undefined;
    const provisionInstance = vi.fn(async (_r, opts) => {
      seenSecret = opts.authSecret;
      return null;
    });
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    expect(seenSecret).toBeDefined();
    expect(seenSecret!.length).toBeGreaterThan(20); // 32 random bytes, base64
    // The secret must NOT appear in any DB write.
    const allWrites = JSON.stringify(updates);
    expect(allWrites).not.toContain(seenSecret!);
  });

  it("builds the storage target from the row's snapshot (authoritative, jvcx.5)", async () => {
    const snapshot = {
      kind: "local-path",
      storageClassName: "local-path",
      nodeHostname: "worker-7",
      size: "10Gi",
    };
    const { db } = makeDb([
      row("requested", { storageConfigSnapshot: JSON.stringify(snapshot) }),
    ]);
    let seenStorage: unknown;
    const provisionInstance = vi.fn(async (_r, opts) => {
      seenStorage = opts.storage;
      return null;
    });
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    expect(seenStorage).toMatchObject({
      kind: "local-path",
      storageClassName: "local-path",
      nodeHostname: "worker-7",
    });
  });

  it("falls back to the cluster default when the snapshot is absent (older rows)", async () => {
    const { db } = makeDb([row("requested", { storageConfigSnapshot: null })]);
    let seenStorage: { kind?: string; configSnapshot?: Record<string, unknown> } | undefined;
    const provisionInstance = vi.fn(async (_r, opts) => {
      seenStorage = opts.storage;
      return null;
    });
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    expect(seenStorage?.kind).toBe("storage-class");
    expect(seenStorage?.configSnapshot).toMatchObject({ isDefault: true });
  });

  it("a ProvisioningError transitions the instance to error", async () => {
    const { db, updates } = makeDb([row("requested")]);
    const provisionInstance = vi.fn(async () => {
      throw new ProvisioningError("service", new Error("boom"));
    });
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    expect(updates.some((u) => u.set.status === "error")).toBe(true);
    const errUpdate = updates.find((u) => u.set.status === "error");
    expect(String(errUpdate?.set.errorMessage)).toContain("service");
  });
});

describe("reconcileInstances — provisioning → ready / error", () => {
  it("ready when checkInstanceReady true; sets provisionedAt + baseUrl", async () => {
    const { db, updates } = makeDb([row("provisioning")]);
    await reconcileInstances(
      baseDeps({ db, checkInstanceReady: vi.fn(async () => ({ ready: true })) }),
    );
    const readyUpdate = updates.find((u) => u.set.status === "ready");
    expect(readyUpdate).toBeDefined();
    expect(readyUpdate?.set.provisionedAt).toBeInstanceOf(Date);
    expect(readyUpdate?.set.baseUrl).toBe("https://dev.example.com/alpha");
  });

  it("past the readiness budget → error AND deletes the namespace (Fix 1 cleanup)", async () => {
    const now = new Date("2026-05-31T00:00:00Z");
    // Anchor the claim just PAST the (configurable) budget, computed from the
    // imported constant so this stays correct if the default ever changes.
    const past = new Date(now.getTime() - (READINESS_BUDGET_MS + 1_000));
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: past, createdAt: past }),
    ]);
    const terminateInstance = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        now: () => now,
        terminateInstance,
        checkInstanceReady: vi.fn(async () => ({ ready: false, reason: "pending" })),
      }),
    );
    expect(updates.some((u) => u.set.status === "error")).toBe(true);
    // No orphaned namespace: timeout tears it down.
    expect(terminateInstance).toHaveBeenCalledOnce();
  });

  it("within budget + StatefulSet MISSING → re-runs provisionInstance (self-heal, Fix 1)", async () => {
    const now = new Date("2026-05-31T00:00:00Z");
    // Aged but still 30s inside the (configurable) budget.
    const claimed = new Date(now.getTime() - (READINESS_BUDGET_MS - 30_000));
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: claimed, createdAt: claimed }),
    ]);
    const provisionInstance = vi.fn(async () => null);
    await reconcileInstances(
      baseDeps({
        db,
        now: () => now,
        provisionInstance,
        checkInstanceReady: vi.fn(async () => ({
          ready: false,
          reason: "statefulset-not-found",
        })),
      }),
    );
    expect(provisionInstance).toHaveBeenCalledOnce();
    // Self-heal must NOT transition status nor reset the deadline.
    expect(updates.some((u) => u.set.status === "ready" || u.set.status === "error")).toBe(
      false,
    );
  });

  it("within budget + still coming up (not SS-missing) → NO write, deadline preserved (Fix 1 anchor)", async () => {
    const now = new Date("2026-05-31T00:00:00Z");
    // Aged but still 30s inside the (configurable) budget.
    const claimed = new Date(now.getTime() - (READINESS_BUDGET_MS - 30_000));
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: claimed, createdAt: claimed }),
    ]);
    const provisionInstance = vi.fn(async () => null);
    await reconcileInstances(
      baseDeps({
        db,
        now: () => now,
        provisionInstance,
        checkInstanceReady: vi.fn(async () => ({ ready: false, reason: "readyReplicas=0" })),
      }),
    );
    // No re-provision (SS exists), no status change, and crucially NO row write
    // at all — so updatedAt (the timeout anchor) is never refreshed by a tick.
    expect(provisionInstance).not.toHaveBeenCalled();
    expect(updates.length).toBe(0);
  });
});

describe("reconcileInstances — terminating → deleted", () => {
  it("namespace already gone → marks deleted WITHOUT re-issuing delete (Fix 2)", async () => {
    const { db, updates } = makeDb([row("terminating")]);
    const terminateInstance = vi.fn(async () => undefined);
    const namespaceExists = vi.fn(async () => false);
    await reconcileInstances(
      baseDeps({ db, terminateInstance, namespaceExists }),
    );
    // Existence checked FIRST; gone → no deleteNamespace API write this tick.
    expect(namespaceExists).toHaveBeenCalledOnce();
    expect(terminateInstance).not.toHaveBeenCalled();
    const del = updates.find((u) => u.set.status === "deleted");
    expect(del).toBeDefined();
    expect(del?.set.deletedAt).toBeInstanceOf(Date);
  });

  it("namespace still exists → (re)issues delete, stays terminating", async () => {
    const { db, updates } = makeDb([row("terminating")]);
    const terminateInstance = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({ db, terminateInstance, namespaceExists: vi.fn(async () => true) }),
    );
    expect(terminateInstance).toHaveBeenCalledOnce();
    expect(updates.some((u) => u.set.status === "deleted")).toBe(false);
  });
});

describe("reconcileInstances — resilience", () => {
  it("k8s client unavailable: returns without crashing and does NOT mark error", async () => {
    const { db, updates } = makeDb([row("requested")]);
    const provisionInstance = vi.fn(async () => null);
    await expect(
      reconcileInstances(
        baseDeps({
          db,
          provisionInstance,
          getClients: () => {
            throw new Error("Kubernetes config unavailable");
          },
        }),
      ),
    ).resolves.toBeUndefined();

    // No provisioning attempted, no error transition.
    expect(provisionInstance).not.toHaveBeenCalled();
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  it("no instances → no-op (clients never acquired)", async () => {
    const { db } = makeDb([]);
    const getClients = vi.fn(() => fakeClients);
    await reconcileInstances(baseDeps({ db, getClients }));
    expect(getClients).not.toHaveBeenCalled();
  });

  it("a per-instance error does not abort the tick", async () => {
    const { db, updates } = makeDb([row("requested")]);
    // provision throws a NON-ProvisioningError unexpected error AFTER claim.
    const provisionInstance = vi.fn(async () => {
      throw new Error("unexpected");
    });
    await expect(
      reconcileInstances(baseDeps({ db, provisionInstance })),
    ).resolves.toBeUndefined();
    // Unexpected error is treated as error transition (deterministic).
    expect(updates.some((u) => u.set.status === "error")).toBe(true);
  });
});

describe("reconcileInstances — steady-state convergence (Phase 2)", () => {
  it("suspended + replicas=1 → scales to 0 (no status change)", async () => {
    const { db, updates, inserts } = makeDb([row("suspended")]);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetReplicas,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: undefined,
        })),
      }),
    );
    expect(setStatefulSetReplicas).toHaveBeenCalledWith("alpha", 0, fakeClients);
    // No status write (steady-state never transitions); audit row recorded.
    expect(updates.length).toBe(0);
    expect(inserts.some((i) => i.values.action === "scale")).toBe(true);
  });

  it("suspended + already replicas=0 → no scale, NO row write (pure no-op tick)", async () => {
    const { db, updates, inserts } = makeDb([row("suspended")]);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetReplicas,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 0,
          readyReplicas: 0,
          image: undefined,
        })),
        getPvc: vi.fn(async () => ({ found: true, requestedStorage: "10Gi" })),
      }),
    );
    expect(setStatefulSetReplicas).not.toHaveBeenCalled();
    expect(updates.length).toBe(0);
    expect(inserts.length).toBe(0);
  });

  it("ready + replicas=0 → scales to 1", async () => {
    const { db, inserts } = makeDb([row("ready")]);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetReplicas,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 0,
          readyReplicas: 0,
          image: undefined,
        })),
      }),
    );
    expect(setStatefulSetReplicas).toHaveBeenCalledWith("alpha", 1, fakeClients);
    expect(inserts.some((i) => i.values.action === "scale")).toBe(true);
  });

  it("ready + already replicas=1 → no scale", async () => {
    const { db } = makeDb([row("ready")]);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetReplicas,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: undefined,
        })),
      }),
    );
    expect(setStatefulSetReplicas).not.toHaveBeenCalled();
  });

  it("image patched only on mismatch (audit image:rollout)", async () => {
    const { db, inserts } = makeDb([
      row("ready", { imageTag: "ghcr.io/x@sha256:new" }),
    ]);
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetImage,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: "ghcr.io/x@sha256:old",
        })),
      }),
    );
    expect(setStatefulSetImage).toHaveBeenCalledWith(
      "alpha",
      "ghcr.io/x@sha256:new",
      fakeClients,
    );
    expect(inserts.some((i) => i.values.action === "image:rollout")).toBe(true);
  });

  it("image NOT patched when it already matches the desired tag", async () => {
    const { db } = makeDb([row("ready", { imageTag: "ghcr.io/x@sha256:same" })]);
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetImage,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: "ghcr.io/x@sha256:same",
        })),
      }),
    );
    expect(setStatefulSetImage).not.toHaveBeenCalled();
  });

  it("image NOT patched when the live image is undefined (no spurious rollout)", async () => {
    const { db, inserts } = makeDb([
      row("ready", { imageTag: "ghcr.io/x@sha256:new" }),
    ]);
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetImage,
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: undefined,
        })),
      }),
    );
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:rollout")).toBe(false);
  });

  it("resize only when desired is STRICTLY larger than the PVC's current request", async () => {
    const { db, inserts } = makeDb([row("ready", { storageRequest: "20Gi" })]);
    const resizePvc = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        resizePvc,
        getPvc: vi.fn(async () => ({ found: true, requestedStorage: "10Gi" })),
      }),
    );
    expect(resizePvc).toHaveBeenCalledWith("alpha", "20Gi", fakeClients);
    expect(inserts.some((i) => i.values.action === "resize")).toBe(true);
  });

  it("does NOT resize when desired equals current", async () => {
    const { db } = makeDb([row("ready", { storageRequest: "10Gi" })]);
    const resizePvc = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        resizePvc,
        getPvc: vi.fn(async () => ({ found: true, requestedStorage: "10Gi" })),
      }),
    );
    expect(resizePvc).not.toHaveBeenCalled();
  });

  it("a resize patch rejection is audited resize:failed and does NOT throw / error", async () => {
    const { db, updates, inserts } = makeDb([
      row("ready", { storageRequest: "20Gi" }),
    ]);
    const resizePvc = vi.fn(async () => {
      throw new Error("StorageClass does not allow volume expansion");
    });
    await expect(
      reconcileInstances(
        baseDeps({
          db,
          resizePvc,
          getPvc: vi.fn(async () => ({ found: true, requestedStorage: "10Gi" })),
        }),
      ),
    ).resolves.toBeUndefined();
    expect(inserts.some((i) => i.values.action === "resize:failed")).toBe(true);
    // No status change to error.
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  it("transient getStatefulSet failure → NO error, NO delete, NO write", async () => {
    const { db, updates, inserts } = makeDb([row("ready")]);
    const terminateInstance = vi.fn(async () => undefined);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await expect(
      reconcileInstances(
        baseDeps({
          db,
          terminateInstance,
          setStatefulSetReplicas,
          getStatefulSet: vi.fn(async () => {
            throw new Error("transient read error");
          }),
        }),
      ),
    ).resolves.toBeUndefined();
    expect(terminateInstance).not.toHaveBeenCalled();
    expect(setStatefulSetReplicas).not.toHaveBeenCalled();
    expect(updates.length).toBe(0);
    expect(inserts.length).toBe(0);
  });

  it("StatefulSet not found → nothing to converge (no scale, no write)", async () => {
    const { db, updates, inserts } = makeDb([row("ready")]);
    const setStatefulSetReplicas = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        setStatefulSetReplicas,
        getStatefulSet: vi.fn(async () => ({
          found: false,
          replicas: 0,
          readyReplicas: 0,
          image: undefined,
        })),
      }),
    );
    expect(setStatefulSetReplicas).not.toHaveBeenCalled();
    expect(updates.length).toBe(0);
    expect(inserts.length).toBe(0);
  });
});

describe("reconcileSteadyState — label-gated image auto-roll (tpb5)", () => {
  // Save/restore SUPERVISOR_INSTANCE_IMAGE so per-test overrides (incl. unset)
  // never leak — independent of the suite-wide beforeEach/afterEach.
  const ORIGINAL_IMAGE = process.env.SUPERVISOR_INSTANCE_IMAGE;
  afterEach(() => {
    if (ORIGINAL_IMAGE === undefined) {
      delete process.env.SUPERVISOR_INSTANCE_IMAGE;
    } else {
      process.env.SUPERVISOR_INSTANCE_IMAGE = ORIGINAL_IMAGE;
    }
  });

  // The global image a bump publishes; instances on the old pin should follow it
  // only when their namespace opts in via rdv.io/auto-update=true.
  const GLOBAL = "ghcr.io/x@sha256:global";
  const OLD = "ghcr.io/x@sha256:old";

  // A ready instance pinned to the OLD image, with a live STS still on OLD, so a
  // successful auto-roll both syncs row.imageTag AND rolls the StatefulSet.
  function readyOnOld() {
    return makeDb([row("ready", { imageTag: OLD })]);
  }
  const stsOnOld = () =>
    vi.fn(async () => ({
      found: true,
      replicas: 1,
      readyReplicas: 1,
      image: OLD,
    }));

  it("(a) label rdv.io/auto-update=true + envImage differs → syncs imageTag, rolls STS, audits image:autoroll", async () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = GLOBAL;
    const { db, updates, inserts } = readyOnOld();
    const getNamespaceLabels = vi.fn(async () => ({ "rdv.io/auto-update": "true" }));
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({ db, getNamespaceLabels, setStatefulSetImage, getStatefulSet: stsOnOld() }),
    );

    // Labels read with the FULL namespace name (row.namespace), not the slug.
    expect(getNamespaceLabels).toHaveBeenCalledWith("rdv-alpha", fakeClients);
    // imageTag persisted to the global image (+ updatedAt bumped).
    const pin = updates.find((u) => u.set.imageTag === GLOBAL);
    expect(pin).toBeDefined();
    expect(pin?.set.updatedAt).toBeInstanceOf(Date);
    // No status change.
    expect(updates.some((u) => "status" in u.set)).toBe(false);
    // StatefulSet rolled to the global image THIS tick (step 2 picks up the
    // mutated row.imageTag).
    expect(setStatefulSetImage).toHaveBeenCalledWith("alpha", GLOBAL, fakeClients);
    // image:autoroll audit (from OLD → GLOBAL).
    const audit = inserts.find((i) => i.values.action === "image:autoroll");
    expect(audit).toBeDefined();
    const meta = JSON.parse(String(audit?.values.metadata));
    expect(meta).toEqual({ from: OLD, to: GLOBAL });
    // The follow-on rollout audit is the existing image:rollout row.
    expect(inserts.some((i) => i.values.action === "image:rollout")).toBe(true);
  });

  it("(b) label absent → no imageTag change, no roll, no autoroll audit", async () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = GLOBAL;
    const { db, updates, inserts } = readyOnOld();
    const getNamespaceLabels = vi.fn(async () => ({})); // no labels
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({ db, getNamespaceLabels, setStatefulSetImage, getStatefulSet: stsOnOld() }),
    );

    expect(updates.some((u) => u.set.imageTag === GLOBAL)).toBe(false);
    // STS stays on its OLD pin (row.imageTag === OLD === sts.image → no roll).
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:autoroll")).toBe(false);
  });

  it('(c) label rdv.io/auto-update="false" → no change, no roll, no autoroll audit', async () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = GLOBAL;
    const { db, updates, inserts } = readyOnOld();
    const getNamespaceLabels = vi.fn(async () => ({ "rdv.io/auto-update": "false" }));
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({ db, getNamespaceLabels, setStatefulSetImage, getStatefulSet: stsOnOld() }),
    );

    expect(updates.some((u) => u.set.imageTag === GLOBAL)).toBe(false);
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:autoroll")).toBe(false);
  });

  it("(d) envImage === imageTag → no-op (label not even read; no change/roll)", async () => {
    // Instance already pinned to the global image → nothing to auto-roll.
    process.env.SUPERVISOR_INSTANCE_IMAGE = GLOBAL;
    const { db, updates, inserts } = makeDb([row("ready", { imageTag: GLOBAL })]);
    const getNamespaceLabels = vi.fn(async () => ({ "rdv.io/auto-update": "true" }));
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
        getNamespaceLabels,
        setStatefulSetImage,
        // STS already on the global image too → no rollout either.
        getStatefulSet: vi.fn(async () => ({
          found: true,
          replicas: 1,
          readyReplicas: 1,
          image: GLOBAL,
        })),
      }),
    );

    // envImage === row.imageTag short-circuits BEFORE the label read.
    expect(getNamespaceLabels).not.toHaveBeenCalled();
    expect(updates.some((u) => u.set.imageTag === GLOBAL)).toBe(false);
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:autoroll")).toBe(false);
  });

  it("(e) SUPERVISOR_INSTANCE_IMAGE unset → getNamespaceLabels NOT called, no change", async () => {
    delete process.env.SUPERVISOR_INSTANCE_IMAGE;
    const { db, updates, inserts } = readyOnOld();
    const getNamespaceLabels = vi.fn(async () => ({ "rdv.io/auto-update": "true" }));
    const setStatefulSetImage = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({ db, getNamespaceLabels, setStatefulSetImage, getStatefulSet: stsOnOld() }),
    );

    // No env image → the label read is skipped entirely (no extra API call).
    expect(getNamespaceLabels).not.toHaveBeenCalled();
    expect(updates.some((u) => u.set.imageTag === GLOBAL)).toBe(false);
    // row.imageTag (OLD) still matches sts.image (OLD) → no rollout.
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:autoroll")).toBe(false);
  });

  it("(f) getNamespaceLabels throws → NON-FATAL: no status/error transition, no roll", async () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = GLOBAL;
    const { db, updates, inserts } = readyOnOld();
    const getNamespaceLabels = vi.fn(async () => {
      throw new Error("transient namespace read error");
    });
    const setStatefulSetImage = vi.fn(async () => undefined);
    const terminateInstance = vi.fn(async () => undefined);
    await expect(
      reconcileInstances(
        baseDeps({
          db,
          getNamespaceLabels,
          setStatefulSetImage,
          terminateInstance,
          getStatefulSet: stsOnOld(),
        }),
      ),
    ).resolves.toBeUndefined();

    // Read failure is swallowed: no imageTag sync, no roll, no autoroll audit.
    expect(updates.some((u) => u.set.imageTag === GLOBAL)).toBe(false);
    expect(setStatefulSetImage).not.toHaveBeenCalled();
    expect(inserts.some((i) => i.values.action === "image:autoroll")).toBe(false);
    // Crucially: never transitions to error and never tears the namespace down.
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
    expect(terminateInstance).not.toHaveBeenCalled();
  });
});

describe("readProvisionEnv — CF Access required in prod (Fix 6)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/x@sha256:abc";
    process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
  });

  it("throws in production when CF_ACCESS_TEAM/AUD are empty", () => {
    setNodeEnv("production");
    delete process.env.CF_ACCESS_TEAM;
    delete process.env.CF_ACCESS_AUD;
    expect(() => readProvisionEnv()).toThrow(/CF_ACCESS/);
  });

  it("throws in production when only one CF tag is set", () => {
    setNodeEnv("production");
    process.env.CF_ACCESS_TEAM = "myteam";
    delete process.env.CF_ACCESS_AUD;
    expect(() => readProvisionEnv()).toThrow(/CF_ACCESS/);
  });

  it("succeeds in production when both CF tags are set", () => {
    setNodeEnv("production");
    process.env.CF_ACCESS_TEAM = "myteam";
    process.env.CF_ACCESS_AUD = "aud-123";
    const env = readProvisionEnv();
    expect(env.cfAccess).toEqual({ team: "myteam", aud: "aud-123" });
  });

  it("does NOT throw in dev when CF tags are empty (warns instead)", () => {
    setNodeEnv("development");
    delete process.env.CF_ACCESS_TEAM;
    delete process.env.CF_ACCESS_AUD;
    expect(() => readProvisionEnv()).not.toThrow();
    expect(readProvisionEnv().cfAccess).toEqual({ team: "", aud: "" });
  });

  it("still requires SUPERVISOR_INSTANCE_IMAGE/HOST", () => {
    setNodeEnv("development");
    delete process.env.SUPERVISOR_INSTANCE_IMAGE;
    expect(() => readProvisionEnv()).toThrow(/SUPERVISOR_INSTANCE_IMAGE/);
  });
});

describe("parseNodeSelector (remote-dev-389c)", () => {
  it("undefined/empty/whitespace → undefined", () => {
    expect(parseNodeSelector(undefined)).toBeUndefined();
    expect(parseNodeSelector("")).toBeUndefined();
    expect(parseNodeSelector("   ")).toBeUndefined();
  });

  it("parses a single key=value pair", () => {
    expect(parseNodeSelector("kubernetes.io/arch=amd64")).toEqual({
      "kubernetes.io/arch": "amd64",
    });
  });

  it("parses multiple comma-separated pairs (trimming whitespace)", () => {
    expect(parseNodeSelector(" kubernetes.io/arch=amd64 , disktype=ssd ")).toEqual({
      "kubernetes.io/arch": "amd64",
      disktype: "ssd",
    });
  });

  it("tolerates a trailing comma (skips the empty entry)", () => {
    expect(parseNodeSelector("kubernetes.io/arch=amd64,")).toEqual({
      "kubernetes.io/arch": "amd64",
    });
  });

  it("throws on a malformed entry (no '=' or empty key)", () => {
    expect(() => parseNodeSelector("kubernetes.io/arch")).toThrow(
      /SUPERVISOR_INSTANCE_NODE_SELECTOR is malformed/,
    );
    expect(() => parseNodeSelector("=amd64")).toThrow(
      /SUPERVISOR_INSTANCE_NODE_SELECTOR is malformed/,
    );
  });
});

describe("readProvisionEnv — image-pull secret + nodeSelector (remote-dev-2xhg/389c)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/x@sha256:abc";
    process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
    setNodeEnv("development");
  });

  it("reads name + dockerconfigjson into imagePullSecret", () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME = "harbor-registry";
    process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON =
      '{"auths":{"harbor.example.com":{"auth":"xxx"}}}';
    const env = readProvisionEnv();
    expect(env.imagePullSecret).toEqual({
      name: "harbor-registry",
      dockerConfigJson: '{"auths":{"harbor.example.com":{"auth":"xxx"}}}',
    });
  });

  it("name only → dockerConfigJson undefined (operator pre-provisioned the secret)", () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME = "harbor-registry";
    const env = readProvisionEnv();
    expect(env.imagePullSecret).toEqual({
      name: "harbor-registry",
      dockerConfigJson: undefined,
    });
  });

  it("dockerconfigjson without a name throws (a nameless secret can't be created/referenced)", () => {
    process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON =
      '{"auths":{}}';
    delete process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME;
    expect(() => readProvisionEnv()).toThrow(
      /SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON is set but SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME is not/,
    );
  });

  it("neither set → imagePullSecret undefined", () => {
    delete process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME;
    delete process.env.SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON;
    expect(readProvisionEnv().imagePullSecret).toBeUndefined();
  });

  it("parses SUPERVISOR_INSTANCE_NODE_SELECTOR into nodeSelector", () => {
    process.env.SUPERVISOR_INSTANCE_NODE_SELECTOR = "kubernetes.io/arch=amd64";
    expect(readProvisionEnv().nodeSelector).toEqual({
      "kubernetes.io/arch": "amd64",
    });
  });

  it("nodeSelector undefined when the env var is unset", () => {
    delete process.env.SUPERVISOR_INSTANCE_NODE_SELECTOR;
    expect(readProvisionEnv().nodeSelector).toBeUndefined();
  });
});

describe("parseProvisionBaseline (remote-dev-uobt)", () => {
  it("undefined/empty/whitespace → undefined", () => {
    expect(parseProvisionBaseline(undefined)).toBeUndefined();
    expect(parseProvisionBaseline("")).toBeUndefined();
    expect(parseProvisionBaseline("   ")).toBeUndefined();
  });

  it("returns the ORIGINAL string unchanged when it is valid JSON", () => {
    const raw = '{"npm":["typescript"],"pip":["ruff"]}';
    expect(parseProvisionBaseline(raw)).toBe(raw);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseProvisionBaseline("{not json")).toThrow(
      /SUPERVISOR_INSTANCE_BASELINE_PACKAGES is not valid JSON/,
    );
  });
});

describe("readProvisionEnv — provision baseline (remote-dev-uobt)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/x@sha256:abc";
    process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
    setNodeEnv("development");
  });

  it("reads SUPERVISOR_INSTANCE_BASELINE_PACKAGES verbatim into provisionBaseline", () => {
    const raw = '{"apt":["jq"],"npm":["typescript"]}';
    process.env.SUPERVISOR_INSTANCE_BASELINE_PACKAGES = raw;
    expect(readProvisionEnv().provisionBaseline).toBe(raw);
  });

  it("provisionBaseline undefined when the env var is unset", () => {
    delete process.env.SUPERVISOR_INSTANCE_BASELINE_PACKAGES;
    expect(readProvisionEnv().provisionBaseline).toBeUndefined();
  });

  it("throws when the baseline is malformed JSON", () => {
    process.env.SUPERVISOR_INSTANCE_BASELINE_PACKAGES = "{nope";
    expect(() => readProvisionEnv()).toThrow(
      /SUPERVISOR_INSTANCE_BASELINE_PACKAGES is not valid JSON/,
    );
  });
});

describe("readProvisionEnv — FCM (remote-dev-wnl4)", () => {
  const PROJECT_ID = "my-firebase-project";
  const SA_JSON = '{"type":"service_account","project_id":"my-firebase-project"}';

  beforeEach(() => {
    process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/x@sha256:abc";
    process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
    setNodeEnv("development");
  });

  it("populates fcm only when BOTH project id + service-account JSON are set", () => {
    process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID = PROJECT_ID;
    process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON = SA_JSON;
    expect(readProvisionEnv().fcm).toEqual({
      projectId: PROJECT_ID,
      serviceAccountJson: SA_JSON,
    });
  });

  it("fcm undefined when only the project id is set", () => {
    process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID = PROJECT_ID;
    delete process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON;
    expect(readProvisionEnv().fcm).toBeUndefined();
  });

  it("fcm undefined when only the service-account JSON is set", () => {
    delete process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID;
    process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON = SA_JSON;
    expect(readProvisionEnv().fcm).toBeUndefined();
  });

  it("fcm undefined when neither is set", () => {
    delete process.env.SUPERVISOR_INSTANCE_FCM_PROJECT_ID;
    delete process.env.SUPERVISOR_INSTANCE_FCM_SERVICE_ACCOUNT_JSON;
    expect(readProvisionEnv().fcm).toBeUndefined();
  });
});

describe("parseReadinessBudgetMs (remote-dev-qy7t)", () => {
  const DEFAULT = 360_000;

  // Save/restore so the env override never leaks between tests.
  const ORIGINAL_BUDGET = process.env.SUPERVISOR_READINESS_BUDGET_MS;
  afterEach(() => {
    if (ORIGINAL_BUDGET === undefined) {
      delete process.env.SUPERVISOR_READINESS_BUDGET_MS;
    } else {
      process.env.SUPERVISOR_READINESS_BUDGET_MS = ORIGINAL_BUDGET;
    }
  });

  it("defaults to 360000 (6 min) when the env var is unset", () => {
    expect(parseReadinessBudgetMs(undefined)).toBe(DEFAULT);
  });

  it("accepts a valid positive integer override", () => {
    expect(parseReadinessBudgetMs("300000")).toBe(300_000);
    expect(parseReadinessBudgetMs("120000")).toBe(120_000);
  });

  it("falls back to the default for empty / whitespace", () => {
    expect(parseReadinessBudgetMs("")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("   ")).toBe(DEFAULT);
  });

  it("falls back to the default for non-numeric / NaN", () => {
    expect(parseReadinessBudgetMs("abc")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("12x")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("NaN")).toBe(DEFAULT);
  });

  it("falls back to the default for zero / negative / fractional / Infinity", () => {
    expect(parseReadinessBudgetMs("0")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("-5000")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("1500.5")).toBe(DEFAULT);
    expect(parseReadinessBudgetMs("Infinity")).toBe(DEFAULT);
  });

  it("reads SUPERVISOR_READINESS_BUDGET_MS from the environment by default", () => {
    process.env.SUPERVISOR_READINESS_BUDGET_MS = "450000";
    expect(parseReadinessBudgetMs()).toBe(450_000);
    delete process.env.SUPERVISOR_READINESS_BUDGET_MS;
    expect(parseReadinessBudgetMs()).toBe(DEFAULT);
  });
});
