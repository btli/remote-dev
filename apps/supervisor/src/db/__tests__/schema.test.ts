import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";

/**
 * Smoke test: the schema module imports cleanly and exposes the Phase-1 tables
 * (and NOT the Phase-3 machine tables). Guards against accidental breakage of
 * the Drizzle table definitions during refactors.
 */
describe("supervisor schema", () => {
  it("exports the Phase-1 tables", () => {
    expect(schema.supervisorUser).toBeDefined();
    expect(schema.instance).toBeDefined();
    expect(schema.registeredStorageTarget).toBeDefined();
    expect(schema.instanceAuditLog).toBeDefined();
    expect(schema.instanceSeed).toBeDefined();
  });

  it("does NOT define Phase-3 machine tables yet", () => {
    expect((schema as Record<string, unknown>).machine).toBeUndefined();
    expect((schema as Record<string, unknown>).capacityEvent).toBeUndefined();
  });

  it("instance table carries the owner-scoping + namespace columns", () => {
    // Drizzle exposes columns on the table object; assert the load-bearing ones.
    const cols = schema.instance as unknown as Record<string, unknown>;
    expect(cols.ownerId).toBeDefined();
    expect(cols.namespace).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.status).toBeDefined();
  });
});
