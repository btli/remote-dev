import { describe, it, expect, afterEach } from "vitest";
import {
  resolveDefaultStorageTarget,
  toVolumeClaimTemplate,
  DATA_VOLUME_NAME,
} from "@/lib/storage";

const ENV_KEYS = [
  "SUPERVISOR_DEFAULT_STORAGE_CLASS",
  "SUPERVISOR_DEFAULT_STORAGE_SIZE",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

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
