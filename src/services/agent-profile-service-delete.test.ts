import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Capture every db.update(table) call and the payload handed to .set(), so we
// can assert deleteProfile nulls the profile pin on the automation tables.
// (Those columns are no longer DB-level FKs with ON DELETE SET NULL — see
// schema.def.ts — so the set-null is enforced in the app and must be tested.)
const updateCalls: Array<{ table: unknown; setPayload: unknown }> = [];

vi.mock("@/db", () => ({
  db: {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((setPayload: unknown) => {
        updateCalls.push({ table, setPayload });
        return { where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    })),
  },
}));

import { db } from "@/db";
import {
  agentRuns,
  agentSchedules,
  projectProfileLinks,
  terminalSessions,
  triggerConfigs,
} from "@/db/schema";
import { deleteProfile } from "./agent-profile-service";

describe("agent-profile-service deleteProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
  });

  it("nulls the profile pin on sessions and all automation tables", async () => {
    const result = await deleteProfile("profile-123", "user-456");

    // delete() returned rowsAffected: 1
    expect(result).toBe(true);

    const updatedTables = updateCalls.map((c) => c.table);
    // Sessions + the three automation tables get a set-null update.
    expect(updatedTables).toContain(terminalSessions);
    expect(updatedTables).toContain(agentSchedules);
    expect(updatedTables).toContain(triggerConfigs);
    expect(updatedTables).toContain(agentRuns);
    // It must NOT touch project_profile_link (that's profile cascade /
    // pool-delete territory, not profile-delete).
    expect(updatedTables).not.toContain(projectProfileLinks);

    // Every automation/session update sets profileId to null.
    for (const table of [
      terminalSessions,
      agentSchedules,
      triggerConfigs,
      agentRuns,
    ]) {
      const call = updateCalls.find((c) => c.table === table);
      expect(call?.setPayload).toMatchObject({ profileId: null });
    }

    // The profile row itself is deleted.
    expect(db.delete as Mock).toHaveBeenCalledTimes(1);
  });
});
