import { describe, expect, it, vi } from "vitest";

import {
  MAX_CLIPBOARD_TEXT_BYTES,
  LOCAL_CLIPBOARD_DEDUPE_MS,
  readBrowserClipboard,
  TerminalClipboardSync,
  writeBrowserClipboard,
} from "./terminal-clipboard-sync";

function makeSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
  };
}

function sentMessages(socket: ReturnType<typeof makeSocket>) {
  return socket.send.mock.calls.map(([frame]) => JSON.parse(frame as string));
}

describe("TerminalClipboardSync", () => {
  it("waits for authoritative primary before subscribing on each socket", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    const first = makeSocket();

    sync.openSocket(first);
    expect(sentMessages(first)).toEqual([]);

    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    expect(sentMessages(first)).toEqual([]);

    sync.setPrimary(true, first);
    expect(sentMessages(first).at(-1)).toEqual({
      type: "clipboard_subscribe",
      enabled: true,
    });

    sync.closeSocket(first);
    const second = makeSocket();
    sync.openSocket(second);
    expect(sentMessages(second)).toEqual([]);

    sync.setPrimary(true, second);
    expect(sentMessages(second)).toEqual([
      { type: "clipboard_subscribe", enabled: true },
    ]);
  });

  it("subscribes before flushing only the latest pre-primary clipboard text", () => {
    const ids = ["promoted"];
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => ids.shift() ?? "unused",
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);

    expect(sync.canReadLocalClipboard()).toBe(false);
    expect(sync.writeLocalText("older")).toBe(true);
    expect(sync.writeLocalText("latest")).toBe(true);
    expect(sentMessages(socket)).toEqual([]);

    sync.setPrimary(true, socket);

    expect(sentMessages(socket)).toEqual([
      { type: "clipboard_subscribe", enabled: true },
      {
        type: "clipboard_write",
        data: "latest",
        updateId: "promoted",
      },
    ]);
  });

  it("retains the latest text until a subscription send succeeds", () => {
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => "after-subscribe",
    });
    const socket = makeSocket();
    socket.send.mockImplementationOnce(() => {
      throw new Error("transient send failure");
    });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);

    sync.setPrimary(true, socket);
    expect(sync.writeLocalText("latest after failed subscribe")).toBe(true);
    expect(
      socket.send.mock.calls.map(([frame]) => JSON.parse(frame as string).type),
    ).toEqual(["clipboard_subscribe"]);

    sync.setPrimary(false, socket);
    sync.setPrimary(true, socket);
    expect(
      socket.send.mock.calls.map(([frame]) => JSON.parse(frame as string)),
    ).toEqual([
      { type: "clipboard_subscribe", enabled: true },
      { type: "clipboard_subscribe", enabled: true },
      {
        type: "clipboard_write",
        data: "latest after failed subscribe",
        updateId: "after-subscribe",
      },
    ]);
  });

  it("ignores stale updates from a superseded socket without poisoning revision", async () => {
    const applyRemote = vi.fn();
    const sync = new TerminalClipboardSync({ applyRemote });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const stale = makeSocket();
    sync.openSocket(stale);
    sync.setPrimary(true, stale);

    const current = makeSocket();
    sync.openSocket(current);
    sync.setPrimary(true, current);
    await sync.receive(
      { type: "clipboard_update", data: "stale", revision: 99 },
      stale,
    );
    await sync.receive(
      { type: "clipboard_update", data: "current", revision: 1 },
      current,
    );

    expect(applyRemote).toHaveBeenCalledTimes(1);
    expect(applyRemote).toHaveBeenCalledWith("current", 1);
  });

  it("invalidates eligibility leases on primary, presentation, enablement, socket, and session loss", () => {
    const onEligibilityInvalidated = vi.fn();
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      onEligibilityInvalidated,
    });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const socket = makeSocket();
    sync.openSocket(socket);
    sync.setPrimary(true, socket);
    onEligibilityInvalidated.mockClear();

    const primaryLease = sync.createEligibilityToken();
    expect(primaryLease).not.toBeNull();
    sync.setPrimary(false, socket);
    expect(sync.isEligibilityTokenCurrent(primaryLease)).toBe(false);

    sync.setPrimary(true, socket);
    const focusLease = sync.createEligibilityToken();
    sync.setPresented({ focused: false });
    expect(sync.isEligibilityTokenCurrent(focusLease)).toBe(false);

    sync.setPresented({ focused: true });
    const coverLease = sync.createEligibilityToken();
    sync.setPresented({ visible: false });
    expect(sync.isEligibilityTokenCurrent(coverLease)).toBe(false);

    sync.setPresented({ visible: true });
    const enabledLease = sync.createEligibilityToken();
    sync.setEnabled(false);
    expect(sync.isEligibilityTokenCurrent(enabledLease)).toBe(false);

    sync.setEnabled(true);
    const sessionLease = sync.createEligibilityToken();
    sync.resetSession();
    expect(sync.isEligibilityTokenCurrent(sessionLease)).toBe(false);

    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPrimary(true, replacement);
    const socketLease = sync.createEligibilityToken();
    sync.closeSocket();
    expect(sync.isEligibilityTokenCurrent(socketLease)).toBe(false);
    expect(onEligibilityInvalidated).toHaveBeenCalledTimes(7);
  });

  it("subscribes only while the terminal is active, visible, and page-visible", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    const socket = makeSocket();
    sync.openSocket(socket);
    sync.setPrimary(true, socket);
    sync.setEnabled(true);

    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "clipboard_subscribe",
      enabled: true,
    });

    sync.setPresented({ pageVisible: false });
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "clipboard_subscribe",
      enabled: false,
    });
  });

  it("unsubscribes while the browser window is blurred", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    sync.setPresented({ focused: false });

    expect(sync.canSync()).toBe(false);
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "clipboard_subscribe",
      enabled: false,
    });
  });

  it("writes local clipboard text with a generated update id and drops duplicates", () => {
    const ids = ["local-1", "local-2"];
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => ids.shift() ?? "unused",
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    expect(sync.writeLocalText("hello")).toBe(true);
    expect(sync.writeLocalText("hello")).toBe(false);
    expect(sync.writeLocalText("world")).toBe(true);

    expect(sentMessages(socket).slice(1)).toEqual([
      { type: "clipboard_write", data: "hello", updateId: "local-1" },
      { type: "clipboard_write", data: "world", updateId: "local-2" },
    ]);
  });

  it("flushes the latest eligible native clipboard write after the first socket opens", () => {
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => "queued-1",
    });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);

    expect(sync.writeLocalText("before open")).toBe(true);
    const socket = makeSocket();
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    expect(sentMessages(socket)).toEqual([
      { type: "clipboard_subscribe", enabled: true },
      {
        type: "clipboard_write",
        data: "before open",
        updateId: "queued-1",
      },
    ]);
  });

  it("queues the latest clipboard write while reconnecting", () => {
    const ids = ["first", "reconnect"];
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => ids.shift() ?? "unused",
    });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const first = makeSocket();
    sync.openSocket(first);
    sync.setPrimary(true, first);
    sync.writeLocalText("online");
    sync.closeSocket(first);

    expect(sync.writeLocalText("during reconnect")).toBe(true);
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPrimary(true, replacement);

    expect(sentMessages(replacement)).toEqual([
      { type: "clipboard_subscribe", enabled: true },
      {
        type: "clipboard_write",
        data: "during reconnect",
        updateId: "reconnect",
      },
    ]);
  });

  it("re-seeds a replacement broker with the last known local clipboard", () => {
    const ids = ["initial", "reseed"];
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => ids.shift() ?? "unused",
    });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const first = makeSocket();
    sync.openSocket(first);
    sync.setPrimary(true, first);
    sync.writeLocalText("survives server restart");

    sync.closeSocket(first);
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPrimary(true, replacement);

    expect(sentMessages(replacement)).toEqual([
      { type: "clipboard_subscribe", enabled: true },
      {
        type: "clipboard_write",
        data: "survives server restart",
        updateId: "reseed",
      },
    ]);
  });

  it("clears remembered clipboard text when the terminal is covered", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const first = makeSocket();
    sync.openSocket(first);
    sync.setPrimary(true, first);
    expect(sync.writeLocalText("do not flush later")).toBe(true);

    sync.setPresented({ visible: false });
    sync.closeSocket(first);
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPresented({ visible: true });
    sync.setPrimary(true, replacement);

    expect(sentMessages(replacement).filter((frame) => frame.type === "clipboard_write"))
      .toEqual([]);
  });

  it("clears remembered clipboard text when sync is disabled", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const first = makeSocket();
    sync.openSocket(first);
    sync.setPrimary(true, first);
    sync.writeLocalText("do not flush later");

    sync.setEnabled(false);
    sync.closeSocket(first);
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setEnabled(true);
    sync.setPrimary(true, replacement);

    expect(sentMessages(replacement).filter((frame) => frame.type === "clipboard_write"))
      .toEqual([]);
  });

  it("clears remembered clipboard text when the terminal session resets", () => {
    const sync = new TerminalClipboardSync({ applyRemote: vi.fn() });
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    const first = makeSocket();
    sync.openSocket(first);
    sync.setPrimary(true, first);
    sync.writeLocalText("belongs only to the old session");

    sync.resetSession();
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPrimary(true, replacement);

    expect(sentMessages(replacement).filter((frame) => frame.type === "clipboard_write"))
      .toEqual([]);
  });

  it("applies monotonic remote updates and suppresses exact local and remote echoes", async () => {
    const applyRemote = vi.fn().mockResolvedValue(undefined);
    const sync = new TerminalClipboardSync({
      applyRemote,
      createUpdateId: () => "local-1",
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);
    sync.writeLocalText("from-browser");

    await sync.receive(
      {
        type: "clipboard_update",
        data: "from-browser",
        revision: 1,
      },
      socket,
    );
    await sync.receive(
      {
        type: "clipboard_update",
        data: "from-host",
        revision: 2,
      },
      socket,
    );
    await sync.receive(
      {
        type: "clipboard_update",
        data: "from-host",
        revision: 2,
      },
      socket,
    );

    expect(applyRemote).toHaveBeenCalledTimes(1);
    expect(applyRemote).toHaveBeenCalledWith("from-host", 2);
    expect(sync.writeLocalText("from-host")).toBe(false);
  });

  it("accepts a lower revision after reconnecting to a new server epoch", async () => {
    const applyRemote = vi.fn().mockResolvedValue(undefined);
    const sync = new TerminalClipboardSync({ applyRemote });
    const first = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(first);
    sync.setPrimary(true, first);
    await sync.receive(
      {
        type: "clipboard_update",
        data: "before restart",
        revision: 10,
      },
      first,
    );

    sync.closeSocket(first);
    const replacement = makeSocket();
    sync.openSocket(replacement);
    sync.setPrimary(true, replacement);
    await sync.receive(
      {
        type: "clipboard_update",
        data: "after restart",
        revision: 1,
      },
      replacement,
    );

    expect(applyRemote).toHaveBeenNthCalledWith(1, "before restart", 10);
    expect(applyRemote).toHaveBeenNthCalledWith(2, "after restart", 1);
  });

  it("allows a later local change back to an older remote value", async () => {
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => crypto.randomUUID(),
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    await sync.receive(
      {
        type: "clipboard_update",
        data: "value-a",
        revision: 1,
      },
      socket,
    );
    expect(sync.writeLocalText("value-b")).toBe(true);
    expect(sync.writeLocalText("value-a")).toBe(true);
  });

  it("re-publishes unchanged local text after the short event-dedupe window", () => {
    let now = 1_000;
    let id = 0;
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      createUpdateId: () => `local-${++id}`,
      now: () => now,
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    expect(sync.writeLocalText("unchanged")).toBe(true);
    expect(sync.writeLocalText("unchanged")).toBe(false);
    now += LOCAL_CLIPBOARD_DEDUPE_MS + 1;
    expect(sync.writeLocalText("unchanged")).toBe(true);
  });

  it("suppresses only the immediate local echo of a remote write", async () => {
    let now = 1_000;
    const sync = new TerminalClipboardSync({
      applyRemote: vi.fn(),
      now: () => now,
    });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);
    await sync.receive(
      {
        type: "clipboard_update",
        data: "remote value",
        revision: 1,
      },
      socket,
    );

    expect(sync.writeLocalText("remote value")).toBe(false);
    now += LOCAL_CLIPBOARD_DEDUPE_MS + 1;
    expect(sync.writeLocalText("remote value")).toBe(true);
  });

  it("applies remote A again after an intervening local B", async () => {
    const applyRemote = vi.fn();
    const sync = new TerminalClipboardSync({ applyRemote });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);

    await sync.receive(
      { type: "clipboard_update", data: "A", revision: 1 },
      socket,
    );
    sync.writeLocalText("B");
    await sync.receive(
      { type: "clipboard_update", data: "A", revision: 2 },
      socket,
    );

    expect(applyRemote).toHaveBeenNthCalledWith(1, "A", 1);
    expect(applyRemote).toHaveBeenNthCalledWith(2, "A", 2);
  });

  it("rejects clipboard text larger than 1 MiB in either direction", async () => {
    const applyRemote = vi.fn();
    const sync = new TerminalClipboardSync({ applyRemote });
    const socket = makeSocket();
    sync.setPresented({ active: true, visible: true, pageVisible: true, focused: true });
    sync.setEnabled(true);
    sync.openSocket(socket);
    sync.setPrimary(true, socket);
    const tooLarge = "x".repeat(MAX_CLIPBOARD_TEXT_BYTES + 1);

    expect(sync.writeLocalText(tooLarge)).toBe(false);
    await sync.receive(
      {
        type: "clipboard_update",
        data: tooLarge,
        revision: 1,
      },
      socket,
    );

    expect(applyRemote).not.toHaveBeenCalled();
    expect(sentMessages(socket)).toHaveLength(1);
  });
});

