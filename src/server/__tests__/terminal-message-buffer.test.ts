// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  abortTerminalSetupIfClosed,
  bufferTerminalMessages,
} from "@/server/terminal";

class FakeWebSocket extends EventEmitter {
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  emitMessage(type: string): void {
    this.emit("message", Buffer.from(JSON.stringify({ type })));
  }

  emitRaw(message: Buffer): void {
    this.emit("message", message);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }
}

describe("terminal connection setup message buffering", () => {
  it("processes frames received during async setup in order before live frames", async () => {
    const ws = new FakeWebSocket();
    const bufferedMessages = bufferTerminalMessages(ws);
    const processed: string[] = [];

    ws.emitMessage("client_focus");
    await Promise.resolve();
    ws.emitMessage("resize");

    bufferedMessages.activate({
      message(message) {
        processed.push(JSON.parse(message.toString()).type as string);
      },
      close: vi.fn(),
      error: vi.fn(),
    });
    ws.emitMessage("input");

    expect(processed).toEqual(["client_focus", "resize", "input"]);
  });

  it("drops buffered frames and removes the listener when setup fails", () => {
    const ws = new FakeWebSocket();
    const bufferedMessages = bufferTerminalMessages(ws);

    ws.emitMessage("client_focus");
    bufferedMessages.discard();

    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.listenerCount("close")).toBe(0);
    expect(ws.listenerCount("error")).toBe(0);
  });

  it("aborts a setup closed before activation, destroys its PTY, and drains no frames", () => {
    const ws = new FakeWebSocket();
    const bufferedMessages = bufferTerminalMessages(ws);
    const processed: string[] = [];
    const destroyPty = vi.fn();
    const setupLog = { debug: vi.fn() };
    const pty = { id: "pty-1" };
    let registered = false;

    ws.emitMessage("client_focus");
    ws.emit("close", 1006, Buffer.from("setup closed"));

    if (!abortTerminalSetupIfClosed(
      bufferedMessages,
      pty,
      destroyPty,
      "session-1",
      setupLog,
    )) {
      registered = true;
      bufferedMessages.activate({
        message(message) {
          processed.push(JSON.parse(message.toString()).type as string);
        },
        close: vi.fn(),
        error: vi.fn(),
      });
    }

    expect(bufferedMessages.wasClosed()).toBe(true);
    expect(bufferedMessages.getCloseInfo()).toEqual({
      code: 1006,
      reason: Buffer.from("setup closed"),
    });
    expect(registered).toBe(false);
    expect(destroyPty).toHaveBeenCalledWith(pty);
    expect(processed).toEqual([]);
    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.listenerCount("close")).toBe(0);
    expect(ws.listenerCount("error")).toBe(0);
    expect(setupLog.debug).toHaveBeenCalledWith(
      "Terminal setup aborted after socket closed",
      { sessionId: "session-1", closeCode: 1006 },
    );
  });

  it("catches and logs an error emitted before activation", () => {
    const ws = new FakeWebSocket();
    const setupLog = { error: vi.fn(), warn: vi.fn() };
    const bufferedMessages = bufferTerminalMessages(ws, setupLog);
    const error = new Error("socket failed during setup");

    expect(() => ws.emit("error", error)).not.toThrow();

    expect(bufferedMessages.wasClosed()).toBe(true);
    expect(setupLog.error).toHaveBeenCalledWith(
      "Terminal connection error during setup",
      { error: String(error) },
    );
    bufferedMessages.discard();
  });

  it("transfers close and error handling when activation succeeds", () => {
    const ws = new FakeWebSocket();
    const setupLog = { error: vi.fn(), warn: vi.fn() };
    const bufferedMessages = bufferTerminalMessages(ws, setupLog);
    const close = vi.fn();
    const error = vi.fn();

    bufferedMessages.activate({ message: vi.fn(), close, error });
    ws.emit("close", 1000, Buffer.from("done"));
    const liveError = new Error("live socket error");
    ws.emit("error", liveError);

    expect(close).toHaveBeenCalledWith(1000, Buffer.from("done"));
    expect(error).toHaveBeenCalledWith(liveError);
    expect(setupLog.error).not.toHaveBeenCalled();
  });

  it("closes with 1009 and aborts setup cleanly when the frame cap overflows", () => {
    const ws = new FakeWebSocket();
    const setupLog = { error: vi.fn(), warn: vi.fn() };
    const bufferedMessages = bufferTerminalMessages(ws, setupLog);
    const destroyPty = vi.fn();
    const pty = { id: "pty-overflow" };

    for (let index = 0; index <= 256; index++) {
      ws.emitMessage("input");
    }

    expect(ws.closeCalls).toEqual([{
      code: 1009,
      reason: "Terminal setup message buffer overflow",
    }]);
    expect(bufferedMessages.wasClosed()).toBe(true);
    expect(abortTerminalSetupIfClosed(
      bufferedMessages,
      pty,
      destroyPty,
      "session-overflow",
    )).toBe(true);
    expect(destroyPty).toHaveBeenCalledTimes(1);
    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.listenerCount("close")).toBe(0);
    expect(ws.listenerCount("error")).toBe(0);
    expect(setupLog.warn).toHaveBeenCalledWith(
      "Terminal setup message buffer overflow",
      expect.objectContaining({ frameCount: 256 }),
    );
  });

  it("closes with 1009 when buffered payload exceeds one MiB", () => {
    const ws = new FakeWebSocket();
    const setupLog = { error: vi.fn(), warn: vi.fn() };
    const bufferedMessages = bufferTerminalMessages(ws, setupLog);

    ws.emitRaw(Buffer.alloc(1024 * 1024));
    ws.emitRaw(Buffer.from("x"));

    expect(bufferedMessages.wasClosed()).toBe(true);
    expect(ws.closeCalls.at(-1)?.code).toBe(1009);
    expect(setupLog.warn).toHaveBeenCalledWith(
      "Terminal setup message buffer overflow",
      expect.objectContaining({ payloadBytes: 1024 * 1024 }),
    );
  });
});
