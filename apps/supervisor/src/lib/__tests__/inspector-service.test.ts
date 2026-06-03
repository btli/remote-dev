import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listVolume,
  readFile,
  safeRelativePath,
  InspectorTimeoutError,
  InspectorPathError,
  InspectorError,
  type InspectorDeps,
  type K8sClients,
} from "@/lib/inspector-service";

/**
 * Inspector-service unit tests — mocked k8s clients + mocked pod log; NO cluster.
 * The injected {@link InspectorDeps} make `sleep` a no-op and drive a fake clock
 * so the poll loop and the timeout/pending budgets are exercised instantly.
 */

// readProvisionEnv() (imported by the service from the reconciler) requires the
// instance image/host env. Set them before the module under test reads them.
beforeEach(() => {
  process.env.SUPERVISOR_INSTANCE_IMAGE = "ghcr.io/btli/remote-dev@sha256:abc";
  process.env.SUPERVISOR_INSTANCE_HOST = "dev.example.com";
});

/** Instantly-advancing fake clock + no-op sleep for the poll loop. */
function fakeDeps(stepMs = 1_000): InspectorDeps {
  let t = 0;
  return {
    sleep: vi.fn(async () => {
      t += stepMs;
    }),
    now: vi.fn(() => t),
  };
}

/** Build a spying client set whose Job completes with the given log line. */
function makeClients(opts: {
  /** The single JSON line the inspector pod "logged". */
  log?: string;
  /** Pod phase progression returned by listNamespacedPod (defaults to Succeeded). */
  podPhase?: string;
  /** Job status progression (defaults to succeeded:1). */
  jobStatus?: { succeeded?: number; failed?: number };
  /** The instance pod (rdv-0) read result — Running pins a node. */
  instancePod?: { phase?: string; nodeName?: string };
}): { clients: K8sClients; deleted: string[] } {
  const deleted: string[] = [];
  const clients = {
    core: {
      readNamespacedPod: vi.fn(async ({ name }: { name: string }) => {
        if (name === "rdv-0") {
          return {
            status: { phase: opts.instancePod?.phase ?? "Running" },
            spec: { nodeName: opts.instancePod?.nodeName },
          };
        }
        return {};
      }),
      listNamespacedPod: vi.fn(async () => ({
        items: [{ metadata: { name: "rdv-inspect-pod" }, status: { phase: opts.podPhase ?? "Succeeded" } }],
      })),
      readNamespacedPodLog: vi.fn(async () => opts.log ?? '{"ok":true,"path":"","entries":[],"truncated":false}'),
    },
    batch: {
      createNamespacedJob: vi.fn(async () => ({})),
      readNamespacedJob: vi.fn(async () => ({
        status: opts.jobStatus ?? { succeeded: 1 },
      })),
      deleteNamespacedJob: vi.fn(async ({ name }: { name: string }) => {
        deleted.push(name);
        return {};
      }),
    },
    apps: {},
  } as unknown as K8sClients;
  return { clients, deleted };
}

describe("safeRelativePath", () => {
  it("normalizes leading slashes + '.' segments to a clean relative path", () => {
    expect(safeRelativePath("/")).toBe("");
    expect(safeRelativePath("")).toBe("");
    expect(safeRelativePath("/a/./b/")).toBe("a/b");
    expect(safeRelativePath("a//b")).toBe("a/b");
  });

  it("rejects '..' traversal", () => {
    expect(() => safeRelativePath("../etc")).toThrow(InspectorPathError);
    expect(() => safeRelativePath("a/../../b")).toThrow(InspectorPathError);
  });

  it("rejects a null byte", () => {
    expect(() => safeRelativePath("a\0b")).toThrow(InspectorPathError);
  });
});

