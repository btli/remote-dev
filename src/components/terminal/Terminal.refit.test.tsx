/**
 * Regression test for remote-dev-u5q5.2:
 *
 * Inside a Flutter platform WebView, app background→resume and route
 * pop-back produce no page-level resize / visibilitychange / visualViewport
 * events, so Terminal.tsx's in-page resize pipeline never runs and the
 * xterm.js grid goes stale until the user pinch-zooms. The native shell
 * therefore calls the imperative `refit()` (exposed on TerminalRef → wired
 * to the rdv-bridge) on those lifecycle edges.
 *
 * `refit()` mirrors the visibilitychange handler's intent (re-assert focus
 * so the server re-elects this client as primary, settle + fit + ws-resize,
 * scroll the viewport to the bottom) but deliberately omits
 * `terminal.focus()` — on mobile the terminal runs with xterm's textarea
 * disabled and the native shell owns the keyboard, so focusing here would
 * steal the keyboard context.
 *
 * These tests assert that calling `ref.refit()` issues a real reconciler
 * request and resize frame, scrolls to the bottom, forces a fresh
 * `client_focus` frame even while the derived state is blurred, suppresses that
 * assertion while the panel/page is hidden, and remains a safe no-op before
 * the terminal has finished initializing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import {
  createRef,
  startTransition,
  StrictMode,
  Suspense,
  useLayoutEffect,
  useState,
} from "react";

import type { TerminalRef } from "./Terminal";
import { CLIPBOARD_SYNC_STORAGE_KEY } from "@/hooks/useClipboardSyncPreference";

const toastSpies = vi.hoisted(() => ({
  show: vi.fn(),
  dismiss: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastSpies.show, {
    dismiss: toastSpies.dismiss,
    error: toastSpies.error,
  }),
}));

const reconcilerState = vi.hoisted(() => ({
  instances: [] as Array<{
    wasDisposed: boolean;
    callsAfterDispose: number;
    requests: string[];
  }>,
}));

vi.mock("./resize-reconciler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./resize-reconciler")>();
  class TrackingResizeReconciler extends actual.ResizeReconciler {
    wasDisposed = false;
    callsAfterDispose = 0;
    requests: string[] = [];

    constructor(
      ...args: ConstructorParameters<typeof actual.ResizeReconciler>
    ) {
      super(...args);
      reconcilerState.instances.push(this);
    }

    request(reason: Parameters<typeof actual.ResizeReconciler.prototype.request>[0]) {
      if (this.wasDisposed) this.callsAfterDispose++;
      this.requests.push(reason);
      return super.request(reason);
    }

    dispose() {
      this.wasDisposed = true;
      super.dispose();
    }
  }
  return { ...actual, ResizeReconciler: TrackingResizeReconciler };
});

// Capture every XTerm instance so we can assert against its methods + textarea.
const xtermInstances: Array<{
  scrollToBottom: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  textarea: HTMLTextAreaElement;
}> = [];
const fitAddonInstances: Array<{
  fit: ReturnType<typeof vi.fn>;
}> = [];

// ── Recording WebSocket mock ──────────────────────────────────────────────
// The focus-frame assertion needs an OPEN socket that records sent frames.
// Terminal.tsx only sends a focus signal when ws.readyState === OPEN, so a
// plain 401 (no socket) wouldn't exercise the dedupe path. This minimal mock
// opens synchronously-ish (onopen fired on a microtask) and captures every
// JSON frame the component sends.
const wsInstances: MockWebSocket[] = [];
let blurBeforeSocketOpen = false;
let documentHasFocus = true;
let autoOpenSockets = true;
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  closeCalls = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    wsInstances.push(this);
    // Fire onopen on a microtask so the component's onopen handler runs.
    queueMicrotask(() => {
      if (!autoOpenSockets || this.readyState !== MockWebSocket.CONNECTING) return;
      if (blurBeforeSocketOpen) documentHasFocus = false;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closeCalls++;
    this.readyState = 3;
    setTimeout(() => this.onclose?.(), 0);
  }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  /** Parsed frame `type`s in send order. */
  sentTypes(): string[] {
    return this.sent.map((s) => {
      try {
        return JSON.parse(s).type as string;
      } catch {
        return "";
      }
    });
  }
}

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    textarea: HTMLTextAreaElement;
    scrollToBottom = vi.fn();
    buffer = {
      active: { type: "normal" as const, viewportY: 0, baseY: 0 },
      onBufferChange: () => ({ dispose: () => {} }),
    };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.textarea = document.createElement("textarea");
      xtermInstances.push(this);
    }
    loadAddon(addon: { activate?: (terminal: FakeTerminal) => void }) {
      addon.activate?.(this);
    }
    registerLinkProvider() {
      return { dispose: () => {} };
    }
    open(container: HTMLElement) {
      container.appendChild(this.textarea);
    }
    onData() {
      return { dispose: () => {} };
    }
    onScroll() {
      return { dispose: () => {} };
    }
    onLineFeed() {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler() {}
    focus = vi.fn();
    write() {}
    writeln() {}
    dispose = vi.fn();
    clear() {}
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    private terminal: { cols: number; rows: number } | null = null;
    fit = vi.fn(() => {
      if (!this.terminal) return;
      this.terminal.cols = 100;
      this.terminal.rows = 30;
    });
    constructor() {
      fitAddonInstances.push(this);
    }
    activate(terminal: { cols: number; rows: number }) {
      this.terminal = terminal;
    }
    proposeDimensions() {
      return { cols: 100, rows: 30 };
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate() {}
    dispose() {}
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// WebGL is optional; make it fail fast so init doesn't await a real import.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      throw new Error("no webgl in test");
    }
  },
}));

