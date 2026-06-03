// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route enqueues into the analytics store via this service; mock it so we
// can simulate a successful enqueue vs an infrastructure throw.
vi.mock("@/services/litellm-analytics-service", () => ({
  recordBatch: vi.fn(),
}));

import * as LiteLLMAnalyticsService from "@/services/litellm-analytics-service";
import { POST } from "./route";

const ORIGINAL_SECRET = process.env.LITELLM_WEBHOOK_SECRET;

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/litellm/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** A request whose body is NOT valid JSON (forces a parse error). */
function malformedRequest(): Request {
  return new Request("http://localhost/api/litellm/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
}

describe("POST /api/litellm/webhook", () => {
  beforeEach(() => {
    vi.mocked(LiteLLMAnalyticsService.recordBatch).mockReset();
    delete process.env.LITELLM_WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.LITELLM_WEBHOOK_SECRET;
    else process.env.LITELLM_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("returns 200 with the count on a valid single payload", async () => {
    const res = await POST(jsonRequest({ id: "a", model: "gpt" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1 });
    expect(LiteLLMAnalyticsService.recordBatch).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with the count on a valid array payload", async () => {
    const res = await POST(jsonRequest([{ id: "a" }, { id: "b" }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 2 });
  });

  it("returns 200 {received:0} on a JSON parse error (LiteLLM must NOT retry)", async () => {
    const res = await POST(malformedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0 });
    // A parse error means we never reached the store.
    expect(LiteLLMAnalyticsService.recordBatch).not.toHaveBeenCalled();
  });

  it("returns 500 on an INFRASTRUCTURE error so LiteLLM retries", async () => {
    vi.mocked(LiteLLMAnalyticsService.recordBatch).mockImplementation(() => {
      throw new Error("analytics store construction failed");
    });
    const res = await POST(jsonRequest({ id: "a" }));
    expect(res.status).toBe(500);
    expect(LiteLLMAnalyticsService.recordBatch).toHaveBeenCalledTimes(1);
  });

  it("returns 401 on a bad webhook secret (before any parsing)", async () => {
    process.env.LITELLM_WEBHOOK_SECRET = "expected";
    const res = await POST(
      jsonRequest({ id: "a" }, { "x-webhook-secret": "wrong" })
    );
    expect(res.status).toBe(401);
    expect(LiteLLMAnalyticsService.recordBatch).not.toHaveBeenCalled();
  });
});
