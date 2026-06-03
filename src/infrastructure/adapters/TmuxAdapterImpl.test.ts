import { describe, it, expect, beforeEach, vi } from "vitest";
import { TmuxAdapterImpl } from "./TmuxAdapterImpl";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";

describe("TmuxAdapterImpl", () => {
  let gateway: {
    sessionExists: ReturnType<typeof vi.fn>;
    getEnvironment: ReturnType<typeof vi.fn>;
  };
  let adapter: TmuxAdapterImpl;

  beforeEach(() => {
    gateway = {
      sessionExists: vi.fn(),
      getEnvironment: vi.fn(),
    };
    adapter = new TmuxAdapterImpl(gateway as unknown as TmuxGateway);
  });

  describe("sessionExists", () => {
    it("delegates to the gateway and returns true", async () => {
      gateway.sessionExists.mockResolvedValue(true);

      const result = await adapter.sessionExists("rdv-abc");

      expect(gateway.sessionExists).toHaveBeenCalledWith("rdv-abc");
      expect(result).toBe(true);
    });

    it("returns false when the gateway reports no session", async () => {
      gateway.sessionExists.mockResolvedValue(false);

      const result = await adapter.sessionExists("rdv-missing");

      expect(result).toBe(false);
    });
  });

  describe("getEnvironment", () => {
    it("flattens the TmuxEnvironment to a plain record via toRecord()", async () => {
      const env = TmuxEnvironment.create({ PORT: "3000", HOST: "localhost" });
      const toRecordSpy = vi.spyOn(env, "toRecord");
      gateway.getEnvironment.mockResolvedValue(env);

      const result = await adapter.getEnvironment("rdv-abc");

      expect(gateway.getEnvironment).toHaveBeenCalledWith("rdv-abc");
      expect(toRecordSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ PORT: "3000", HOST: "localhost" });
    });

    it("returns an empty record for an empty environment", async () => {
      gateway.getEnvironment.mockResolvedValue(TmuxEnvironment.empty());

      const result = await adapter.getEnvironment("rdv-abc");

      expect(result).toEqual({});
    });
  });
});
