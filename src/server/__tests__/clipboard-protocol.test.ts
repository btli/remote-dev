// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { ClipboardBroker } from "../clipboard-broker";
import {
  attemptRemoteClipboardWrite,
  handleClientClipboardWrite,
  type ClipboardConnectionState,
} from "../clipboard-protocol";

function connection(
  overrides: Partial<ClipboardConnectionState> = {},
): ClipboardConnectionState {
  return {
    connectionId: "primary",
    sessionId: "session-a",
    clipboardSubscribed: true,
    isVisible: true,
    isSocketOpen: true,
    ...overrides,
  };
}

describe("client clipboard writes", () => {
  it("accepts only a subscribed, visible current primary", () => {
    const broker = new ClipboardBroker();
    const primary = connection();

    expect(
      handleClientClipboardWrite(broker, primary, "primary", {
        data: "from-browser",
        updateId: "browser-1",
      }),
    ).toEqual({ accepted: true, revision: 1 });
    expect(broker.read("session-a")?.data).toBe("from-browser");
  });

  it.each([
    ["not_subscribed", { clipboardSubscribed: false }, "primary"],
    ["not_visible", { isVisible: false }, "primary"],
    ["not_primary", {}, "other-connection"],
    ["socket_closed", { isSocketOpen: false }, "primary"],
  ] as const)("rejects %s without changing the broker", (reason, overrides, primaryId) => {
    const broker = new ClipboardBroker();
    broker.write("session-a", "before");

    expect(
      handleClientClipboardWrite(broker, connection(overrides), primaryId, {
        data: "must-not-store",
        updateId: "browser-2",
      }),
    ).toEqual({ accepted: false, reason });
    expect(broker.read("session-a")?.data).toBe("before");
  });

  it("rejects malformed messages without changing the broker", () => {
    const broker = new ClipboardBroker();

    expect(
      handleClientClipboardWrite(broker, connection(), "primary", {
        data: "text",
        updateId: "",
      }),
    ).toEqual({ accepted: false, reason: "invalid_message" });
    expect(broker.read("session-a")).toBeNull();
  });

  it("rejects an oversized updateId without changing the broker", () => {
    const broker = new ClipboardBroker();
    broker.write("session-a", "before");

    expect(
      handleClientClipboardWrite(broker, connection(), "primary", {
        data: "must-not-store",
        updateId: "x".repeat(129),
      }),
    ).toEqual({ accepted: false, reason: "invalid_message" });
    expect(broker.read("session-a")?.data).toBe("before");
  });
});

describe("remote clipboard writes", () => {
  it("stores once and delivers only to an eligible primary connection", () => {
    const broker = new ClipboardBroker();
    const send = vi.fn();

    expect(
      attemptRemoteClipboardWrite(broker, "session-a", "from-host", {
        connection: connection(),
        send,
      }),
    ).toEqual({ revision: 1, delivered: true });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "clipboard_update",
      data: "from-host",
      revision: 1,
    });
    expect(broker.read("session-a")?.data).toBe("from-host");
  });

  it.each([
    ["no primary", undefined],
    ["hidden", connection({ isVisible: false })],
    ["unsubscribed", connection({ clipboardSubscribed: false })],
    ["closed", connection({ isSocketOpen: false })],
  ] as const)("stores but does not deliver when the primary is %s", (_label, primary) => {
    const broker = new ClipboardBroker();
    const send = vi.fn();

    expect(
      attemptRemoteClipboardWrite(
        broker,
        "session-a",
        "still-stored",
        primary ? { connection: primary, send } : undefined,
      ),
    ).toEqual({ revision: 1, delivered: false });
    expect(send).not.toHaveBeenCalled();
    expect(broker.read("session-a")?.data).toBe("still-stored");
  });

  it("reports delivery failure without exposing or discarding clipboard data", () => {
    const broker = new ClipboardBroker();
    const send = vi.fn(() => {
      throw new Error("socket disappeared");
    });

    expect(
      attemptRemoteClipboardWrite(broker, "session-a", "private text", {
        connection: connection(),
        send,
      }),
    ).toEqual({ revision: 1, delivered: false });
    expect(broker.read("session-a")?.data).toBe("private text");
  });
});
