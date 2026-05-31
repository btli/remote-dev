import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reconcileInstances,
  readProvisionEnv,
  type ReconcilerDeps,
} from "@/controller/reconciler";
import { ProvisioningError } from "@/lib/provisioner-service";
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
    provisionInstance: vi.fn(async () => undefined),
    checkInstanceReady: vi.fn(async () => ({ ready: true })),
    terminateInstance: vi.fn(async () => undefined),
    namespaceExists: vi.fn(async () => false),
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
  setNodeEnv(ORIGINAL_NODE_ENV);
  vi.clearAllMocks();
});

describe("reconcileInstances — requested → provisioning", () => {
  it("claims (provisioning) then calls provisionInstance; stays provisioning on success", async () => {
    const { db, updates } = makeDb([row("requested")]);
    const provisionInstance = vi.fn(async () => undefined);
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    // First update is the claim → provisioning.
    expect(updates[0]?.set.status).toBe("provisioning");
    expect(provisionInstance).toHaveBeenCalledOnce();
    // No error transition.
    expect(updates.some((u) => u.set.status === "error")).toBe(false);
  });

  it("generates an AUTH_SECRET and passes it to provisionInstance (never persisted)", async () => {
    const { db, updates } = makeDb([row("requested")]);
    let seenSecret: string | undefined;
    const provisionInstance = vi.fn(async (_r, opts) => {
      seenSecret = opts.authSecret;
    });
    await reconcileInstances(baseDeps({ db, provisionInstance }));

    expect(seenSecret).toBeDefined();
    expect(seenSecret!.length).toBeGreaterThan(20); // 32 random bytes, base64
    // The secret must NOT appear in any DB write.
    const allWrites = JSON.stringify(updates);
    expect(allWrites).not.toContain(seenSecret!);
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

  it("past the 120s budget → error AND deletes the namespace (Fix 1 cleanup)", async () => {
    const old = new Date("2026-05-30T00:00:00Z"); // long ago
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: old, createdAt: old }),
    ]);
    const terminateInstance = vi.fn(async () => undefined);
    await reconcileInstances(
      baseDeps({
        db,
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
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: now, createdAt: now }),
    ]);
    const provisionInstance = vi.fn(async () => undefined);
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
    const { db, updates } = makeDb([
      row("provisioning", { updatedAt: now, createdAt: now }),
    ]);
    const provisionInstance = vi.fn(async () => undefined);
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
    const provisionInstance = vi.fn(async () => undefined);
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