describe("writeBrowserClipboard", () => {
  it("offers a gesture retry when automatic clipboard permission is blocked", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const onBlocked = vi.fn();

    await writeBrowserClipboard("remote text", {
      clipboard: { writeText },
      onBlocked,
    });

    expect(onBlocked).toHaveBeenCalledTimes(1);
    const retry = onBlocked.mock.calls[0][1] as () => Promise<void>;
    await retry();
    expect(writeText).toHaveBeenNthCalledWith(2, "remote text");
  });

  it("silently ignores denied local clipboard reads", async () => {
    const onText = vi.fn();
    const result = await readBrowserClipboard(
      {
        readText: vi.fn().mockRejectedValue(
          new DOMException("Denied", "NotAllowedError"),
        ),
      },
      onText,
    );

    expect(result).toBe(false);
    expect(onText).not.toHaveBeenCalled();
  });

  it("copies through an ephemeral selection fallback when the Clipboard API is absent", async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const onBlocked = vi.fn();

    try {
      await writeBrowserClipboard("fallback text", {
        clipboard: null,
        onBlocked,
      });
      expect(onBlocked).toHaveBeenCalledTimes(1);

      const retry = onBlocked.mock.calls[0][1] as () => Promise<void>;
      await retry();

      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(document.querySelector("[data-rdv-clipboard-fallback]"))
        .toBeNull();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, "execCommand", originalExecCommand);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (document as any).execCommand;
      }
    }
  });
});
