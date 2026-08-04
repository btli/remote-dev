// @vitest-environment node

import { describe, expect, it } from "vitest";
import { withAgentExitDeliveryLock } from "../agent-exit-delivery-lock";

describe("agent exit delivery lock", () => {
  it("serializes callback and repair work for the same generation", async () => {
    const order: string[] = [];
    let reportEntered!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => { reportEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const callback = withAgentExitDeliveryLock("session-1", 4, async () => {
      order.push("callback-state");
      reportEntered();
      await gate;
      order.push("callback-notification");
    });
    await entered;
    const repair = withAgentExitDeliveryLock("session-1", 4, async () => {
      order.push("repair");
    });
    await Promise.resolve();

    expect(order).toEqual(["callback-state"]);
    releaseFirst();
    await Promise.all([callback, repair]);
    expect(order).toEqual(["callback-state", "callback-notification", "repair"]);
  });

  it("releases the generation lock when the protected operation throws", async () => {
    await expect(withAgentExitDeliveryLock("session-2", 8, async () => {
      throw new Error("delivery failed");
    })).rejects.toThrow("delivery failed");

    await expect(withAgentExitDeliveryLock("session-2", 8, async () => "repaired"))
      .resolves.toBe("repaired");
  });
});