vi.mock("@/contexts/AppearanceContext", () => ({
  useTerminalTheme: () => ({
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#444444",
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    brightBlack: "#444444",
    brightRed: "#ff4444",
    brightGreen: "#44ff44",
    brightYellow: "#ffff44",
    brightBlue: "#4444ff",
    brightMagenta: "#ff44ff",
    brightCyan: "#44ffff",
    brightWhite: "#ffffff",
    cursorStyle: "block" as const,
    opacity: 100,
    blur: 0,
  }),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ recordActivity: () => {}, notify: () => {} }),
}));

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
let rectSpy: ReturnType<typeof vi.spyOn>;
let hasFocusSpy: ReturnType<typeof vi.spyOn>;
let originalLocalStorageDescriptor: PropertyDescriptor | undefined;
let originalClipboardDescriptor: PropertyDescriptor | undefined;
let localStorageValues: Map<string, string>;
let clipboardReadText: ReturnType<typeof vi.fn>;
let clipboardWriteText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // Token endpoint succeeds so connect() proceeds to open a WebSocket; any
  // other URL resolves benignly. The focus-frame test needs a live socket.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/token")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "test-token" }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "localStorage",
  );
  localStorageValues = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => localStorageValues.get(key) ?? null,
      setItem: (key: string, value: string) =>
        localStorageValues.set(key, value),
    },
  });
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  clipboardReadText = vi.fn().mockResolvedValue("");
  clipboardWriteText = vi.fn().mockResolvedValue(undefined);
  toastSpies.show.mockReset();
  toastSpies.dismiss.mockReset();
  toastSpies.error.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: clipboardReadText,
      writeText: clipboardWriteText,
    },
  });
  blurBeforeSocketOpen = false;
  documentHasFocus = true;
  autoOpenSockets = true;
  hasFocusSpy = vi
    .spyOn(document, "hasFocus")
    .mockImplementation(() => documentHasFocus);
  rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      width: 800,
      height: 480,
      toJSON: () => ({}),
    });
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: () => Promise.resolve([]), ready: Promise.resolve() },
    });
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(
      window,
      "localStorage",
      originalLocalStorageDescriptor,
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).localStorage;
  }
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      navigator,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  }
  hasFocusSpy.mockRestore();
  rectSpy.mockRestore();
  xtermInstances.length = 0;
  fitAddonInstances.length = 0;
  reconcilerState.instances.length = 0;
  wsInstances.length = 0;
  cleanup();
});

async function getTerminal() {
  const mod = await import("./Terminal");
  return mod.Terminal;
}

function dispatchSocketMessage(
  socket: MockWebSocket,
  message: Record<string, unknown>,
) {
  socket.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(message) }),
  );
}

function dispatchPaste(target: EventTarget, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text, items: [] },
  });
  target.dispatchEvent(event);
}

