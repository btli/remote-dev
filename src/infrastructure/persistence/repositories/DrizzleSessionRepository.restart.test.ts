// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sqliteSchema from "@/db/schema.sqlite";
import * as pgSchema from "@/db/schema.pg";

const capture = vi.hoisted(() => ({
  set: null as Record<string, unknown> | null,
  inArrayValues: [] as unknown[][],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (column: unknown, values: unknown[]) => {
      capture.inArrayValues.push(values);
      return actual.inArray(column as never, values as never[]);
    },
  };
});

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (value: Record<string, unknown>) => {
        capture.set = value;
        return {
          where: () => ({ returning: async () => [] }),
        };
      },
    }),
  },
}));

describe("DrizzleSessionRepository restart generation markers", () => {
  beforeEach(() => {
    capture.set = null;
    capture.inArrayValues = [];
  });

  it("clears the prior generation delivery marker when claiming a restart", async () => {
    const { DrizzleSessionRepository } = await import("./DrizzleSessionRepository");
    const repository = new DrizzleSessionRepository();

    await repository.claimAgentRestart("session-1", "user-1", 4);

    expect(capture.set).toMatchObject({
      agentExitState: "restarting",
      agentRestartCount: 5,
      agentExitNotificationAt: null,
    });
    // The generated dialect surfaces both carry the nullable marker used by
    // this shared repository update.
    expect(sqliteSchema.terminalSessions.agentExitNotificationAt).toBeDefined();
    expect(pgSchema.terminalSessions.agentExitNotificationAt).toBeDefined();
  });

  it("allows both agent and loop sessions to claim a restart", async () => {
    const { DrizzleSessionRepository } = await import("./DrizzleSessionRepository");
    const repository = new DrizzleSessionRepository();

    await repository.claimAgentRestart("session-1", "user-1", 4);

    expect(capture.inArrayValues).toContainEqual(["agent", "loop"]);
  });
});
