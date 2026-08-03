// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { startTerminalAfterSchemaReady } from "../terminal-startup-gate";

describe("terminal startup schema gate", () => {
  it("does not expose callbacks while a delayed migration is still pending", async () => {
    let release!: () => void;
    const migration = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listen = vi.fn();

    const startup = startTerminalAfterSchemaReady(() => migration, listen);
    await Promise.resolve();
    expect(listen).not.toHaveBeenCalled();

    release();
    await startup;
    expect(listen).toHaveBeenCalledOnce();
  });

  it("fails closed when schema readiness cannot be established", async () => {
    const listen = vi.fn();
    await expect(
      startTerminalAfterSchemaReady(
        async () => { throw new Error("migration timeout"); },
        listen,
      ),
    ).rejects.toThrow("migration timeout");
    expect(listen).not.toHaveBeenCalled();
  });
});
