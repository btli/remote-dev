/**
 * POST /api/webhooks/github (epic remote-dev-oyej.2)
 *
 * HMAC-SHA256 GitHub event webhook. Structurally mirrors `/api/deploy`:
 *   - raw-body read BEFORE JSON parse, HMAC over the raw bytes;
 *   - env-secret gate (503 when unconfigured);
 *   - fast 202 — the trigger dispatch is fire-and-forget so GitHub's ~10s
 *     delivery budget is never blocked on an agent launch.
 */
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { verifySignature, parseGithubEvent } from "@/lib/github-webhook-auth";
import * as TriggerService from "@/services/trigger-service";

const log = createLogger("api/webhooks/github");

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    log.error("GITHUB_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhooks not configured" },
      { status: 503 },
    );
  }

  // Raw body for HMAC — must be read before any JSON parse.
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(secret, rawBody, signature)) {
    log.warn("Invalid webhook signature", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const eventName = request.headers.get("x-github-event") ?? "";
  if (eventName === "ping") {
    return NextResponse.json({ message: "pong" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = parseGithubEvent(request.headers, body);

  // Replay dedupe: GitHub assigns a unique `X-GitHub-Delivery` UUID per delivery
  // and reuses it on redelivery (manual replay or its own retry). Claim it BEFORE
  // dispatch so a redelivery is a no-op — this covers issue/label/comment events
  // (headSha == null) that the per-(triggerConfig, headSha) agent-run unique index
  // cannot dedupe. A blank id (claimDelivery returns true) falls back to the
  // existing head-SHA guard. We await the claim (a single indexed upsert) before
  // the fire-and-forget dispatch so duplicates never reach handleEvent.
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  let firstDelivery = true;
  try {
    firstDelivery = await TriggerService.claimDelivery(deliveryId, event.event);
  } catch (err) {
    // A dedupe-store failure must not drop a legitimate delivery; fall through
    // and dispatch (the head-SHA unique index still guards push/PR/check events).
    log.warn("delivery dedupe check failed; processing without replay guard", {
      error: String(err),
      deliveryId,
      event: event.event,
    });
  }

  if (!firstDelivery) {
    log.info("duplicate webhook delivery ignored", {
      deliveryId,
      event: event.event,
      action: event.action ?? null,
    });
    return NextResponse.json(
      {
        message: "already processed",
        event: event.event,
        action: event.action ?? null,
      },
      { status: 200 },
    );
  }

  // Fire-and-forget so GitHub's delivery isn't blocked on agent launch.
  void TriggerService.handleEvent(event).catch((err) =>
    log.error("trigger dispatch failed", {
      error: String(err),
      event: event.event,
      action: event.action,
    }),
  );

  return NextResponse.json(
    { message: "accepted", event: event.event, action: event.action ?? null },
    { status: 202 },
  );
}
