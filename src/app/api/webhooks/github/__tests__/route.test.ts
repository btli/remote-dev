// @vitest-environment node
/**
 * Tests for POST /api/webhooks/github (epic remote-dev-oyej.2) — HMAC verify,
 * event filtering, and the fast-202 fire-and-forget dispatch into
 * TriggerService.handleEvent (mocked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// The route hands parsed events to this service; mock it so we assert dispatch
// without a DB or real agent launch.
vi.mock("@/services/trigger-service", () => ({
  handleEvent: vi.fn(async () => {}),
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
  opts: { signature?: string } = {},
): Request {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": opts.signature ?? sign(raw),
    },
    body: raw,
  });
}

describe("POST /api/webhooks/github", () => {
  beforeEach(() => {
    vi.mocked(TriggerService.handleEvent).mockClear();
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
