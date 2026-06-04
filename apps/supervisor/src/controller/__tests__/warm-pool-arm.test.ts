import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Convergence cases for the reconciler's warm-pool arm (epic remote-dev-oyej.8).
 * The warm-pool lib is mocked so we assert the arm's orchestration (prewarm →
 * promote → gc) + that it's a no-op when SUPERVISOR_WARM_POOL_SIZE is unset/0.
 */
const prewarm = vi.fn(async () => 0);
const promoteReady = vi.fn(async () => 0);
const gcExpired = vi.fn(async () => 0);
vi.mock("@/lib/warm-pool", () => ({ prewarm, promoteReady, gcExpired }));

// reconciler.ts pulls in @kubernetes via k8s helpers at import; that resolves in
// the supervisor app. We only call reconcileWarmPool (no clients needed).
import { reconcileWarmPool } from "@/controller/reconciler";

const ORIGINAL = process.env.SUPERVISOR_WARM_POOL_SIZE;
function setSize(v: string | undefined) {
  (process.env as Record<string, string | undefined>).SUPERVISOR_WARM_POOL_SIZE = v;
}

beforeEach(() => {
  prewarm.mockClear();
  promoteReady.mockClear();
  gcExpired.mockClear();
});
afterEach(() => setSize(ORIGINAL));

describe("reconcileWarmPool", () => {
  it("is a no-op when SUPERVISOR_WARM_POOL_SIZE is unset", async () => {
    setSize(undefined);
    await reconcileWarmPool();
    expect(prewarm).not.toHaveBeenCalled();
    expect(promoteReady).not.toHaveBeenCalled();
    expect(gcExpired).not.toHaveBeenCalled();
  });

  it("is a no-op when size is 0", async () => {
    setSize("0");
    await reconcileWarmPool();
    expect(prewarm).not.toHaveBeenCalled();
  });

  it("prewarms, promotes, and GCs when size > 0", async () => {
    setSize("3");
    await reconcileWarmPool();
    expect(prewarm).toHaveBeenCalledWith(3);
    expect(promoteReady).toHaveBeenCalledOnce();
    expect(gcExpired).toHaveBeenCalledOnce();
  });

  it("isolates a prewarm failure (still promotes + GCs)", async () => {
    setSize("2");
    prewarm.mockRejectedValueOnce(new Error("create failed"));
    await reconcileWarmPool();
    expect(promoteReady).toHaveBeenCalledOnce();
    expect(gcExpired).toHaveBeenCalledOnce();
  });
});
