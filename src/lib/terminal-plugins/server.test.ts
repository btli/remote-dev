// @vitest-environment node
/**
 * Tests for TerminalTypeServerRegistry — plugin registration lifecycle.
 *
 * Covers register/get/getRequired/getOrDefault/list/has/unregister plus the
 * isolation contract: server.ts must not transitively import React (verified
 * by the fact that this suite runs in the `node` vitest environment — if the
 * server bundle dragged in React, the import would throw).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TerminalTypeServerRegistry,
  ServerPluginRegistryError,
} from "./server";
import type { TerminalTypeServerPlugin } from "@/types/terminal-type-server";

function makePlugin(
  overrides: Partial<TerminalTypeServerPlugin> = {}
): TerminalTypeServerPlugin {
  return {
    type: "test-type",
    priority: 0,
    createSession: () => ({
      shellCommand: null,
      shellArgs: [],
      environment: {},
      useTmux: false,
    }),
    ...overrides,
  };
}

describe("TerminalTypeServerRegistry", () => {
  beforeEach(() => {
    TerminalTypeServerRegistry.clear();
  });

  describe("register + get", () => {
    it("registers a plugin and retrieves it by type", () => {
      const plugin = makePlugin({ type: "fake" });
      TerminalTypeServerRegistry.register(plugin);
      expect(TerminalTypeServerRegistry.get("fake")).toBe(plugin);
    });

    it("throws when registering the same type twice without override", () => {
      const a = makePlugin({ type: "dup" });
      const b = makePlugin({ type: "dup" });
      TerminalTypeServerRegistry.register(a);
      expect(() => TerminalTypeServerRegistry.register(b)).toThrow(
        ServerPluginRegistryError
      );
      expect(TerminalTypeServerRegistry.get("dup")).toBe(a);
    });

    it("replaces existing plugin when override: true", () => {
      const a = makePlugin({ type: "dup" });
      const b = makePlugin({ type: "dup" });
      TerminalTypeServerRegistry.register(a);
      TerminalTypeServerRegistry.register(b, { override: true });
      expect(TerminalTypeServerRegistry.get("dup")).toBe(b);
    });

    it("rejects plugins missing createSession", () => {
      const bad = {
        type: "bad",
        // createSession intentionally missing
      } as unknown as TerminalTypeServerPlugin;
      expect(() => TerminalTypeServerRegistry.register(bad)).toThrow(
        ServerPluginRegistryError
      );
    });
  });

  describe("getRequired", () => {
    it("returns the plugin when registered", () => {
      const plugin = makePlugin({ type: "present" });
      TerminalTypeServerRegistry.register(plugin);
      expect(TerminalTypeServerRegistry.getRequired("present")).toBe(plugin);
    });

    it("throws with a clear message when missing", () => {
      expect(() => TerminalTypeServerRegistry.getRequired("missing")).toThrow(
        /No server plugin registered for type "missing"/
      );
    });
  });

  describe("getOrDefault", () => {
    it("returns the requested plugin when registered", () => {
      const shell = makePlugin({ type: "shell" });
      const other = makePlugin({ type: "other" });
      TerminalTypeServerRegistry.register(shell);
      TerminalTypeServerRegistry.register(other);
      expect(TerminalTypeServerRegistry.getOrDefault("other")).toBe(other);
    });

    it("falls back to the default plugin for unknown types", () => {
      const shell = makePlugin({ type: "shell" });
      TerminalTypeServerRegistry.register(shell);
      // Default is "shell" after clear()
      expect(TerminalTypeServerRegistry.getOrDefault("unknown-type")).toBe(
        shell
      );
    });

    it("throws when no default is registered and type is missing", () => {
      expect(() => TerminalTypeServerRegistry.getOrDefault("nope")).toThrow(
        ServerPluginRegistryError
      );
    });
  });

  describe("has + list", () => {
    it("reports registered types via has", () => {
      TerminalTypeServerRegistry.register(makePlugin({ type: "a" }));
      expect(TerminalTypeServerRegistry.has("a")).toBe(true);
      expect(TerminalTypeServerRegistry.has("b")).toBe(false);
    });

    it("lists every registered type", () => {
      TerminalTypeServerRegistry.register(makePlugin({ type: "a" }));
      TerminalTypeServerRegistry.register(makePlugin({ type: "b" }));
      const types = TerminalTypeServerRegistry.list().sort();
      expect(types).toEqual(["a", "b"]);
    });
  });

  describe("unregister", () => {
    it("removes a non-built-in plugin", () => {
      TerminalTypeServerRegistry.register(makePlugin({ type: "x" }));
      TerminalTypeServerRegistry.unregister("x");
      expect(TerminalTypeServerRegistry.has("x")).toBe(false);
    });

    it("throws when unregistering a missing type", () => {
      expect(() => TerminalTypeServerRegistry.unregister("ghost")).toThrow(
        ServerPluginRegistryError
      );
    });

    it("refuses to unregister built-in plugins", () => {
      TerminalTypeServerRegistry.register(makePlugin({ type: "core" }), {
        builtIn: true,
      });
      expect(() => TerminalTypeServerRegistry.unregister("core")).toThrow(
        /Cannot unregister built-in/
      );
      expect(TerminalTypeServerRegistry.has("core")).toBe(true);
    });
  });
});