describe("listVolume", () => {
  it("parses a known JSON listing line + deletes the Job (cleanup)", async () => {
    const line = JSON.stringify({
      ok: true,
      path: "sub",
      entries: [
        { name: "dir1", type: "dir", size: 0, mtimeMs: 1 },
        { name: "file1", type: "file", size: 42, mtimeMs: 2 },
        { name: "sock", type: "other", size: 0, mtimeMs: 3 },
      ],
      truncated: false,
    });
    const { clients, deleted } = makeClients({ log: line });
    const listing = await listVolume("alpha", "/sub", clients, fakeDeps());
    expect(listing.path).toBe("sub");
    expect(listing.entries).toHaveLength(3);
    expect(listing.entries[0]).toEqual({ name: "dir1", type: "dir", size: 0, mtimeMs: 1 });
    expect(listing.entries[1]).toEqual({ name: "file1", type: "file", size: 42, mtimeMs: 2 });
    expect(listing.truncated).toBe(false);
    // The Job was created and then deleted (self-cleaning).
    expect(clients.batch.createNamespacedJob).toHaveBeenCalledOnce();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/^rdv-inspect-/);
  });

  it("surfaces truncated=true from the pod", async () => {
    const line = JSON.stringify({ ok: true, path: "", entries: [], truncated: true });
    const { clients } = makeClients({ log: line });
    const listing = await listVolume("alpha", "/", clients, fakeDeps());
    expect(listing.truncated).toBe(true);
  });

  it("handles ok:false (e.g. missing path) by throwing InspectorError", async () => {
    const { clients, deleted } = makeClients({
      log: JSON.stringify({ ok: false, error: "ENOENT: no such file" }),
    });
    await expect(listVolume("alpha", "/missing", clients, fakeDeps())).rejects.toBeInstanceOf(
      InspectorError,
    );
    // Even on a logical error, the Job is cleaned up.
    expect(deleted).toHaveLength(1);
  });

  it("rejects '..' BEFORE dispatching any Job", async () => {
    const { clients } = makeClients({});
    await expect(listVolume("alpha", "../escape", clients, fakeDeps())).rejects.toBeInstanceOf(
      InspectorPathError,
    );
    expect(clients.batch.createNamespacedJob).not.toHaveBeenCalled();
  });

  it("times out (InspectorTimeoutError) when the Job never completes, and still cleans up", async () => {
    // Job/pod stay non-terminal forever (Running pod, no succeeded/failed).
    const { clients, deleted } = makeClients({
      podPhase: "Running",
      jobStatus: { succeeded: 0, failed: 0 },
    });
    await expect(
      listVolume("alpha", "/", clients, fakeDeps(10_000)),
    ).rejects.toBeInstanceOf(InspectorTimeoutError);
    expect(deleted).toHaveLength(1);
  });

  it("omits nodeName when the instance pod is not Running (stopped)", async () => {
    const { clients } = makeClients({
      instancePod: { phase: "Pending" },
    });
    await listVolume("alpha", "/", clients, fakeDeps());
    const body = (clients.batch.createNamespacedJob as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .body;
    expect(body.spec.template.spec.nodeName).toBeUndefined();
  });

  it("pins nodeName when the instance pod is Running (RWO share)", async () => {
    const { clients } = makeClients({
      instancePod: { phase: "Running", nodeName: "node-9" },
    });
    await listVolume("alpha", "/", clients, fakeDeps());
    const body = (clients.batch.createNamespacedJob as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .body;
    expect(body.spec.template.spec.nodeName).toBe("node-9");
  });
});

describe("readFile", () => {
  it("parses base64 content into a Buffer + metadata", async () => {
    const payload = Buffer.from("hello world").toString("base64");
    const { clients } = makeClients({
      log: JSON.stringify({ ok: true, path: "a.txt", size: 11, base64: payload }),
    });
    const file = await readFile("alpha", "/a.txt", clients, fakeDeps());
    expect(file.path).toBe("a.txt");
    expect(file.size).toBe(11);
    expect(file.content.toString("utf8")).toBe("hello world");
  });

  it("too-large → InspectorError carrying the 'file too large' message", async () => {
    const { clients } = makeClients({
      log: JSON.stringify({ ok: false, error: "file too large (9999999 bytes); use a terminal" }),
    });
    const err = await readFile("alpha", "/big.bin", clients, fakeDeps()).catch((e) => e);
    expect(err).toBeInstanceOf(InspectorError);
    expect(String(err.message)).toContain("too large");
  });
});
