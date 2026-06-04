/**
 * Model usage + cost service for the centralized model-key proxy.
 *
 * Records one `model_usage_event` per proxied call (token counts metered off
 * the SSE stream / JSON body) and attributes it to session / user / instance
 * for central billing + observability. Cost is stored in integer micro-USD to
 * avoid float drift; unknown/unpriced models record `costMicroUsd = null` (the
 * token counts are still captured).
 *
 * SECURITY: this module records counts only — it never receives or logs a key
 * or token. Recording NEVER throws (a metering failure must not break the
 * agent's request).
 */
import { db } from "@/db";
import { modelUsageEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import type { ProxyPrincipal } from "@/services/model-proxy-token-service";
import type { MeteredUsage } from "@/lib/model-proxy/sse-meter";

const log = createLogger("ModelUsage");

interface ModelPrice {
  /** micro-USD per 1 token (== USD per 1M tokens). */
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Per-model price table (micro-USD per token). Update as provider pricing
 * changes. Keys are normalized model ids (see `normalizeModel`).
 */
const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-5": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-5": { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const warnedUnpriced = new Set<string>();

/**
 * Map a full upstream model id (e.g. `claude-sonnet-4-5-20250929`) to a price
 * table key by stripping a trailing `-YYYYMMDD` date snapshot. Returns the
 * input unchanged if there is no date suffix.
 */
export function normalizeModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/**
 * Compute the integer micro-USD cost for a metered usage, or `null` if the
 * model is unknown/unpriced. Pure — safe to unit-test.
 */
export function computeCostMicroUsd(model: string | null, u: MeteredUsage): number | null {
  if (!model) return null;
  const price = PRICES[normalizeModel(model)];
  if (!price) {
    if (!warnedUnpriced.has(model)) {
      warnedUnpriced.add(model);
      log.warn("Unpriced model — recording tokens with null cost", { model });
    }
    return null;
  }
  return Math.round(
    u.inputTokens * price.in +
      u.outputTokens * price.out +
      u.cacheReadTokens * price.cacheRead +
      u.cacheCreationTokens * price.cacheWrite,
  );
}

/**
 * Persist a usage event. NEVER throws — a recording failure is logged and
 * swallowed so it cannot break the proxied request.
 */
export async function recordUsage(
  p: ProxyPrincipal,
  provider: string,
  u: MeteredUsage,
): Promise<void> {
  try {
    const cost = computeCostMicroUsd(u.model, u);
    await db.insert(modelUsageEvents).values({
      userId: p.userId,
      sessionId: p.sessionId,
      instanceSlug: p.instanceSlug,
      provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheCreationTokens: u.cacheCreationTokens,
      costMicroUsd: cost,
    });
  } catch (error) {
    log.error("Failed to record model usage", {
      provider,
      sessionId: p.sessionId,
      error: String(error),
    });
  }
}

export interface UsageAggregate {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Sum of priced events' cost (micro-USD); 0 if none priced. */
  costMicroUsd: number;
}

/**
 * Aggregate usage for a scope. `id` is the session id / user id / instance slug
 * depending on `scope`.
 */
export async function usageByScope(
  scope: "session" | "user" | "instance",
  id: string,
): Promise<UsageAggregate> {
  const col =
    scope === "session"
      ? modelUsageEvents.sessionId
      : scope === "user"
        ? modelUsageEvents.userId
        : modelUsageEvents.instanceSlug;

  const rows = await db.select().from(modelUsageEvents).where(eq(col, id));

  const agg: UsageAggregate = {
    events: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicroUsd: 0,
  };
  for (const r of rows) {
    agg.events += 1;
    agg.inputTokens += r.inputTokens;
    agg.outputTokens += r.outputTokens;
    agg.cacheReadTokens += r.cacheReadTokens;
    agg.cacheCreationTokens += r.cacheCreationTokens;
    agg.costMicroUsd += r.costMicroUsd ?? 0;
  }
  return agg;
}
