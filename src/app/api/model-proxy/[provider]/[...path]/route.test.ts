// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const REAL_KEY = "sk-ant-REALKEY-do-not-leak";
const TOKEN = "mp_FAKETOKEN-also-secret";

// Capture EVERY log call so we can assert no secret is ever logged.
const logCalls: Array<{ level: string; msg: string; data?: unknown }> = [];
vi.mock("@/lib/logger", () => {
  const make = (level: string) => (msg: string, data?: unknown) =>
    logCalls.push({ level, msg, data });
  return {
    createLogger: () => ({
      error: make("error"),
      warn: make("warn"),
      info: make("info"),
      debug: make("debug"),
      trace: make("trace"),
    }),
  };
});

const authenticateProxyToken = vi.fn();
vi.mock("@/services/model-proxy-token-service", () => ({
  authenticateProxyToken,
}));

const resolveProviderKey = vi.fn();
vi.mock("@/services/model-provider-resolver", () => ({
  resolveProviderKey,
}));

const recordUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/model-usage-service", () => ({
  recordUsage,
}));

// Rate limiter always allows; cache disabled (returns null).
vi.mock("@/services/model-proxy-cache", () => ({
  allowRequest: vi.fn(() => true),
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  cacheKey: vi.fn(() => "ck"),
}));

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

/** An Anthropic-style SSE transcript as a ReadableStream. */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(bytes);
      ctrl.close();
    },
  });
}

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

const SSE_BODY = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":1}}}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","usage":{"output_tokens":20}}`,
  ``,
].join("\n");

function ctx(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) };
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/model-proxy/anthropic/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-proxy/[provider]/[...path]", () => {
  beforeEach(() => {
    logCalls.length = 0;
    authenticateProxyToken.mockReset();
    resolveProviderKey.mockReset();
    recordUsage.mockClear();
    process.env.RDV_MODEL_PROXY_ENABLED = "1";
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.RDV_MODEL_PROXY_ENABLED;
  });

  it("returns 404 when the feature flag is off (inert by default)", async () => {
    delete process.env.RDV_MODEL_PROXY_ENABLED;
    const { POST } = await import("./route");
    const res = await POST(postRequest({ model: "claude-sonnet-4-5" }), ctx("anthropic", ["v1", "messages"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s on an invalid/absent proxy token", async () => {
    authenticateProxyToken.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(postRequest({ model: "x" }), ctx("anthropic", ["v1", "messages"]));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("PROXY_TOKEN_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s on an unknown provider", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u", sessionId: "s", instanceSlug: null, tokenId: "t" });
    const { POST } = await import("./route");
    const res = await POST(postRequest({ model: "x" }), ctx("nope", ["v1"]));
    expect(res.status).toBe(404);
  });

  it("injects the REAL key as x-api-key and streams the upstream SSE bytes unchanged", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue(REAL_KEY);
    fetchMock.mockResolvedValue(
      new Response(sseStream(SSE_BODY), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ model: "claude-sonnet-4-5", stream: true, system: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", scope: { x: 1 } } }] }),
      ctx("anthropic", ["v1", "messages"]),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // The streamed body is byte-identical to the upstream SSE.
    const out = await readAll(res);
    expect(out).toBe(SSE_BODY);

    // Upstream was called with the REAL key in the x-api-key header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe(REAL_KEY);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");

    // The forwarded BODY had cache_control.scope stripped (sanitize ran).
    const sentBody = JSON.parse(init.body as string) as {
      system: Array<{ cache_control: Record<string, unknown> }>;
    };
    expect(sentBody.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sentBody.system[0].cache_control).not.toHaveProperty("scope");
  });

  it("KEY NON-LEAKAGE: never logs the real key or token during a proxied request", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue(REAL_KEY);
    fetchMock.mockResolvedValue(
      new Response(sseStream(SSE_BODY), { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ model: "claude-sonnet-4-5", stream: true }, { authorization: `Bearer ${TOKEN}` }),
      ctx("anthropic", ["v1", "messages"]),
    );
    await readAll(res);

    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain(REAL_KEY);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("sk-ant-");
  });

  it("KEY NON-LEAKAGE: on an upstream error the response body contains no key/token", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue(REAL_KEY);
    // Upstream returns a 500 JSON error (non-streaming).
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "upstream boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ model: "claude-sonnet-4-5" }, { authorization: `Bearer ${TOKEN}` }),
      ctx("anthropic", ["v1", "messages"]),
    );
    const body = await readAll(res);
    expect(body).not.toContain(REAL_KEY);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("sk-ant-");
    expect(body).not.toContain("mp_");
    // And nothing leaked into the logs either.
    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain(REAL_KEY);
    expect(serialized).not.toContain(TOKEN);
  });

  it("KEY NON-LEAKAGE: when the upstream fetch throws, the error response carries no key", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue(REAL_KEY);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ model: "claude-sonnet-4-5" }, { authorization: `Bearer ${TOKEN}` }),
      ctx("anthropic", ["v1", "messages"]),
    );
    expect(res.status).toBe(502);
    const body = await readAll(res);
    expect(body).not.toContain(REAL_KEY);
    expect(JSON.stringify(logCalls)).not.toContain(REAL_KEY);
  });

  it("502s with no key in the body when the provider key cannot be resolved", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(postRequest({ model: "x" }), ctx("anthropic", ["v1", "messages"]));
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards OpenAI with Authorization: Bearer <realkey> and no cache_control mutation", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue("sk-openai-REAL");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "x", usage: { input_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const body = { model: "gpt-4o", cache_control: { type: "ephemeral", scope: { x: 1 } } };
    const req = new Request("http://localhost/api/model-proxy/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const { POST } = await import("./route");
    const res = await POST(req, ctx("openai", ["v1", "chat", "completions"]));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-openai-REAL");
    // OpenAI bodies are NOT anthropic-sanitized — cache_control.scope is preserved.
    const sent = JSON.parse(init.body as string) as { cache_control: Record<string, unknown> };
    expect(sent.cache_control).toEqual({ type: "ephemeral", scope: { x: 1 } });
  });

  it("forwards Gemini with x-goog-api-key (NOT Authorization: Bearer)", async () => {
    authenticateProxyToken.mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" });
    resolveProviderKey.mockResolvedValue("gem-REAL-KEY");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = new Request(
      "http://localhost/api/model-proxy/gemini/v1beta/models/gemini-pro:generateContent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [] }),
      },
    );
    const { POST } = await import("./route");
    const res = await POST(req, ctx("gemini", ["v1beta", "models", "gemini-pro:generateContent"]));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("x-goog-api-key")).toBe("gem-REAL-KEY");
    // Must NOT use Authorization: Bearer for Gemini.
    expect(headers.get("authorization")).toBeNull();
  });
});
