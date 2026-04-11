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
  try {
    // Validate webhook secret if configured
    const expectedSecret = process.env.LITELLM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const providedSecret = request.headers.get("x-webhook-secret");
      if (providedSecret !== expectedSecret) {
        log.warn("Invalid webhook secret");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();

    // LiteLLM may send a single object or an array
    const payloads: LiteLLMWebhookPayload[] = Array.isArray(body)
      ? body
      : [body];

    LiteLLMAnalyticsService.recordBatch(payloads);

    log.debug("Webhook received", { count: payloads.length });
    return NextResponse.json({ received: payloads.length });
  } catch (error) {
    // Always return 200 to prevent LiteLLM from retrying on parse errors
    log.error("Webhook processing failed", { error: String(error) });
    return NextResponse.json({ received: 0 });
  }
}
