/**
 * Tests for TerminalTypeClientRegistry — client-side plugin registration.
 * Mirrors the server registry tests; focuses on the extra display-name/icon
 * validation the client registry requires.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TerminalTypeClientRegistry, ClientPluginRegistryError } from "./client";
import type { TerminalTypeClientPlugin } from "@/types/terminal-type-client";
import { Terminal as TerminalIcon } from "lucide-react";

function StubComponent() {
  return null;
}

function makePlugin(
  overrides: Partial<TerminalTypeClientPlugin> = {}
): TerminalTypeClientPlugin {
  return {
    type: "test-type",
    displayName: "Test",
    description: "A test plugin",
    icon: TerminalIcon,
    component: StubComponent,
    ...overrides,
  };
}

describe("TerminalTypeClientRegistry", () => {
  beforeEach(() => {
    TerminalTypeClientRegistry.clear();
  });

  it("registers a plugin and retrieves it", () => {
    const plugin = makePlugin({ type: "fake" });
    TerminalTypeClientRegistry.register(plugin);
    expect(TerminalTypeClientRegistry.get("fake")).toBe(plugin);
  });

  it("throws when registering the same type twice", () => {
    TerminalTypeClientRegistry.register(makePlugin({ type: "dup" }));
    expect(() =>
      TerminalTypeClientRegistry.register(makePlugin({ type: "dup" }))
    ).toThrow(ClientPluginRegistryError);
  });

  it("getRequired throws with a clear message when missing", () => {
    expect(() => TerminalTypeClientRegistry.getRequired("missing")).toThrow(
      /No client plugin registered for type "missing"/
    );
  });

  it("getOrDefault returns the fallback when the requested type is unknown", () => {
    const shell = makePlugin({ type: "shell" });
    TerminalTypeClientRegistry.register(shell);
    expect(TerminalTypeClientRegistry.getOrDefault("unknown")).toBe(shell);
  });

  it("unregister removes a non-built-in plugin", () => {
    TerminalTypeClientRegistry.register(makePlugin({ type: "x" }));
    TerminalTypeClientRegistry.unregister("x");
    expect(TerminalTypeClientRegistry.has("x")).toBe(false);
  });

  it("unregister refuses built-in plugins", () => {
    TerminalTypeClientRegistry.register(makePlugin({ type: "core" }), {
      builtIn: true,
    });
    expect(() => TerminalTypeClientRegistry.unregister("core")).toThrow(
      /Cannot unregister built-in/
    );
  });

  it("list returns every registered type", () => {
    TerminalTypeClientRegistry.register(makePlugin({ type: "a" }));
    TerminalTypeClientRegistry.register(makePlugin({ type: "b" }));
    expect(TerminalTypeClientRegistry.list().sort()).toEqual(["a", "b"]);
  });

  it("rejects plugins missing required fields", () => {
    // No icon
    expect(() =>
      TerminalTypeClientRegistry.register({
        type: "bad",
        displayName: "Bad",
        description: "no icon",
        component: StubComponent,
      } as unknown as TerminalTypeClientPlugin)
    ).toThrow(/must have an icon/);

    // No component
    expect(() =>
      TerminalTypeClientRegistry.register({
        type: "bad2",
        displayName: "Bad",
        description: "no component",
        icon: TerminalIcon,
      } as unknown as TerminalTypeClientPlugin)
    ).toThrow(/must provide a component/);
  });
});
