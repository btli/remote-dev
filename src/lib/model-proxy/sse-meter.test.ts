// @vitest-environment node
import { describe, it, expect } from "vitest";
import { meterAnthropicSse, type MeteredUsage } from "./sse-meter";

/** A realistic Anthropic streaming transcript (message_start + deltas + message_delta). */
const TRANSCRIPT = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":4,"cache_creation_input_tokens":7}}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}`,
  ``,
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  ``,
].join("\n");

/** Build a ReadableStream that emits `chunks` (Uint8Array) in order. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else ctrl.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("meterAnthropicSse", () => {
  it("passes bytes through unchanged and accumulates usage (byte-at-a-time)", async () => {
    const enc = new TextEncoder();
    const full = enc.encode(TRANSCRIPT);
    // Feed one byte per chunk to exercise cross-chunk line splitting.
    const chunks = Array.from(full, (b) => Uint8Array.of(b));

    const { stream, usage } = meterAnthropicSse(streamOf(chunks));
    const out = await drain(stream);

    // Bytes are byte-identical to the input.
    expect(out).toEqual(full);
    expect(new TextDecoder().decode(out)).toBe(TRANSCRIPT);

    const u: MeteredUsage = await usage;
    expect(u.model).toBe("claude-sonnet-4-5");
    expect(u.inputTokens).toBe(10);
    // output_tokens: 1 (message_start) + 25 (message_delta) = 26
    expect(u.outputTokens).toBe(26);
    expect(u.cacheReadTokens).toBe(4);
    expect(u.cacheCreationTokens).toBe(7);
  });

  it("never throws on a partial/garbled data line and still resolves usage", async () => {
    const enc = new TextEncoder();
    const garbled = [
      `data: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":5}}}`,
      `data: {not valid json`,
      `data: [DONE]`,
      ``,
    ].join("\n");
    const { stream, usage } = meterAnthropicSse(streamOf([enc.encode(garbled)]));
    const out = await drain(stream);
    expect(new TextDecoder().decode(out)).toBe(garbled);
    const u = await usage;
    expect(u.model).toBe("claude-x");
    expect(u.inputTokens).toBe(5);
    expect(u.outputTokens).toBe(0);
  });

  it("emits the upstream chunk before parsing (passthrough is not gated on the meter)", async () => {
    const enc = new TextEncoder();
    const { stream, usage } = meterAnthropicSse(
      streamOf([enc.encode(`data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":1}}}\n`)]),
    );
    const reader = stream.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(value).toBeDefined();
    // finish the stream so the usage promise resolves
    await reader.read();
    await usage;
  });
});
