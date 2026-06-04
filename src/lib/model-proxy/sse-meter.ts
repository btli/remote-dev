/**
 * SSE usage meter for the centralized model-key proxy.
 *
 * `meterAnthropicSse` wraps an upstream `ReadableStream` in a `TransformStream`
 * that:
 *   1. enqueues every chunk to the consumer FIRST (the agent's token stream is
 *      never blocked or buffered on the meter), then
 *   2. sniffs `usage` out of the `message_start` / `message_delta` SSE events as
 *      they flow by, accumulating totals.
 *
 * It MUST NOT buffer the whole body, and MUST NOT throw inside `transform`
 * (a partial JSON line split across TCP chunks is normal and is ignored until
 * the next chunk completes the line via the line buffer).
 *
 * No secret, token, or raw body is ever logged here.
 */

export interface MeteredUsage {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface SseUsageShape {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function meterAnthropicSse(upstream: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<MeteredUsage>;
} {
  const dec = new TextDecoder();
  let buf = "";
  const acc: MeteredUsage = {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let resolve!: (u: MeteredUsage) => void;
  const usage = new Promise<MeteredUsage>((r) => {
    resolve = r;
  });

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      // Passthrough FIRST — never block the agent on the meter.
      ctrl.enqueue(chunk);
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("data:")) continue;
        const json = trimmed.slice(5).trim();
        if (json === "[DONE]" || !json) continue;
        try {
          const evt = JSON.parse(json) as {
            usage?: SseUsageShape;
            message?: { usage?: SseUsageShape; model?: string };
          };
          const message = evt.message;
          const u = message?.usage ?? evt.usage;
          const m = message?.model;
          if (m) acc.model = m;
          if (u) {
            acc.inputTokens += u.input_tokens ?? 0;
            acc.outputTokens += u.output_tokens ?? 0;
            acc.cacheReadTokens += u.cache_read_input_tokens ?? 0;
            acc.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
          }
        } catch {
          // Partial line or non-JSON keepalive — ignore. NEVER throw here.
        }
      }
    },
    flush() {
      resolve(acc);
    },
  });

  return { stream: upstream.pipeThrough(transform), usage };
}
