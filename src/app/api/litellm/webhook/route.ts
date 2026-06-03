import { NextResponse } from "next/server";
import * as LiteLLMAnalyticsService from "@/services/litellm-analytics-service";
import { createLogger } from "@/lib/logger";

import type { LiteLLMWebhookPayload } from "@/types/litellm";

const log = createLogger("api/litellm/webhook");

/**
 * POST /api/litellm/webhook - LiteLLM usage webhook receiver
 *
 * This endpoint does NOT use withAuth — it is called by the LiteLLM process,
 * not by a user session. Authentication is via the x-webhook-secret header.
 *
 * Body: LiteLLMWebhookPayload | LiteLLMWebhookPayload[]
 */
export async function POST(request: Request) {
  // Validate webhook secret if configured (before any body parsing).
  const expectedSecret = process.env.LITELLM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = request.headers.get("x-webhook-secret");
    if (providedSecret !== expectedSecret) {
      log.warn("Invalid webhook secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // JSON-parse / payload-validation errors → 200 so LiteLLM does NOT retry
  // (a malformed payload won't parse on a retry either; retrying just spins).
  let payloads: LiteLLMWebhookPayload[];
  try {
    const body = await request.json();
    // LiteLLM may send a single object or an array.
    payloads = Array.isArray(body) ? body : [body];
  } catch (error) {
    log.error("Webhook payload parse failed", { error: String(error) });
    return NextResponse.json({ received: 0 });
  }

  // Genuine INFRASTRUCTURE errors (analytics store/factory construction or an
  // unexpected throw on enqueue) → 500 so LiteLLM RETRIES. `recordBatch` is a
  // synchronous fire-and-forget enqueue, so this branch is reached only for
  // store-construction / unexpected failures, not transient DB hiccups.
  try {
    LiteLLMAnalyticsService.recordBatch(payloads);
  } catch (error) {
    log.error("Webhook processing failed (infrastructure error)", {
      error: String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  log.debug("Webhook received", { count: payloads.length });
  return NextResponse.json({ received: payloads.length });
}
