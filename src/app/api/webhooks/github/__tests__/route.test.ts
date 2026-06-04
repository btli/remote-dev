// @vitest-environment node
/**
 * Tests for POST /api/webhooks/github (epic remote-dev-oyej.2) — HMAC verify,
 * event filtering, and the fast-202 fire-and-forget dispatch into
 * TriggerService.handleEvent (mocked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// The route hands parsed events to this service; mock it so we assert dispatch
// without a DB or real agent launch. `claimDelivery` models the real atomic
// claim: the first time a delivery UUID is seen it returns true (process),
// every repeat returns false (redelivery → no-op). A blank id always returns
// true (no UUID to dedupe on — see route fallback).
const seenDeliveries = new Set<string>();
vi.mock("@/services/trigger-service", () => ({
  handleEvent: vi.fn(async () => {}),
  claimDelivery: vi.fn(async (deliveryId: string) => {
    if (!deliveryId) return true;
    if (seenDeliveries.has(deliveryId)) return false;
    seenDeliveries.add(deliveryId);
    return true;
  }),
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import * as TriggerService from "@/services/trigger-service";
import { POST } from "../route";

const SECRET = "test-webhook-secret";
const ORIGINAL = process.env.GITHUB_WEBHOOK_SECRET;

function sign(raw: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
}

function ghRequest(
  body: unknown,
  event: string,
  opts: { signature?: string; delivery?: string } = {},
): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-hub-signature-256": opts.signature ?? sign(raw),
  };
  if (opts.delivery !== undefined) headers["x-github-delivery"] = opts.delivery;
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("POST /api/webhooks/github", () => {
  beforeEach(() => {
    vi.mocked(TriggerService.handleEvent).mockClear();
    vi.mocked(TriggerService.claimDelivery).mockClear();
    seenDeliveries.clear();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = ORIGINAL;
  });

  it("503 when the secret is not configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const res = await POST(ghRequest({}, "pull_request"));
    expect(res.status).toBe(503);
    expect(TriggerService.handleEvent).not.toHaveBeenCalled();
  });

  it("202 + dispatches once on a valid pull_request/labeled event", async () => {
    const body = {
      action: "labeled",
      repository: { full_name: "octo/repo" },
      pull_request: {
        number: 7,
        head: { sha: "abc123" },
        labels: [{ name: "agent:fix" }],
      },
      label: { name: "agent:fix" },
    };
    const res = await POST(ghRequest(body, "pull_request"));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      message: "accepted",
      event: "pull_request",
      action: "labeled",
    });
    expect(TriggerService.handleEvent).toHaveBeenCalledOnce();
    const passed = vi.mocked(TriggerService.handleEvent).mock.calls[0][0];
    expect(passed).toMatchObject({
      event: "pull_request",
      action: "labeled",
      repoFullName: "octo/repo",
      headSha: "abc123",
      prNumber: 7,
      labels: ["agent:fix"],
    });
  });

  it("deduplicates a redelivered x-github-delivery: dispatches once, 2nd is 200 'already processed'", async () => {
    // An issues/opened event carries NO head SHA, so the head-SHA unique index
    // cannot dedupe it — the delivery-id guard is what prevents a second run.
    const body = {
      action: "opened",
      repository: { full_name: "octo/repo" },
      issue: { number: 11 },
    };
    const delivery = "11111111-2222-3333-4444-555555555555";

    const first = await POST(ghRequest(body, "issues", { delivery }));
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ message: "accepted" });

    // GitHub redelivers the SAME delivery UUID (manual replay or retry).
    const second = await POST(ghRequest(body, "issues", { delivery }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      message: "already processed",
      event: "issues",
      action: "opened",
    });

    // Critically: handleEvent (which launches the run) ran only ONCE.
    expect(TriggerService.handleEvent).toHaveBeenCalledOnce();
    expect(TriggerService.claimDelivery).toHaveBeenCalledTimes(2);
  });

  it("distinct delivery ids each dispatch (no false-positive dedupe)", async () => {
    const body = {
      action: "opened",
      repository: { full_name: "octo/repo" },
      issue: { number: 12 },
    };
    await POST(ghRequest(body, "issues", { delivery: "delivery-a" }));
    await POST(ghRequest(body, "issues", { delivery: "delivery-b" }));
    expect(TriggerService.handleEvent).toHaveBeenCalledTimes(2);
  });

  it("dispatches when x-github-delivery is absent (falls back to head-SHA guard)", async () => {
    const body = {
      action: "labeled",
      repository: { full_name: "octo/repo" },
      pull_request: { number: 7, head: { sha: "abc123" }, labels: [] },
    };
    // No delivery header at all.
    const res = await POST(ghRequest(body, "pull_request"));
    expect(res.status).toBe(202);
    expect(TriggerService.handleEvent).toHaveBeenCalledOnce();
  });

  it("401 on a tampered body (signature mismatch)", async () => {
    const good = { action: "labeled", pull_request: { head: { sha: "x" } } };
    const raw = JSON.stringify(good);
    const sig = sign(raw);
    // Build a request whose BODY differs from what was signed.
    const tampered = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sig,
      },
      body: JSON.stringify({ ...good, action: "closed" }),
    });
    const res = await POST(tampered);
    expect(res.status).toBe(401);
    expect(TriggerService.handleEvent).not.toHaveBeenCalled();
  });

  it("200 pong on a ping event (valid signature)", async () => {
    const res = await POST(ghRequest({ zen: "hi" }, "ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "pong" });
    expect(TriggerService.handleEvent).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body with a valid signature", async () => {
    const raw = "{not json";
    const req = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256":
          "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"),
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