describe("Terminal.refit (remote-dev-u5q5.2)", () => {
  it.each([
    { name: "disabled", enabled: false, isActive: true, visible: true },
    { name: "inactive", enabled: true, isActive: false, visible: true },
    { name: "hidden", enabled: true, isActive: true, visible: false },
  ])(
    "never reads the browser clipboard while sync is $name",
    async ({ enabled, isActive, visible }) => {
      if (enabled) {
        localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
      }
      const Terminal = await getTerminal();
      render(
        <Terminal
          sessionId="clipboard-guard"
          tmuxSessionName="rdv-clipboard-guard"
          wsUrl="ws://localhost:0"
          terminalType="shell"
          isActive={isActive}
          visible={visible}
        />,
      );

      await waitFor(() => expect(wsInstances.at(-1)).toBeDefined());
      act(() => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(clipboardReadText).not.toHaveBeenCalled();
    },
  );

  it("waits for xterm focus and authoritative primary before reading or subscribing", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    clipboardReadText.mockResolvedValue("focused clipboard");
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="clipboard-focus"
        tmuxSessionName="rdv-clipboard-focus"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    expect(clipboardReadText).not.toHaveBeenCalled();
    expect(
      socket.sent
        .map((frame) => JSON.parse(frame))
        .filter((frame) => frame.type.startsWith("clipboard_")),
    ).toEqual([]);

    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
    });
    expect(clipboardReadText).not.toHaveBeenCalled();
    expect(
      socket.sent
        .map((frame) => JSON.parse(frame))
        .filter((frame) => frame.type.startsWith("clipboard_")),
    ).toEqual([]);

    act(() => {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "primary_changed", isPrimary: true }),
        }),
      );
    });
    await waitFor(() => {
      expect(clipboardReadText).toHaveBeenCalledTimes(1);
      expect(
        socket.sent.map((frame) => JSON.parse(frame)).map((frame) => frame.type),
      ).toContain("clipboard_write");
    });

    const clipboardFrames = socket.sent
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.type.startsWith("clipboard_"));
    expect(clipboardFrames[0]).toEqual({
      type: "clipboard_subscribe",
      enabled: true,
    });
    expect(clipboardFrames[1]).toEqual({
      type: "clipboard_write",
      data: "focused clipboard",
      updateId: expect.any(String),
    });
  });

  it("does not sync paste from terminal search or unrelated dialog inputs", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    clipboardReadText.mockResolvedValue("initial seed");
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();
    render(
      <Terminal
        ref={ref}
        sessionId="clipboard-scope"
        tmuxSessionName="rdv-clipboard-scope"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
    });
    await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

    act(() => ref.current?.openSearch());
    const searchInput = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Search terminal output"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogInput = document.createElement("input");
    dialog.appendChild(dialogInput);
    document.body.appendChild(dialog);

    clipboardReadText.mockClear();
    socket.sent.length = 0;
    act(() => {
      dispatchPaste(searchInput, "search only");
      dispatchPaste(dialogInput, "dialog only");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(clipboardReadText).not.toHaveBeenCalled();
    expect(
      socket.sent
        .map((frame) => JSON.parse(frame))
        .filter((frame) => frame.type === "clipboard_write"),
    ).toEqual([]);
    dialog.remove();
  });

  it("does not apply a remote browser clipboard update after the terminal is covered", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="clipboard-covered"
        tmuxSessionName="rdv-clipboard-covered"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "visible update",
        revision: 1,
      });
    });
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("visible update");
    });

    view.rerender(
      <Terminal
        sessionId="clipboard-covered"
        tmuxSessionName="rdv-clipboard-covered"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible={false}
      />,
    );
    const writesBeforeCoveredUpdate = clipboardWriteText.mock.calls.length;
    act(() => {
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "covered update",
        revision: 2,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(clipboardWriteText).toHaveBeenCalledTimes(writesBeforeCoveredUpdate);
  });

  it("coalesces blocked remote updates and keeps the newest toast action valid", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    clipboardWriteText.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="clipboard-fallback"
        tmuxSessionName="rdv-clipboard-fallback"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "older remote",
        revision: 1,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "newest remote",
        revision: 2,
      });
    });
    await waitFor(() => expect(toastSpies.show).toHaveBeenCalledTimes(1));

    const xterm = xtermInstances.at(-1)!;
    xterm.focus.mockImplementation(() => xterm.textarea.focus());
    const priorFallbackButton = document.createElement("button");
    priorFallbackButton.setAttribute(
      "data-rdv-clipboard-fallback-action",
      "",
    );
    document.body.appendChild(priorFallbackButton);
    act(() => priorFallbackButton.focus());
    act(() => {
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "newest again",
        revision: 3,
      });
    });
    await waitFor(() => expect(toastSpies.show).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(xterm.textarea);
    priorFallbackButton.remove();

    const firstOptions = toastSpies.show.mock.calls[0][1] as {
      id: string;
    };
    const newestOptions = toastSpies.show.mock.calls[1][1] as {
      id: string;
      action: { onClick: (event: unknown) => void };
    };
    expect(newestOptions.id).toBe(firstOptions.id);

    const fallbackButton = document.createElement("button");
    fallbackButton.setAttribute("data-rdv-clipboard-fallback-action", "");
    document.body.appendChild(fallbackButton);
    xterm.focus.mockClear();
    act(() => {
      fallbackButton.focus();
    });
    clipboardWriteText.mockResolvedValueOnce(undefined);
    act(() => newestOptions.action.onClick({}));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith("newest again");
      expect(xterm.focus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(xterm.textarea);
    });
    fallbackButton.remove();
  });

  it("does not let a late older clipboard rejection replace the newest fallback", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    const rejectWrite = new Map<string, (reason?: unknown) => void>();
    clipboardWriteText.mockImplementation(
      (text: string) =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite.set(text, reject);
        }),
    );
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="clipboard-fallback-order"
        tmuxSessionName="rdv-clipboard-fallback-order"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "remote A",
        revision: 1,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "remote B",
        revision: 2,
      });
    });
    await waitFor(() => {
      expect(rejectWrite.has("remote A")).toBe(true);
      expect(rejectWrite.has("remote B")).toBe(true);
    });

    act(() => {
      rejectWrite.get("remote B")?.(
        new DOMException("Denied", "NotAllowedError"),
      );
    });
    await waitFor(() => expect(toastSpies.show).toHaveBeenCalledTimes(1));
    const newestOptions = toastSpies.show.mock.calls[0][1] as {
      action: { onClick: (event: unknown) => void };
    };

    act(() => {
      rejectWrite.get("remote A")?.(
        new DOMException("Denied", "NotAllowedError"),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastSpies.show).toHaveBeenCalledTimes(1);

    clipboardWriteText.mockResolvedValueOnce(undefined);
    act(() => newestOptions.action.onClick({}));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith("remote B");
    });
  });

  it("revokes clipboard eligibility when a focused fallback dismisses without action", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    clipboardWriteText.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="clipboard-passive-dismiss"
        tmuxSessionName="rdv-clipboard-passive-dismiss"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "dismiss me",
        revision: 1,
      });
    });
    await waitFor(() => expect(toastSpies.show).toHaveBeenCalledTimes(1));
    const options = toastSpies.show.mock.calls[0][1] as {
      onDismiss: (toast: unknown) => void;
    };
    const fallbackButton = document.createElement("button");
    fallbackButton.setAttribute("data-rdv-clipboard-fallback-action", "");
    document.body.appendChild(fallbackButton);
    act(() => fallbackButton.focus());
    socket.sent.length = 0;

    act(() => options.onDismiss({}));

    expect(
      socket.sent.map((frame) => JSON.parse(frame)),
    ).toContainEqual({ type: "clipboard_subscribe", enabled: false });
    expect(document.activeElement).toBe(fallbackButton);
    fallbackButton.remove();
  });

  it("dismisses and invalidates a blocked fallback when primary is lost", async () => {
    localStorageValues.set(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    clipboardWriteText.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="clipboard-invalidated-fallback"
        tmuxSessionName="rdv-clipboard-invalidated-fallback"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const socket = wsInstances.at(-1)!;
    act(() => {
      xtermInstances.at(-1)?.textarea.focus();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
      dispatchSocketMessage(socket, {
        type: "clipboard_update",
        data: "must be released",
        revision: 1,
      });
    });
    await waitFor(() => expect(toastSpies.show).toHaveBeenCalledTimes(1));
    const options = toastSpies.show.mock.calls[0][1] as {
      id: string;
      action: { onClick: (event: unknown) => void };
    };
    const callsBeforeInvalidation = clipboardWriteText.mock.calls.length;
    const fallbackButton = document.createElement("button");
    fallbackButton.setAttribute("data-rdv-clipboard-fallback-action", "");
    document.body.appendChild(fallbackButton);
    act(() => fallbackButton.focus());

    act(() => {
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: false,
      });
    });
    expect(toastSpies.dismiss).toHaveBeenCalledWith(options.id);
    socket.sent.length = 0;

    act(() => {
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
    });
    expect(
      socket.sent
        .map((frame) => JSON.parse(frame))
        .filter(
          (frame) =>
            frame.type === "clipboard_subscribe" && frame.enabled === true,
        ),
    ).toEqual([]);

    act(() => xtermInstances.at(-1)?.textarea.focus());
    expect(
      socket.sent.map((frame) => JSON.parse(frame)),
    ).toContainEqual({ type: "clipboard_subscribe", enabled: true });

    act(() => options.action.onClick({}));
    await act(async () => {
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenCalledTimes(callsBeforeInvalidation);
    fallbackButton.remove();
  });

  it("routes native clipboard writes and remote updates without navigator.clipboard", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();
    const onClipboardUpdate = vi.fn();
    autoOpenSockets = false;
    render(
      <Terminal
        ref={ref}
        sessionId="clipboard-native"
        tmuxSessionName="rdv-clipboard-native"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        clipboardMode="native"
        isActive
        visible
        onClipboardUpdate={onClipboardUpdate}
      />,
    );

    // Flutter calls these immediately after onTerminalReady, which only
    // guarantees that the bridge mounted — the socket may still be opening.
    act(() => {
      ref.current?.setClipboardSync(true);
      ref.current?.syncClipboard("from native");
    });
    await waitFor(() => expect(wsInstances.at(-1)).toBeDefined());
    const socket = wsInstances.at(-1)!;
    act(() => {
      socket.open();
      dispatchSocketMessage(socket, {
        type: "primary_changed",
        isPrimary: true,
      });
    });
    await waitFor(() => {
      expect(socket.readyState).toBe(1);
      expect(
        socket.sent.map((frame) => JSON.parse(frame)),
      ).toEqual(
        expect.arrayContaining([
          { type: "clipboard_subscribe", enabled: true },
          {
            type: "clipboard_write",
            data: "from native",
            updateId: expect.any(String),
          },
        ]),
      );
    });

    act(() => {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "clipboard_update",
            data: "from host",
            revision: 4,
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(onClipboardUpdate).toHaveBeenCalledWith("from host", 4);
    });
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(clipboardReadText).not.toHaveBeenCalled();
  });

  it("ignores a stale old-session clipboard message after a replacement socket opens", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();
    const onClipboardUpdate = vi.fn();
    const view = render(
      <Terminal
        ref={ref}
        sessionId="clipboard-old-session"
        tmuxSessionName="rdv-clipboard-old-session"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        clipboardMode="native"
        isActive
        visible
        onClipboardUpdate={onClipboardUpdate}
      />,
    );
    act(() => ref.current?.setClipboardSync(true));
    await waitFor(() => expect(wsInstances.at(-1)?.readyState).toBe(1));
    const stale = wsInstances.at(-1)!;
    act(() => {
      dispatchSocketMessage(stale, {
        type: "primary_changed",
        isPrimary: true,
      });
    });

    view.rerender(
      <Terminal
        ref={ref}
        sessionId="clipboard-new-session"
        tmuxSessionName="rdv-clipboard-new-session"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        clipboardMode="native"
        isActive
        visible
        onClipboardUpdate={onClipboardUpdate}
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(stale);
      expect(wsInstances.at(-1)?.readyState).toBe(1);
    });
    const current = wsInstances.at(-1)!;
    act(() => {
      dispatchSocketMessage(current, {
        type: "primary_changed",
        isPrimary: true,
      });
    });
    onClipboardUpdate.mockClear();

    act(() => {
      dispatchSocketMessage(stale, {
        type: "clipboard_update",
        data: "stale secret",
        revision: 99,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onClipboardUpdate).not.toHaveBeenCalled();
  });

  it("is a safe no-op before the terminal has initialized", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    // Render but do NOT flush async init — xtermRef is still null. refit()
    // must not throw.
    render(
      <Terminal
        ref={ref}
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        fontSize={14}
        fontFamily="'TestFont', monospace"
        terminalType="shell"
      />
    );

    expect(() => ref.current?.refit()).not.toThrow();
  });

  it("scrolls the terminal to the bottom when refit() runs", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    await act(async () => {
      render(
        <Terminal
          ref={ref}
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          fontSize={14}
          fontFamily="'TestFont', monospace"
          terminalType="shell"
          isActive
        />
      );
    });

    // Let the async xterm init complete so xtermRef + the refit closures are
    // wired up. Poll for the xterm instance rather than sleeping a fixed tick:
    // under parallel vitest workers the awaited init chain (mount → token
    // fetch → addon load) can take longer than any single fixed delay, which
    // made the old `setTimeout(20)` race and intermittently assert against an
    // empty `xtermInstances`.
    await waitFor(() => {
      expect(xtermInstances.length).toBeGreaterThanOrEqual(1);
    });
    const xterm = xtermInstances[0]!;
    xterm.scrollToBottom.mockClear();

    act(() => {
      ref.current?.refit();
    });

    // refit() calls scrollToBottom directly — an unconditional, synchronous
    // proxy that the imperative path executed (the reconcile half is async and
    // is asserted separately).
    expect(xterm.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("forces a fresh client_focus frame past the dedupe (Codex Fix 1)", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    await act(async () => {
      render(
        <Terminal
          ref={ref}
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          fontSize={14}
          fontFamily="'TestFont', monospace"
          terminalType="shell"
          isActive
        />
      );
    });

    // Flush async init deterministically: xterm mounts, the token fetch
    // resolves, and the component opens its WebSocket. The init effect can
    // briefly open a throwaway socket and reconnect to a fresh one, so the
    // observable target is the *live* (OPEN) socket whose onopen has already
    // fired — `sent.length >= 1` proves the initial focus/blur frame landed,
    // which is exactly the state the dedupe assertion below depends on.
    //
    // The old `await new Promise(r => setTimeout(r, 20))` raced this: under
    // parallel vitest workers a fixed tick sometimes fired before the reconnect
    // settled, leaving `wsInstances[0]` pointing at the closed throwaway socket
    // (empty `sent`) instead of the live one — an intermittent failure that
    // passed in isolation and on re-run. Polling for the live socket removes
    // the timing dependency without weakening the assertion.
    const liveSocket = () =>
      [...wsInstances]
        .reverse()
        .find((w) => w.readyState === MockWebSocket.OPEN && w.sent.length >= 1);
    await waitFor(() => {
      expect(liveSocket()).toBeDefined();
    });
    const ws = liveSocket()!;
    const xterm = xtermInstances[0]!;

    // Drive the last-sent focus state to "focus" via the per-terminal focus
    // listener, exactly like a real focus would. This is the dedupe TRAP:
    // after this, lastSentFocusStateRef === "focus", so a plain refit focus
    // signal would be swallowed.
    act(() => {
      xterm.textarea.dispatchEvent(new Event("focus"));
    });
    expect(ws.sentTypes()).toContain("client_focus");

    // Clear the recording, then refit. With Fix 1, refit clears the baseline
    // and re-sends, so a NEW client_focus MUST appear even though the last
    // sent state was already "focus".
    ws.sent.length = 0;
    act(() => {
      ref.current?.refit();
    });

    expect(ws.sentTypes()).toContain("client_focus");
  });

  it("flushes live document focus state when the socket opens", async () => {
    const Terminal = await getTerminal();
    blurBeforeSocketOpen = true;

    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_blur");
    });
    expect(wsInstances.at(-1)?.sentTypes()).not.toContain("client_focus");
  });

  it("uses committed panel visibility when a socket opens during a suspended render", async () => {
    const Terminal = await getTerminal();
    autoOpenSockets = false;
    const neverResolves = new Promise<void>(() => {});
    let speculativeRenderSeen = false;

    function SuspendOnReveal({ visible }: { visible: boolean }) {
      if (visible) {
        speculativeRenderSeen = true;
        throw neverResolves;
      }
      return null;
    }

    function Harness() {
      const [visible, setVisible] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => startTransition(() => setVisible(true))}
          >
            Reveal
          </button>
          <Suspense fallback={null}>
            <Terminal
              sessionId="s1"
              tmuxSessionName="rdv-s1"
              wsUrl="ws://localhost:0"
              terminalType="shell"
              visible={visible}
            />
            <SuspendOnReveal visible={visible} />
          </Suspense>
        </>
      );
    }

    const view = render(<Harness />);
    await waitFor(() => {
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    });
    const socket = wsInstances.at(-1)!;

    act(() => view.getByRole("button", { name: "Reveal" }).click());
    expect(speculativeRenderSeen).toBe(true);
    act(() => socket.open());

    expect(socket.sentTypes()).toContain("client_blur");
    expect(socket.sentTypes()).not.toContain("client_focus");
  });

  it("flushes blur when a socket opens after committed hide but before passive effects", async () => {
    const Terminal = await getTerminal();
    autoOpenSockets = false;

    function OpenSocketOnCommittedHide({ visible }: { visible: boolean }) {
      useLayoutEffect(() => {
        if (!visible) wsInstances.at(-1)?.open();
      }, [visible]);
      return null;
    }

    function Harness() {
      const [visible, setVisible] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setVisible(false)}>
            Hide
          </button>
          <Terminal
            sessionId="s1"
            tmuxSessionName="rdv-s1"
            wsUrl="ws://localhost:0"
            terminalType="shell"
            visible={visible}
          />
          <OpenSocketOnCommittedHide visible={visible} />
        </>
      );
    }

    const view = render(<Harness />);
    await waitFor(() => {
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    });
    const socket = wsInstances.at(-1)!;

    act(() => view.getByRole("button", { name: "Hide" }).click());

    expect(socket.sentTypes()).toContain("client_blur");
    expect(socket.sentTypes()).not.toContain("client_focus");
  });

  it("sends a genuine focus assertion on the first socket open", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const focusFrame = wsInstances
      .at(-1)!
      .sent.map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
      .find((frame) => frame.type === "client_focus");
    expect(focusFrame).toEqual({ type: "client_focus" });
  });

  it("reasserts focus on an unattended reconnect without promoting recency", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;

    vi.useFakeTimers();
    try {
      await act(async () => {
        firstSocket.serverClose();
        await vi.advanceTimersByTimeAsync(3000);
      });

      const reconnect = wsInstances.at(-1)!;
      expect(reconnect).not.toBe(firstSocket);
      const focusFrame = reconnect.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus");
      expect(focusFrame).toEqual({ type: "client_focus", reassert: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes genuine focus when focus transitions while the replacement socket connects", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    documentHasFocus = false;
    act(() => window.dispatchEvent(new Event("blur")));
    vi.useFakeTimers();
    try {
      autoOpenSockets = false;
      firstSocket.serverClose();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      const reconnect = wsInstances.at(-1)!;
      expect(reconnect).not.toBe(firstSocket);
      expect(reconnect.readyState).toBe(MockWebSocket.CONNECTING);

      documentHasFocus = true;
      act(() => window.dispatchEvent(new Event("focus")));
      act(() => reconnect.open());

      const focusFrame = reconnect.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus");
      expect(focusFrame).toEqual({ type: "client_focus" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending gap focus when the client blurs again before reopen", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    documentHasFocus = false;
    act(() => window.dispatchEvent(new Event("blur")));
    vi.useFakeTimers();
    try {
      autoOpenSockets = false;
      firstSocket.serverClose();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      const reconnect = wsInstances.at(-1)!;
      documentHasFocus = true;
      act(() => window.dispatchEvent(new Event("focus")));
      documentHasFocus = false;
      act(() => window.dispatchEvent(new Event("blur")));
      act(() => reconnect.open());

      expect(reconnect.sentTypes()).toContain("client_blur");
      expect(reconnect.sentTypes()).not.toContain("client_focus");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a stale socket if it opens after a replacement supersedes it", async () => {
    autoOpenSockets = false;
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(0));
    const stale = wsInstances.at(-1)!;

    view.rerender(
      <Terminal
        sessionId="s2"
        tmuxSessionName="rdv-s2"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(1));
    const closesBeforeStaleOpen = stale.closeCalls;

    act(() => stale.open());

    expect(stale.closeCalls).toBe(closesBeforeStaleOpen + 1);
  });

  it("does not create a second replacement while a socket is connecting", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;

    vi.useFakeTimers();
    try {
      autoOpenSockets = false;
      firstSocket.serverClose();
      firstSocket.onclose?.();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(wsInstances).toHaveLength(2);
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one clientInstanceId and reasserts on a mobile-mode reconnect", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        mobileMode
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    const firstInstanceId = new URL(firstSocket.url).searchParams.get("clientInstanceId");
    expect(firstInstanceId).toBeTruthy();

    vi.useFakeTimers();
    try {
      await act(async () => {
        firstSocket.serverClose();
        await vi.advanceTimersByTimeAsync(3000);
      });

      const reconnect = wsInstances.at(-1)!;
      expect(reconnect).not.toBe(firstSocket);
      expect(new URL(reconnect.url).searchParams.get("clientInstanceId")).toBe(
        firstInstanceId,
      );
      const focusFrame = reconnect.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus");
      expect(focusFrame).toEqual({ type: "client_focus", reassert: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps its mounted clientInstanceId and reasserts across a same-session effect restart", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    const clientInstanceId = new URL(firstSocket.url).searchParams.get(
      "clientInstanceId",
    );

    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:2"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(firstSocket);
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const replacement = wsInstances.at(-1)!;
    expect(new URL(replacement.url).searchParams.get("clientInstanceId")).toBe(
      clientInstanceId,
    );
    expect(
      replacement.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus"),
    ).toEqual({ type: "client_focus", reassert: true });
  });

  it("flushes genuine focus when returning from chat during the restart import gap", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;

    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible={false}
      />,
    );
    await waitFor(() => {
      expect(firstSocket.sentTypes()).toContain("client_blur");
    });

    autoOpenSockets = false;
    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:2"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(firstSocket);
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    });

    const replacement = wsInstances.at(-1)!;
    act(() => replacement.open());
    expect(
      replacement.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus"),
    ).toEqual({ type: "client_focus" });
  });

  it("preserves a pending genuine focus across a same-session effect restart", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    documentHasFocus = false;
    act(() => window.dispatchEvent(new Event("blur")));

    autoOpenSockets = false;
    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:2"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(firstSocket);
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    });
    const connectingSocket = wsInstances.at(-1)!;

    documentHasFocus = true;
    act(() => window.dispatchEvent(new Event("focus")));
    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:3"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(connectingSocket);
      expect(wsInstances.at(-1)?.readyState).toBe(MockWebSocket.CONNECTING);
    });

    const replacement = wsInstances.at(-1)!;
    act(() => replacement.open());
    const focusFrame = replacement.sent
      .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
      .find((frame) => frame.type === "client_focus");
    expect(focusFrame).toEqual({ type: "client_focus" });
  });

  it("keeps its mounted clientInstanceId but flushes genuine focus for a new session", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    const clientInstanceId = new URL(firstSocket.url).searchParams.get(
      "clientInstanceId",
    );

    view.rerender(
      <Terminal
        sessionId="s2"
        tmuxSessionName="rdv-s2"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(firstSocket);
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const replacement = wsInstances.at(-1)!;
    expect(new URL(replacement.url).searchParams.get("clientInstanceId")).toBe(
      clientInstanceId,
    );
    expect(
      replacement.sent
        .map((frame) => JSON.parse(frame) as { type: string; reassert?: boolean })
        .find((frame) => frame.type === "client_focus"),
    ).toEqual({ type: "client_focus" });
  });

  it("clears stale textarea focus before a same-session effect restart", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:1"
        terminalType="shell"
        visible
      />,
    );
    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;
    documentHasFocus = false;
    act(() => {
      xtermInstances.at(-1)?.textarea.dispatchEvent(new Event("focus"));
    });

    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:2"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)).not.toBe(firstSocket);
      expect(wsInstances.at(-1)?.sent.length).toBeGreaterThan(0);
    });
    expect(wsInstances.at(-1)?.sentTypes()).toContain("client_blur");
    expect(wsInstances.at(-1)?.sentTypes()).not.toContain("client_focus");
  });

  it("forces client_focus and a resize reconciliation while derived focus is blurred", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    render(
      <Terminal
        ref={ref}
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("resize");
    });
    const ws = wsInstances.at(-1)!;
    documentHasFocus = false;
    act(() => window.dispatchEvent(new Event("blur")));
    expect(ws.sentTypes()).toContain("client_blur");

    ws.sent.length = 0;
    const reconciler = reconcilerState.instances.find(
      (instance) => !instance.wasDisposed,
    )!;
    reconciler.requests.length = 0;
    act(() => ref.current?.refit());

    expect(ws.sentTypes()).toContain("client_focus");
    expect(reconciler.requests).toContain("refit");
    await waitFor(() => expect(ws.sentTypes()).toContain("resize"));

    ws.sent.length = 0;
    act(() => window.dispatchEvent(new Event("blur")));
    expect(ws.sentTypes()).toContain("client_blur");
  });

  it("reconciles and sends dimensions when a hidden panel becomes visible", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible={false}
      />,
    );

    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(0));
    const ws = wsInstances.at(-1)!;
    ws.sent.length = 0;

    view.rerender(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible
      />,
    );

    await waitFor(() => {
      expect(
        ws.sent
          .map((frame) => JSON.parse(frame) as { type: string; cols?: number; rows?: number })
          .find((frame) => frame.type === "resize"),
      ).toEqual({ type: "resize", cols: 100, rows: 30 });
    });
  });

  it("StrictMode leaves one live terminal and teardown prevents later fits", async () => {
    const Terminal = await getTerminal();
    const view = render(
      <StrictMode>
        <Terminal
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          terminalType="shell"
          visible
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(
        reconcilerState.instances.filter((reconciler) => !reconciler.wasDisposed),
      ).toHaveLength(1);
    });

    view.unmount();
    act(() => window.dispatchEvent(new Event("resize")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      reconcilerState.instances.filter((reconciler) => !reconciler.wasDisposed),
    ).toHaveLength(0);
    expect(
      reconcilerState.instances.reduce(
        (total, reconciler) => total + reconciler.callsAfterDispose,
        0,
      ),
    ).toBe(0);
  });

  it("ignores an asynchronous close from a superseded StrictMode socket", async () => {
    const Terminal = await getTerminal();
    const onStatusChange = vi.fn();
    const onWebSocketReady = vi.fn();
    render(
      <StrictMode>
        <Terminal
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          terminalType="shell"
          visible
          onStatusChange={onStatusChange}
          onWebSocketReady={onWebSocketReady}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("client_focus");
    });
    const firstSocket = wsInstances.at(-1)!;

    vi.useFakeTimers();
    try {
      await act(async () => {
        firstSocket.serverClose();
        await vi.advanceTimersByTimeAsync(3000);
      });
      const replacement = wsInstances.at(-1)!;
      expect(replacement).not.toBe(firstSocket);
      expect(onStatusChange).toHaveBeenLastCalledWith("connected");
      expect(onWebSocketReady).toHaveBeenLastCalledWith(replacement);

      const socketCount = wsInstances.length;
      firstSocket.close();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onStatusChange).toHaveBeenLastCalledWith("connected");
      expect(onWebSocketReady).toHaveBeenLastCalledWith(replacement);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(wsInstances).toHaveLength(socketCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send client_focus for a hidden panel on window focus", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible={false}
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sent.length).toBeGreaterThan(0);
    });
    const ws = wsInstances.at(-1)!;
    ws.sent.length = 0;

    act(() => window.dispatchEvent(new Event("focus")));

    expect(ws.sentTypes()).not.toContain("client_focus");
  });

  it("refit while the panel is hidden emits no client_focus frame", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();
    render(
      <Terminal
        ref={ref}
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        visible={false}
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sent.length).toBeGreaterThan(0);
    });
    const ws = wsInstances.at(-1)!;
    ws.sent.length = 0;

    act(() => ref.current?.refit());

    expect(ws.sentTypes()).not.toContain("client_focus");
    expect(
      reconcilerState.instances.find((instance) => !instance.wasDisposed)?.requests,
    ).toContain("refit");
  });

  it("replays activation after async initialization with resize and keyboard focus", async () => {
    const Terminal = await getTerminal();
    render(
      <Terminal
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        terminalType="shell"
        isActive
        visible
      />,
    );

    await waitFor(() => {
      expect(wsInstances.at(-1)?.sentTypes()).toContain("resize");
      expect(xtermInstances.at(-1)?.focus).toHaveBeenCalled();
    });
  });
});
