import { describe, expect, it } from "vitest";

import {
  agentExitDeliveryId,
  agentStatusDeliveryId,
  agentStatusNotification,
  authorizeAgentCallback,
  classifyExitDelivery,
  parseAgentDeliveryId,
  parseAgentGeneration,
  shouldBroadcastExitDelivery,
} from "../agent-callback";

describe("agent callback boundary", () => {
  it("parses only non-negative integer generations", () => {
    expect(parseAgentGeneration("0")).toBe(0);
    expect(parseAgentGeneration("12")).toBe(12);
    expect(parseAgentGeneration("-1")).toBeNull();
    expect(parseAgentGeneration("1.5")).toBeNull();
    expect(parseAgentGeneration(undefined)).toBeNull();
  });

  it("binds a validated API key to both the owner and exact session", () => {
    const input = {
      sessionId: "s1",
      sessionUserId: "u1",
      validatedKey: { userId: "u1", name: "agent-session-s1" },
    };
    expect(authorizeAgentCallback(input)).toBe(true);
    expect(authorizeAgentCallback({ ...input, validatedKey: { userId: "u2", name: "agent-session-s1" } })).toBe(false);
    expect(authorizeAgentCallback({ ...input, validatedKey: { userId: "u1", name: "agent-session-s2" } })).toBe(false);
    expect(authorizeAgentCallback({ ...input, validatedKey: null })).toBe(false);
  });

  it("accepts only bounded URL-safe delivery identities", () => {
    expect(parseAgentDeliveryId("delivery_1.2-3")).toBe("delivery_1.2-3");
    expect(parseAgentDeliveryId("has space")).toBeNull();
    expect(parseAgentDeliveryId("x".repeat(97))).toBeNull();
    expect(parseAgentDeliveryId(undefined)).toBeNull();
  });

  it("applies one active-generation exit, retries its notification, and ignores stale/intentional exits", () => {
    expect(classifyExitDelivery({ currentGeneration: 3, suppliedGeneration: 3, exitState: "running" })).toBe("apply");
    expect(classifyExitDelivery({ currentGeneration: 3, suppliedGeneration: 3, exitState: "exited" })).toBe("retry");
    expect(classifyExitDelivery({ currentGeneration: 3, suppliedGeneration: 2, exitState: "running" })).toBe("ignore");
    expect(classifyExitDelivery({ currentGeneration: 3, suppliedGeneration: 3, exitState: "restarting" })).toBe("apply");
    expect(classifyExitDelivery({ currentGeneration: 3, suppliedGeneration: 3, exitState: "closed" })).toBe("ignore");
    expect(classifyExitDelivery({
      currentGeneration: 3,
      suppliedGeneration: 3,
      exitState: "exited",
      exitCode: null,
      activityStatus: "idle",
    })).toBe("enrich");
    expect(shouldBroadcastExitDelivery("apply")).toBe(true);
    expect(shouldBroadcastExitDelivery("enrich")).toBe(true);
    expect(shouldBroadcastExitDelivery("retry")).toBe(true);
    expect(shouldBroadcastExitDelivery("ignore")).toBe(false);
  });

  it("creates a passive durable completion record only for a Codex clean Stop", () => {
    expect(agentStatusNotification("idle", "codex")).toEqual({
      type: "agent_complete",
      severity: "passive",
      title: "Agent turn completed",
      bodySuffix: "completed its turn",
      result: "success",
    });
    expect(agentStatusNotification("idle", "claude")).toBeNull();
    expect(agentStatusNotification("waiting", "claude")?.type).toBe("agent_waiting");
    expect(agentStatusNotification("error", "claude")?.type).toBe("agent_error");
    expect(agentStatusNotification("running", "codex")).toBeNull();
  });

  it("derives a stable attention delivery id per hook invocation", () => {
    expect(agentStatusDeliveryId("s1", 4, "d1", "waiting")).toBe(
      agentStatusDeliveryId("s1", 4, "d1", "waiting"),
    );
    expect(agentStatusDeliveryId("s1", 4, "d1", "waiting")).not.toBe(
      agentStatusDeliveryId("s1", 4, "d2", "waiting"),
    );
    expect(agentStatusDeliveryId("s1", 4, "d1", "waiting")).toBe(
      agentStatusDeliveryId("s1", 4, "d1", "running"),
    );
  });

  it("derives a stable delivery id per session generation", () => {
    expect(agentExitDeliveryId("s1", 4)).toBe(agentExitDeliveryId("s1", 4));
    expect(agentExitDeliveryId("s1", 4)).not.toBe(agentExitDeliveryId("s1", 5));
    expect(agentExitDeliveryId("s1", 4)).not.toBe(agentExitDeliveryId("s2", 4));
  });
});
