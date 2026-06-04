/**
 * Centralized model-key proxy route.
 *
 * Flow: per-session token auth → (Anthropic) body sanitize → resolve the REAL
 * provider key server-side → forward upstream via `fetch` → stream the SSE body
 * straight back to the agent (no buffering) while metering usage off to the
 * side.
 *
 * SECURITY (graded): the real provider key NEVER touches the logger and NEVER
 * appears in any response body. The agent only ever holds its `mp_…` proxy
 * token, which the upstream never sees.
 *
 * Feature-flagged OFF by default (`RDV_MODEL_PROXY_ENABLED !== "1"` → 404), so
 * when disabled this route is inert and behavior is byte-identical to today.
 */
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getProvider, type ProviderSpec } from "@/lib/model-proxy/providers";
import { sanitizeAnthropicBody } from "@/lib/model-proxy/sanitize";
import { meterAnthropicSse } from "@/lib/model-proxy/sse-meter";
import { resolveProviderKey } from "@/services/model-provider-resolver";
import {
  authenticateProxyToken,
  type ProxyPrincipal,
} from "@/services/model-proxy-token-service";
import { recordUsage } from "@/services/model-usage-service";
import type { MeteredUsage } from "@/lib/model-proxy/sse-meter";
import {
  allowRequest,
  cacheGet,
  cacheSet,
  cacheKey,
} from "@/services/model-proxy-cache";

const log = createLogger("api/model-proxy");

// Never let Next.js cache or statically optimize the proxy route itself.
export const dynamic = "force-dynamic";

/**
 * Meter usage from a non-streaming JSON response body (Anthropic returns the
 * top-level `usage` on the message). Fire-and-forget; never throws into the
 * response path and never logs the body/key.
 */
function meterFromJson(principal: ProxyPrincipal, provider: string, text: string): void {
  try {
    const parsed = JSON.parse(text) as {
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    const u = parsed.usage;
    if (!u) return;
    const usage: MeteredUsage = {
      model: parsed.model ?? null,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    };
    void recordUsage(principal, provider, usage).catch(() => {});
  } catch {
    // Non-JSON or error body — nothing to meter.
  }
}

function buildUpstreamHeaders(spec: ProviderSpec, request: Request, realKey: string): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  for (const [k, v] of Object.entries(spec.staticHeaders ?? {})) headers.set(k, v);
  // Forward the streaming Accept so the upstream returns SSE.
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (spec.authHeader === "authorization") {
    headers.set("authorization", `${spec.authScheme ?? "Bearer"} ${realKey}`);
  } else {
    headers.set(spec.authHeader, realKey);
  }
  return headers;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string; path: string[] }> },
): Promise<Response> {
  if (process.env.RDV_MODEL_PROXY_ENABLED !== "1") {
    return NextResponse.json({ error: "model proxy disabled" }, { status: 404 });
  }

  const { provider, path } = await ctx.params;
  const spec = getProvider(provider);
  if (!spec) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  const principal: ProxyPrincipal | null = await authenticateProxyToken(request, spec.id);
  if (!principal) {
    return NextResponse.json(
      { error: "Unauthorized", code: "PROXY_TOKEN_INVALID" },
      { status: 401 },
    );
  }

  // Per-token (fall back to user) token-bucket rate limit. Reject early so a
  // limited request never spends an upstream call or key lookup.
  const rlKey = principal.tokenId || principal.userId;
  if (!allowRequest(rlKey)) {
    return NextResponse.json(
      { error: "rate limited", code: "PROXY_RATE_LIMITED" },
      { status: 429 },
    );
  }

  // Resolve the REAL key server-side. NEVER log it.
  const realKey = await resolveProviderKey(spec, principal);
  if (!realKey) {
    log.error("No provider key resolved", { provider: spec.id, sessionId: principal.sessionId });
    return NextResponse.json({ error: "provider key not configured" }, { status: 502 });
  }

  // Parse → sanitize (Anthropic cache_control.scope) → re-serialize. Also sniff
  // whether the caller asked for streaming + whether sampling is deterministic
  // (temperature 0), which gate the response cache.
  const raw = await request.text();
  let bodyOut = raw;
  let wantsStream = false;
  let deterministic = false;
  try {
    const parsed = JSON.parse(raw) as { stream?: unknown; temperature?: unknown };
    wantsStream = parsed.stream === true;
    deterministic = parsed.temperature === 0;
    bodyOut = JSON.stringify(spec.id === "anthropic" ? sanitizeAnthropicBody(parsed) : parsed);
  } catch {
    // Non-JSON body (rare) — forward as-is.
  }

  // Response cache: ONLY for non-streaming, deterministic requests, and only
  // when enabled (TTL>0, off by default). A cache hit bypasses upstream + meter
  // (no upstream cost is incurred). Keyed on the caller's tenant scope +
  // provider + sanitized body, so a cached completion is never served across
  // tenants under multi-instance hosting.
  const cacheable = !wantsStream && deterministic;
  const ck = cacheable
    ? cacheKey(
        { userId: principal.userId, instanceSlug: principal.instanceSlug },
        spec.id,
        bodyOut,
      )
    : null;
  if (ck) {
    const hit = cacheGet(ck);
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: { "content-type": "application/json", "x-rdv-proxy-cache": "hit" },
      });
    }
  }

  const url = `${spec.upstreamBase}/${path.join("/")}`;
  const headers = buildUpstreamHeaders(spec, request, realKey);

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: bodyOut });
  } catch (error) {
    // String(error) is a fetch/network message — it never contains the key.
    log.error("Upstream fetch failed", { provider: spec.id, error: String(error) });
    return NextResponse.json({ error: "upstream request failed" }, { status: 502 });
  }

  // Streaming SSE: pass straight through, metering off to the side. (Never cached.)
  if (upstream.body && upstream.headers.get("content-type")?.includes("event-stream")) {
    const { stream, usage } = meterAnthropicSse(upstream.body);
    usage.then((u) => recordUsage(principal, spec.id, u)).catch(() => {});
    return new Response(stream, {
      status: upstream.status,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }

  // Non-streaming JSON: forward verbatim + meter from the parsed body.
  const text = await upstream.text();
  meterFromJson(principal, spec.id, text);
  if (ck && upstream.ok) {
    cacheSet(ck, { body: text, status: upstream.status });
  }
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
