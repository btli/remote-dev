/**
 * Tests for the rdv-bridge module — the JS surface the native Flutter
 * shell drives via window.rdvBridge, and the helper that emits events
 * back to native via window.flutter_inappwebview.callHandler.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RDV_BRIDGE_VERSION,
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
} from "../rdv-bridge";

function makeAdapter(overrides: Partial<RdvBridgeAdapter> = {}): RdvBridgeAdapter {
  return {
    input: vi.fn(),
    key: vi.fn(),
    paste: vi.fn(),
    setFontSize: vi.fn(),
    scrollToBottom: vi.fn(),
    back: vi.fn(),
    ...overrides,
  };
}

describe("rdv-bridge", () => {
  afterEach(() => {
    delete window.rdvBridge;
    delete window.flutter_inappwebview;
  });

  describe("installRdvBridge", () => {
    it("installs window.rdvBridge with the current version", () => {
      installRdvBridge(makeAdapter());

      expect(window.rdvBridge).toBeDefined();
      expect(window.rdvBridge?.version).toBe(RDV_BRIDGE_VERSION);
    });

    it("forwards input() calls to the adapter", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.input("hello");

      expect(adapter.input).toHaveBeenCalledWith("hello");
    });

    it("forwards key() calls to the adapter with modifiers", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.key("Tab", { ctrl: true });

      expect(adapter.key).toHaveBeenCalledWith("Tab", { ctrl: true });
    });

    it("forwards setFontSize, scrollToBottom, paste, back to the adapter", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.setFontSize(14);
      window.rdvBridge?.scrollToBottom();
      window.rdvBridge?.paste("clip");
      window.rdvBridge?.back();

      expect(adapter.setFontSize).toHaveBeenCalledWith(14);
      expect(adapter.scrollToBottom).toHaveBeenCalledTimes(1);
      expect(adapter.paste).toHaveBeenCalledWith("clip");
      expect(adapter.back).toHaveBeenCalledTimes(1);
    });

    it("returns an uninstall function that removes the bridge", () => {
      const uninstall = installRdvBridge(makeAdapter());

      expect(window.rdvBridge).toBeDefined();
      uninstall();
      expect(window.rdvBridge).toBeUndefined();
    });

    it("re-installing replaces the previous adapter", () => {
      const first = makeAdapter();
      const second = makeAdapter();

      installRdvBridge(first);
      installRdvBridge(second);

      window.rdvBridge?.input("x");

      expect(first.input).not.toHaveBeenCalled();
      expect(second.input).toHaveBeenCalledWith("x");
    });
  });

  describe("notifyToNative", () => {
    it("calls window.flutter_inappwebview.callHandler when present", async () => {
      const callHandler = vi.fn().mockResolvedValue(undefined);
      window.flutter_inappwebview = { callHandler };

      await notifyToNative("onTerminalReady", {});

      expect(callHandler).toHaveBeenCalledWith("onTerminalReady", {});
    });

    it("is a no-op when window.flutter_inappwebview is absent", async () => {
      // No window.flutter_inappwebview installed — should not throw.
      await expect(
        notifyToNative("onActivity", { state: "running" })
      ).resolves.toBeUndefined();
    });

    it("forwards typed payloads", async () => {
      const callHandler = vi.fn().mockResolvedValue(undefined);
      window.flutter_inappwebview = { callHandler };

      await notifyToNative("onSelectionChange", { text: "selected" });
      await notifyToNative("onLinkOpen", { url: "https://example.com" });

      expect(callHandler).toHaveBeenNthCalledWith(1, "onSelectionChange", {
        text: "selected",
      });
      expect(callHandler).toHaveBeenNthCalledWith(2, "onLinkOpen", {
        url: "https://example.com",
      });
    });
  });
});
