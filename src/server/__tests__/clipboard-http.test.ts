// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  CLIPBOARD_MAX_BYTES,
  CLIPBOARD_SESSION_ID_MAX_BYTES,
  ClipboardBroker,
} from "../clipboard-broker";
import {
  CLIPBOARD_HTTP_MAX_BODY_BYTES,
  resolveClipboardHttpOperation,
  resolveClipboardHttpStreamRequest,
} from "../clipboard-http";
import { attemptRemoteClipboardWrite } from "../clipboard-protocol";

function backend(broker: ClipboardBroker) {
  return {
    read: (sessionId: string) => broker.read(sessionId),
    write: (sessionId: string, data: string) =>
      attemptRemoteClipboardWrite(broker, sessionId, data),
  };
}

function operation(
  broker: ClipboardBroker,
  request: Parameters<typeof resolveClipboardHttpOperation>[0],
) {
  return resolveClipboardHttpOperation(request, backend(broker));
}

async function* chunks(...values: Uint8Array[]) {
  for (const value of values) yield value;
}

describe("internal clipboard HTTP operation", () => {
  it("POST validates, stores, and returns revision plus delivery state", () => {
    const broker = new ClipboardBroker();

    expect(
      operation(broker, {
        method: "POST",
        body: { sessionId: "session-a", data: "exact\ntext" },
      }),
    ).toEqual({
      status: 200,
      contentType: "application/json",
      body: { revision: 1, delivered: false },
    });
    expect(broker.read("session-a")?.data).toBe("exact\ntext");
  });

  it("GET returns exact text/plain data and 204 when absent or expired", () => {
    let now = 0;
    const broker = new ClipboardBroker({ now: () => now, ttlMs: 10 });
    broker.write("session-a", "line\nwith\0null");

    expect(
      operation(broker, { method: "GET", querySessionId: "session-a" }),
    ).toEqual({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "line\nwith\0null",
    });

    now = 10;
    expect(
      operation(broker, { method: "GET", querySessionId: "session-a" }),
    ).toEqual({
      status: 204,
      contentType: "text/plain; charset=utf-8",
      body: "",
    });
  });

  it.each([
    [{ method: "POST", body: null }, 400],
    [{ method: "POST", body: { sessionId: "", data: "text" } }, 400],
    [{ method: "POST", body: { sessionId: "session-a", data: 7 } }, 400],
    [{ method: "GET", querySessionId: "" }, 400],
  ] as const)("rejects malformed operations", (request, status) => {
    expect(operation(new ClipboardBroker(), request)).toMatchObject({ status });
  });

  it("returns 413 for clipboard text over one MiB", () => {
    expect(
      operation(new ClipboardBroker(), {
        method: "POST",
        body: {
          sessionId: "session-a",
          data: "x".repeat(CLIPBOARD_MAX_BYTES + 1),
        },
      }),
    ).toMatchObject({ status: 413 });
  });

  it("decodes split multibyte UTF-8 once at the HTTP endpoint", async () => {
    const broker = new ClipboardBroker();
    const data = "before 😀 after";
    const encoded = Buffer.from(JSON.stringify({ sessionId: "session-a", data }));
    const emoji = Buffer.from("😀");
    const emojiStart = encoded.indexOf(emoji);
    expect(emojiStart).toBeGreaterThan(0);

    const result = await resolveClipboardHttpStreamRequest(
      {
        method: "POST",
        bodyStream: chunks(
          encoded.subarray(0, emojiStart + 2),
          encoded.subarray(emojiStart + 2),
        ),
      },
      backend(broker),
    );

    expect(result).toMatchObject({ status: 200 });
    expect(broker.read("session-a")?.data).toBe(data);
  });

  it("rejects invalid UTF-8 at the HTTP endpoint without normalizing or storing it", async () => {
    const broker = new ClipboardBroker();
    const result = await resolveClipboardHttpStreamRequest(
      {
        method: "POST",
        bodyStream: chunks(
          Buffer.from('{"sessionId":"session-a","data":"'),
          Buffer.from([0xff]),
          Buffer.from('"}'),
        ),
      },
      backend(broker),
    );

    expect(result).toMatchObject({ status: 400 });
    expect(broker.read("session-a")).toBeNull();
  });

  it("bounds chunked HTTP bodies before JSON parsing", async () => {
    const read = vi.fn(() => null);
    const write = vi.fn(() => ({ revision: 1, delivered: false }));
    let yieldedBytes = 0;
    async function* oversizedBody() {
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      while (yieldedBytes <= CLIPBOARD_HTTP_MAX_BODY_BYTES) {
        yieldedBytes += chunk.byteLength;
        yield chunk;
      }
    }

    const result = await resolveClipboardHttpStreamRequest(
      { method: "POST", bodyStream: oversizedBody() },
      { read, write },
    );

    expect(result).toMatchObject({ status: 413 });
    expect(yieldedBytes).toBeGreaterThan(CLIPBOARD_HTTP_MAX_BODY_BYTES);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("allows worst-case JSON escaping for an exact one-MiB clipboard", async () => {
    const broker = new ClipboardBroker();
    const data = "\0".repeat(CLIPBOARD_MAX_BYTES);
    const encoded = Buffer.from(JSON.stringify({ sessionId: "session-a", data }));
    expect(encoded.byteLength).toBeLessThanOrEqual(CLIPBOARD_HTTP_MAX_BODY_BYTES);

    const result = await resolveClipboardHttpStreamRequest(
      { method: "POST", bodyStream: chunks(encoded) },
      backend(broker),
    );

    expect(result).toMatchObject({ status: 200 });
    expect(broker.read("session-a")?.data).toBe(data);
  });

  it("rejects oversized session ids before invoking the HTTP backend", () => {
    const read = vi.fn(() => null);
    const write = vi.fn(() => ({ revision: 1, delivered: false }));
    expect(CLIPBOARD_SESSION_ID_MAX_BYTES).toBe(128);
    const oversizedSessionId = "x".repeat(129);
    const backend = { read, write };

    expect(
      resolveClipboardHttpOperation(
        { method: "GET", querySessionId: oversizedSessionId },
        backend,
      ),
    ).toMatchObject({ status: 400 });
    expect(
      resolveClipboardHttpOperation(
        {
          method: "POST",
          body: { sessionId: oversizedSessionId, data: "text" },
        },
        backend,
      ),
    ).toMatchObject({ status: 400 });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("returns 405 for unsupported methods", () => {
    expect(
      operation(new ClipboardBroker(), { method: "DELETE" }),
    ).toMatchObject({ status: 405 });
  });
});
