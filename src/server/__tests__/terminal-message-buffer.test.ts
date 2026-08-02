// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { bufferTerminalMessages } from "@/server/terminal";

class FakeWebSocket extends EventEmitter {
  emitMessage(type: string): void {
    this.emit("message", Buffer.from(JSON.stringify({ type })));
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

    bufferedMessages.activate((message) => {
      processed.push(JSON.parse(message.toString()).type as string);
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
  });
});
