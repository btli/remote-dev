import { describe, it, expect, afterEach, vi } from "vitest";
import type {
  V1StorageClassList,
  V1NodeList,
  V1Node,
  V1StorageClass,
} from "@kubernetes/client-node";
import {
  resolveDefaultStorageTarget,
  toVolumeClaimTemplate,
  discoverStorageTargets,
  resolveStorageTarget,
  resolvedFromSnapshot,
  StorageTargetResolutionError,
  DATA_VOLUME_NAME,
  type StorageClients,
} from "@/lib/storage";

const ENV_KEYS = [
  "SUPERVISOR_DEFAULT_STORAGE_CLASS",
  "SUPERVISOR_DEFAULT_STORAGE_SIZE",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

// --- helpers ----------------------------------------------------------------

function sc(name: string, provisioner: string, isDefault = false): V1StorageClass {
  return {
    metadata: {
      name,
      ...(isDefault
        ? { annotations: { "storageclass.kubernetes.io/is-default-class": "true" } }
        : {}),
    },
    provisioner,
  } as V1StorageClass;
}

function node(
  name: string,
  opts: { controlPlane?: boolean; taintControlPlane?: boolean } = {},
): V1Node {
  const labels: Record<string, string> = {};
  if (opts.controlPlane) labels["node-role.kubernetes.io/control-plane"] = "";
  return {
    metadata: { name, labels },
    spec: opts.taintControlPlane
      ? {
          taints: [
            {
              key: "node-role.kubernetes.io/control-plane",
              effect: "NoSchedule",
            },
          ],
        }
      : {},
  } as V1Node;
}

/** A mock StorageClients returning the given SCs + nodes. */
function makeClients(scs: V1StorageClass[], nodes: V1Node[]): StorageClients {
  return {
    storage: {
      listStorageClass: vi.fn(
        async () => ({ items: scs }) as V1StorageClassList,
      ),
    },
    core: {
      listNode: vi.fn(async () => ({ items: nodes }) as V1NodeList),
    },
  };
}

/** A db stub whose registeredStorageTarget queries return `rows`. */
function makeDb(rows: Record<string, unknown>[]) {
  return {
    select: () => ({ from: async () => rows }),
    query: {
      registeredStorageTarget: {
        findFirst: async ({ where }: { where?: unknown }) => {
          void where;
          return rows[0];
        },
      },
    },
  } as never;
}

// --- resolveDefaultStorageTarget (existing) ---------------------------------

describe("resolveDefaultStorageTarget", () => {
  it("defaults to 10Gi and the cluster default SC when env unset", () => {
    const t = resolveDefaultStorageTarget();
    expect(t.id).toBeNull();
    expect(t.kind).toBe("storage-class");
    expect(t.storageClassName).toBeUndefined();
    expect(t.size).toBe("10Gi");
    expect(t.configSnapshot).toMatchObject({ isDefault: true, size: "10Gi" });
  });

  it("honors SUPERVISOR_DEFAULT_STORAGE_CLASS + SIZE", () => {
    process.env.SUPERVISOR_DEFAULT_STORAGE_CLASS = "longhorn";
    process.env.SUPERVISOR_DEFAULT_STORAGE_SIZE = "25Gi";
    const t = resolveDefaultStorageTarget();
    expect(t.storageClassName).toBe("longhorn");
    expect(t.size).toBe("25Gi");
    expect(t.resiliencyNote).toContain("longhorn");
  });

  it("env SIZE wins over the caller-supplied size; caller size is the fallback", () => {
    expect(resolveDefaultStorageTarget("5Gi").size).toBe("5Gi");
    process.env.SUPERVISOR_DEFAULT_STORAGE_SIZE = "40Gi";
    expect(resolveDefaultStorageTarget("5Gi").size).toBe("40Gi");
  });
});

// --- toVolumeClaimTemplate (existing) ---------------------------------------

describe("toVolumeClaimTemplate", () => {
  it("produces a data PVC: RWO, requested size, no SC when undefined", () => {
    const pvc = toVolumeClaimTemplate(resolveDefaultStorageTarget());
    expect(pvc.metadata?.name).toBe(DATA_VOLUME_NAME);
    expect(pvc.metadata?.name).toBe("data");
    expect(pvc.spec?.accessModes).toEqual(["ReadWriteOnce"]);
    expect(pvc.spec?.resources?.requests?.storage).toBe("10Gi");
    expect(pvc.spec?.storageClassName).toBeUndefined();
    expect(pvc.metadata?.annotations).toBeUndefined();
  });

  it("sets storageClassName when present", () => {
    const pvc = toVolumeClaimTemplate({
      id: "x",
      kind: "storage-class",
      storageClassName: "longhorn",
      size: "20Gi",
      resiliencyNote: "replicated",
      configSnapshot: {},
    });
    expect(pvc.spec?.storageClassName).toBe("longhorn");
    expect(pvc.spec?.resources?.requests?.storage).toBe("20Gi");
  });

  it("pins to a node via selected-node annotation when nodeHostname set (local-path)", () => {
    const pvc = toVolumeClaimTemplate({
      id: "lp",
      kind: "local-path",
      storageClassName: "local-path",
      size: "10Gi",
      nodeHostname: "worker-1",
      resiliencyNote: "node-pinned",
      configSnapshot: {},
    });
    expect(pvc.metadata?.annotations?.["volume.kubernetes.io/selected-node"]).toBe(
      "worker-1",
    );
    expect(pvc.spec?.storageClassName).toBe("local-path");
  });
});

// --- discoverStorageTargets -------------------------------------------------

describe("discoverStorageTargets", () => {
  it("always includes the `default` option first", async () => {
    const opts = await discoverStorageTargets(makeClients([], []), makeDb([]));
    expect(opts[0].id).toBe("default");
    expect(opts[0].isDefault).toBe(true);
  });

  it("Longhorn SC → replicated note; cloud CSI provisioner → cloud-csi kind", async () => {
    const clients = makeClients(
      [
        sc("longhorn", "driver.longhorn.io"),
        sc("ebs", "ebs.csi.aws.com"),
        sc("generic", "rancher.io/local-path"),
      ],
      [],
    );
    const opts = await discoverStorageTargets(clients, makeDb([]));

    const longhorn = opts.find((o) => o.id === "sc:longhorn");
    expect(longhorn?.kind).toBe("storage-class");
    expect(longhorn?.resiliencyNote.toLowerCase()).toContain("replicated");

    const ebs = opts.find((o) => o.id === "sc:ebs");
    expect(ebs?.kind).toBe("cloud-csi");
    expect(ebs?.resiliencyNote.toLowerCase()).toContain("reattaches");

    const generic = opts.find((o) => o.id === "sc:generic");
    expect(generic?.kind).toBe("storage-class");
  });

  it("flags the default-annotated SC as isDefault; the synthetic `default` is NOT (Fix 3)", async () => {
    const clients = makeClients(
      [sc("fast", "ebs.csi.aws.com", true)],
      [],
    );
    const opts = await discoverStorageTargets(clients, makeDb([]));
    const fast = opts.find((o) => o.id === "sc:fast");
    expect(fast?.isDefault).toBe(true);
    expect(fast?.name).toContain("default");
    // Exactly one option is the default — the annotated SC, NOT the generic one.
    expect(opts.find((o) => o.id === "default")?.isDefault).toBe(false);
    expect(opts.filter((o) => o.isDefault)).toHaveLength(1);
  });

  it("the synthetic `default` IS isDefault when no SC carries the default annotation (Fix 3)", async () => {
    const clients = makeClients(
      [sc("longhorn", "driver.longhorn.io"), sc("generic", "rancher.io/local-path")],
      [],
    );
    const opts = await discoverStorageTargets(clients, makeDb([]));
    expect(opts.find((o) => o.id === "default")?.isDefault).toBe(true);
    expect(opts.find((o) => o.id === "sc:longhorn")?.isDefault).toBe(false);
    expect(opts.filter((o) => o.isDefault)).toHaveLength(1);
  });

  it("skips control-plane nodes (by label AND by NoSchedule taint)", async () => {
    const clients = makeClients(
      [],
      [
        node("cp", { controlPlane: true }),
        node("cp-taint", { taintControlPlane: true }),
        node("worker-1"),
        node("worker-2"),
      ],
    );
    const opts = await discoverStorageTargets(clients, makeDb([]));
    const nodeIds = opts.filter((o) => o.id.startsWith("node:")).map((o) => o.id);
    expect(nodeIds).toEqual(["node:worker-1", "node:worker-2"]);
    const w1 = opts.find((o) => o.id === "node:worker-1");
    expect(w1?.kind).toBe("local-path");
    expect(w1?.resiliencyNote.toLowerCase()).toContain("no replication");
  });

  it("merges registered rows as reg:<id> with their kind + note", async () => {
    const rows = [
      {
        id: "uuid-1",
        name: "office-nfs",
        kind: "nfs",
        config: JSON.stringify({ storageClassName: "nfs-client" }),
        resiliencyNote: "Off-cluster NFS",
        isDefault: false,
      },
    ];
    const opts = await discoverStorageTargets(makeClients([], []), makeDb(rows));
    const reg = opts.find((o) => o.id === "reg:uuid-1");
    expect(reg?.kind).toBe("nfs");
    expect(reg?.name).toBe("office-nfs");
    expect(reg?.resiliencyNote).toBe("Off-cluster NFS");
  });

  it("degrades to default + registered when a k8s list call throws (no cluster)", async () => {
    const throwingClients: StorageClients = {
      storage: {
        listStorageClass: vi.fn(async () => {
          throw new Error("no cluster");
        }),
      },
      core: {
        listNode: vi.fn(async () => {
          throw new Error("no cluster");
        }),
      },
    };
    const rows = [
      {
        id: "uuid-1",
        name: "office-nfs",
        kind: "nfs",
        config: "{}",
        resiliencyNote: null,
        isDefault: false,
      },
    ];
    const opts = await discoverStorageTargets(throwingClients, makeDb(rows));
    // No throw; default is present, no sc:/node: options, registered merged.
    expect(opts.some((o) => o.id === "default")).toBe(true);
    expect(opts.some((o) => o.id.startsWith("sc:"))).toBe(false);
    expect(opts.some((o) => o.id.startsWith("node:"))).toBe(false);
    expect(opts.some((o) => o.id === "reg:uuid-1")).toBe(true);
  });
});

// --- resolveStorageTarget ---------------------------------------------------

describe("resolveStorageTarget", () => {
  it("null / 'default' → the cluster default target", async () => {
    const a = await resolveStorageTarget(null);
    const b = await resolveStorageTarget("default");
    expect(a.id).toBeNull();
    expect(a.kind).toBe("storage-class");
    expect(b.id).toBeNull();
  });

  it("sc:<name> → storage-class, storageClassName set (longhorn → replicated)", async () => {
    const clients = makeClients([sc("longhorn", "driver.longhorn.io")], []);
    const t = await resolveStorageTarget("sc:longhorn", "10Gi", clients);
    expect(t.kind).toBe("storage-class");
    expect(t.storageClassName).toBe("longhorn");
    expect(t.resiliencyNote.toLowerCase()).toContain("replicated");
    expect(t.configSnapshot).toMatchObject({
      kind: "storage-class",
      storageClassName: "longhorn",
    });
  });

  it("sc:<name> → cloud-csi when the provisioner is a cloud CSI driver", async () => {
    const clients = makeClients([sc("ebs", "ebs.csi.aws.com")], []);
    const t = await resolveStorageTarget("sc:ebs", "10Gi", clients);
    expect(t.kind).toBe("cloud-csi");
    expect(t.storageClassName).toBe("ebs");
  });

  it("node:<host> → local-path pinned to the node", async () => {
    const t = await resolveStorageTarget("node:worker-3", "10Gi");
    expect(t.kind).toBe("local-path");
    expect(t.storageClassName).toBe("local-path");
    expect(t.nodeHostname).toBe("worker-3");
    expect(t.resiliencyNote.toLowerCase()).toContain("no replication");
    // round-trips through the PVC template as a selected-node annotation.
    const pvc = toVolumeClaimTemplate(t);
    expect(pvc.metadata?.annotations?.["volume.kubernetes.io/selected-node"]).toBe(
      "worker-3",
    );
  });

  it("reg:<uuid> → uses the row's dynamic NFS StorageClass from config", async () => {
    const rows = [
      {
        id: "uuid-1",
        name: "office-nfs",
        kind: "nfs",
        config: JSON.stringify({ storageClassName: "nfs-client", server: "10.0.0.1" }),
        resiliencyNote: "Off-cluster NFS",
        isDefault: false,
      },
    ];
    const t = await resolveStorageTarget("reg:uuid-1", "10Gi", undefined, makeDb(rows));
    expect(t.kind).toBe("nfs");
    expect(t.storageClassName).toBe("nfs-client");
    expect(t.configSnapshot).toMatchObject({
      kind: "nfs",
      storageClassName: "nfs-client",
      server: "10.0.0.1",
    });
  });

  it("reg:<uuid> → a stray kind/size in config does NOT override the row (Fix 1)", async () => {
    const rows = [
      {
        id: "uuid-1",
        name: "office-nfs",
        kind: "nfs",
        // Hostile config: tries to masquerade as local-path with a tiny size.
        config: JSON.stringify({
          kind: "local-path",
          size: "1Mi",
          storageClassName: "nfs-client",
        }),
        resiliencyNote: "Off-cluster NFS",
        isDefault: false,
      },
    ];
    const t = await resolveStorageTarget("reg:uuid-1", "10Gi", undefined, makeDb(rows));
    // Row's authoritative kind + the resolved size win over the config keys.
    expect(t.kind).toBe("nfs");
    expect(t.size).toBe("10Gi");
    expect(t.configSnapshot).toMatchObject({
      kind: "nfs",
      size: "10Gi",
      storageClassName: "nfs-client",
    });
    // The round-trip via resolvedFromSnapshot keeps the authoritative kind.
    expect(resolvedFromSnapshot(t.configSnapshot).kind).toBe("nfs");
  });

  it("reg:<uuid> → NOT_FOUND when the row is missing", async () => {
    await expect(
      resolveStorageTarget("reg:missing", "10Gi", undefined, makeDb([])),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unknown id form → UNKNOWN_ID", async () => {
    await expect(resolveStorageTarget("bogus:x")).rejects.toBeInstanceOf(
      StorageTargetResolutionError,
    );
    await expect(resolveStorageTarget("bogus:x")).rejects.toMatchObject({
      code: "UNKNOWN_ID",
    });
  });
});

// --- resolvedFromSnapshot ---------------------------------------------------

describe("resolvedFromSnapshot", () => {
  it("round-trips a local-path snapshot back to a ResolvedStorageTarget", () => {
    const snapshot = {
      kind: "local-path",
      storageClassName: "local-path",
      nodeHostname: "worker-1",
      size: "10Gi",
    };
    const t = resolvedFromSnapshot(snapshot);
    expect(t.kind).toBe("local-path");
    expect(t.storageClassName).toBe("local-path");
    expect(t.nodeHostname).toBe("worker-1");
    expect(t.size).toBe("10Gi");
    // The PVC template rebuilt from it pins the node.
    const pvc = toVolumeClaimTemplate(t);
    expect(pvc.metadata?.annotations?.["volume.kubernetes.io/selected-node"]).toBe(
      "worker-1",
    );
  });

  it("round-trips a storage-class snapshot (cloud-csi kind preserved)", () => {
    const t = resolvedFromSnapshot({
      kind: "cloud-csi",
      storageClassName: "ebs",
      size: "20Gi",
    });
    expect(t.kind).toBe("cloud-csi");
    expect(t.storageClassName).toBe("ebs");
    expect(t.size).toBe("20Gi");
  });

  it("throws MALFORMED_SNAPSHOT on an invalid kind", () => {
    expect(() => resolvedFromSnapshot({ kind: "weird", size: "10Gi" })).toThrow(
      StorageTargetResolutionError,
    );
  });
});
