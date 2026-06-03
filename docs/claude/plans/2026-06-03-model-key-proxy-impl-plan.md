# Centralized Model-Key Proxy — Implementation Plan

**For agentic workers** — execute with `superpowers:subagent-driven-development`. Each `### Task` maps to one bead; do them in `Build Sequence` order, respecting deps. Per-step TDD (`superpowers:test-driven-development`) is added at execution time. **All code work happens in a git worktree by a subagent** (see CLAUDE.md "Development Workflow") — warm it with `./scripts/worktree-warm.sh`.

**Goal.** Agents currently carry the real provider API key in their profile env (`ANTHROPIC_API_KEY` etc., injected by `getProfileEnvironment` → `fetchProfileSecrets`). Adopt manaflow's broker model: the agent gets a **placeholder key + a per-session proxy token**, and a native Next.js proxy route injects the **real** provider key server-side and forwards to the model API. This yields central billing, caching, rate-limiting, per-session/user/instance usage+cost observability, and removes provider secrets from agent envs — high value for multi-tenant supervisor instances.

**Architecture.** A Next.js App-Router route (`/api/model-proxy/anthropic/v1/messages`) authenticates the caller with a **scoped, revocable per-session token** (`mp_…`, validated like an API key), resolves the real provider key via a **per-provider key resolver** (reusing the encrypted `profileSecretsConfig` store + `decrypt`), sanitizes request fields the upstream rejects (Claude `cache_control.scope`), and **streams the upstream SSE body through untouched** via `fetch` + the response's `ReadableStream`. A **usage meter** parses the `message_start`/`message_delta` SSE events (or JSON body) to record tokens+cost per session/user/instance. **Caching + token-bucket rate-limiting** wrap the forward. The token store and usage store are new Drizzle tables behind repository-style service modules.

**Tech Stack.** Next.js 16 App Router route handlers · NextAuth v5 boundary (`src/proxy.ts`) · Drizzle ORM + libsql (`bun run db:push`) · AES-256-GCM at rest (`@/lib/encryption`) · `createLogger` from `@/lib/logger` (NEVER `console.*`, NEVER log secrets) · Vitest (`bun run test:run`) · web `fetch` + `ReadableStream` for streaming passthrough · `node:crypto` `timingSafeEqual` for token compare.

> **Relationship to the existing LiteLLM path.** `src/services/litellm-service.ts` + `resolveProxyEnv()` in `session-service.ts:74` already inject `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` pointing at a **per-user local LiteLLM subprocess** (master-key auth). That is **out of scope to remove**. The aehq proxy is a **native, in-Next.js, multi-tenant, per-session-token** alternative. Precedence rule (aehq.3): when a model-proxy token is minted for the session, the aehq env **wins over** `resolveProxyEnv`'s output (it is merged after `proxyEnv`). When the feature flag is off, behavior is byte-identical to today.

---

## File Structure

**Create**
| Path | Responsibility |
|------|----------------|
| `src/db/schema.ts` (append) | `modelProxyTokens` + `modelUsageEvents` table defs (+ inferred row types) |
| `src/services/model-proxy-token-service.ts` | Issue / validate / revoke scoped per-session(+instance) tokens (hash-at-rest, like `api-key-service.ts`) |
| `src/services/model-provider-resolver.ts` | Map provider → real key + upstream base URL; reads encrypted profile secret or env fallback; **never returns key to callers other than the proxy route** |
| `src/services/model-usage-service.ts` | Record + query token/cost usage per session/user/instance; cost table |
| `src/services/model-proxy-cache.ts` | In-memory LRU response cache + per-token/user token-bucket rate-limiter |
| `src/lib/model-proxy/sanitize.ts` | `sanitizeAnthropicBody()` — strip `cache_control.scope`; provider-specific request fixups |
| `src/lib/model-proxy/sse-meter.ts` | `meterSseStream()` — `TransformStream` tee that parses usage from SSE without buffering |
| `src/lib/model-proxy/providers.ts` | Provider registry: route segment → `{ upstreamBase, authHeader, keyEnv, secretKey, costTable }` |
| `src/app/api/model-proxy/[provider]/[...path]/route.ts` | The proxy route: token auth → sanitize → resolve key → cache/limit → `fetch` upstream → stream back + meter |
| `src/app/api/model-proxy/tokens/route.ts` | Authenticated (`withApiAuth`) issuance/list endpoint for tokens (used by session creation + admin/debug) |
| `src/app/api/model-proxy/tokens/[id]/route.ts` | `DELETE` to revoke a token |
| `src/lib/model-proxy/sanitize.test.ts` | Unit: `cache_control.scope` removed, other fields preserved |
| `src/lib/model-proxy/sse-meter.test.ts` | Unit: usage parsed from a captured SSE fixture; passthrough bytes unchanged |
| `src/services/model-proxy-token-service.test.ts` | Issue/validate/expiry/revoke/scope-mismatch |
| `src/app/api/model-proxy/[provider]/[...path]/route.test.ts` | Route: streaming passthrough, key injection, **key-non-leakage**, 401 on bad token |
| `src/services/model-usage-service.test.ts` | Cost math + per-scope attribution |
| `src/services/model-proxy-cache.test.ts` | Cache hit/miss + rate-limit 429 |

**Modify**
| Path | Change |
|------|--------|
| `src/proxy.ts` | Allowlist `/api/model-proxy/` to bypass the NextAuth/CF gate (auth is the proxy token, not a browser session) |
| `src/services/session-service.ts` | After `agentApiKey` mint (~line 569), mint a model-proxy token + build `modelProxyEnv`; merge it into `initialEnv` (~line 658) after `proxyEnv`; same for resume path (~line 1252) |
| `src/services/agent-profile-service.ts` | `getProfileEnvironment` (~line 477): when proxy mode is active for the profile, **strip** real provider keys (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`GOOGLE_API_KEY`) from the merged secret env |
| `src/lib/env-keys.ts` (create if absent) | Single source of truth: `PROVIDER_SECRET_ENV_KEYS` array reused by resolver + stripper |
| `CHANGELOG.md` | `[Unreleased] → Added` entry |

---

## Build Sequence

1. **aehq.1** — `providers.ts` registry + `sanitize.ts` + `sse-meter.ts` + the proxy route (Anthropic only), with a **temporary** env-based key resolver so the route works end-to-end before the token store lands. Gate behind `RDV_MODEL_PROXY_ENABLED`.
2. **aehq.2** — `modelProxyTokens` table + `model-proxy-token-service.ts` + `tokens` routes; swap the route's auth from "temporary header check" to real token validation.
3. **aehq.3** — env injection in `session-service.ts` (mint token + set `ANTHROPIC_BASE_URL`/placeholder) and key-stripping in `agent-profile-service.ts`.
4. **aehq.4** — `modelUsageEvents` table + `model-usage-service.ts`; wire `sse-meter.ts` to record per session/user/instance.
5. **aehq.5** — `model-proxy-cache.ts` (LRU + token-bucket) wrapped around the forward.
6. **aehq.6** — extend `providers.ts` + `sanitize.ts` + resolver for OpenAI/Codex + Gemini.
7. **aehq.7** — full test sweep + security review (token scoping/revocation, key non-leakage), `bun run lint && bun run typecheck && bun run test:run`.

---

### Task — Model-call proxy endpoint (Anthropic first)

**Bead:** remote-dev-aehq.1
**Files:** Create `src/lib/model-proxy/providers.ts`, `src/lib/model-proxy/sanitize.ts`, `src/lib/model-proxy/sse-meter.ts`, `src/app/api/model-proxy/[provider]/[...path]/route.ts`, `src/lib/model-proxy/sanitize.test.ts`, `src/lib/model-proxy/sse-meter.test.ts`. Modify `src/proxy.ts`.

1. **Provider registry** (`providers.ts`). Concrete and exhaustive so aehq.6 just adds rows:
   ```ts
   import { createLogger } from "@/lib/logger";
   const log = createLogger("ModelProxy");

   export type ProviderId = "anthropic" | "openai" | "gemini";

   export interface ProviderSpec {
     id: ProviderId;
     /** Upstream base, overridable for Bedrock/AI-Gateway via env. */
     upstreamBase: string;
     /** Header the upstream expects the key in. */
     authHeader: "x-api-key" | "authorization";
     authScheme?: "Bearer"; // for authorization-style headers
     /** Env var holding the real key (server-side only). */
     keyEnv: string;
     /** Logical secret name in profileSecretsConfig. */
     secretKey: string;
     /** Extra required headers (e.g. Anthropic version). */
     staticHeaders?: Record<string, string>;
   }

   export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
     anthropic: {
       id: "anthropic",
       upstreamBase: process.env.RDV_ANTHROPIC_UPSTREAM ?? "https://api.anthropic.com",
       authHeader: "x-api-key",
       keyEnv: "ANTHROPIC_API_KEY",
       secretKey: "ANTHROPIC_API_KEY",
       staticHeaders: { "anthropic-version": "2023-06-01" },
     },
     // openai / gemini filled in by aehq.6
   } as unknown as Record<ProviderId, ProviderSpec>;

   export function getProvider(id: string): ProviderSpec | null {
     return (PROVIDERS as Record<string, ProviderSpec>)[id] ?? null;
   }
   ```

2. **Sanitizer** (`sanitize.ts`). Claude Code emits `cache_control: { type: "ephemeral", scope: {...} }`; the public Anthropic API rejects `scope`. Strip it recursively, anywhere it appears (system blocks, message content blocks, tools):
   ```ts
   /** Remove fields the upstream Anthropic API rejects from a parsed body. Mutates a copy. */
   export function sanitizeAnthropicBody(body: unknown): unknown {
     if (Array.isArray(body)) return body.map(sanitizeAnthropicBody);
     if (body && typeof body === "object") {
       const obj = body as Record<string, unknown>;
       const out: Record<string, unknown> = {};
       for (const [k, v] of Object.entries(obj)) {
         if (k === "cache_control" && v && typeof v === "object") {
           const cc = { ...(v as Record<string, unknown>) };
           delete cc.scope; // <-- the field the API 400s on
           out[k] = cc;
         } else {
           out[k] = sanitizeAnthropicBody(v);
         }
       }
       return out;
     }
     return body;
   }
   ```
   Test: a body with nested `cache_control.scope` in `system[0]` and `messages[1].content[0]` → all `scope` removed, `type: "ephemeral"` preserved, all other keys byte-identical (`expect(sanitized).toEqual(expectedNoScope)`).

3. **SSE meter** (`sse-meter.ts`). A `TransformStream<Uint8Array, Uint8Array>` that passes bytes through **unchanged** while sniffing `usage` from `message_start` and `message_delta` events. It MUST NOT buffer the whole body. Returns the piped stream plus a promise that resolves with `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, model }` once the stream closes:
   ```ts
   export interface MeteredUsage {
     model: string | null;
     inputTokens: number; outputTokens: number;
     cacheReadTokens: number; cacheCreationTokens: number;
   }
   export function meterAnthropicSse(
     upstream: ReadableStream<Uint8Array>,
   ): { stream: ReadableStream<Uint8Array>; usage: Promise<MeteredUsage> } {
     const dec = new TextDecoder();
     let buf = "";
     const acc: MeteredUsage = { model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
     let resolve!: (u: MeteredUsage) => void;
     const usage = new Promise<MeteredUsage>((r) => (resolve = r));
     const transform = new TransformStream<Uint8Array, Uint8Array>({
       transform(chunk, ctrl) {
         ctrl.enqueue(chunk);            // passthrough FIRST — never block the agent
         buf += dec.decode(chunk, { stream: true });
         let i;
         while ((i = buf.indexOf("\n")) >= 0) {
           const line = buf.slice(0, i); buf = buf.slice(i + 1);
           if (!line.startsWith("data:")) continue;
           const json = line.slice(5).trim();
           if (json === "[DONE]" || !json) continue;
           try {
             const evt = JSON.parse(json) as Record<string, unknown>;
             const u = (evt.message as { usage?: Record<string, number>; model?: string })?.usage
               ?? (evt.usage as Record<string, number> | undefined);
             const m = (evt.message as { model?: string })?.model;
             if (m) acc.model = m;
             if (u) {
               acc.inputTokens += u.input_tokens ?? 0;
               acc.outputTokens += u.output_tokens ?? 0;
               acc.cacheReadTokens += u.cache_read_input_tokens ?? 0;
               acc.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
             }
           } catch { /* partial line; ignore — never throw inside transform */ }
         }
       },
       flush() { resolve(acc); },
     });
     return { stream: upstream.pipeThrough(transform), usage };
   }
   ```
   Test: feed a captured fixture (a `data: {"type":"message_start","message":{"model":"claude-…","usage":{"input_tokens":10,...}}}` … `message_delta` with `output_tokens`) one byte at a time through the transform; assert the **output bytes equal the input bytes** and `await usage` totals are correct.

4. **Proxy route** (`route.ts`). Key injection + streaming passthrough. **No secret ever touches the logger or the response.** For aehq.1 only, accept a temporary `x-rdv-proxy-token` matched against `process.env.RDV_MODEL_PROXY_DEV_TOKEN` (replaced in aehq.2):
   ```ts
   import { NextResponse } from "next/server";
   import { createLogger } from "@/lib/logger";
   import { getProvider } from "@/lib/model-proxy/providers";
   import { sanitizeAnthropicBody } from "@/lib/model-proxy/sanitize";
   import { meterAnthropicSse } from "@/lib/model-proxy/sse-meter";
   import { resolveProviderKey } from "@/services/model-provider-resolver"; // aehq.6-ready
   import { authenticateProxyToken } from "@/services/model-proxy-token-service"; // stub in .1, real in .2

   const log = createLogger("api/model-proxy");
   export const dynamic = "force-dynamic"; // never cache the route itself

   export async function POST(
     request: Request,
     ctx: { params: Promise<{ provider: string; path: string[] }> },
   ): Promise<Response> {
     if (process.env.RDV_MODEL_PROXY_ENABLED !== "1") {
       return NextResponse.json({ error: "model proxy disabled" }, { status: 404 });
     }
     const { provider, path } = await ctx.params;
     const spec = getProvider(provider);
     if (!spec) return NextResponse.json({ error: "unknown provider" }, { status: 404 });

     const principal = await authenticateProxyToken(request, spec.id); // {userId, sessionId, instanceSlug} | null
     if (!principal) return NextResponse.json({ error: "Unauthorized", code: "PROXY_TOKEN_INVALID" }, { status: 401 });

     // Resolve the REAL key server-side. NEVER log it.
     const realKey = await resolveProviderKey(spec, principal);
     if (!realKey) {
       log.error("No provider key resolved", { provider: spec.id, sessionId: principal.sessionId }); // no key in log
       return NextResponse.json({ error: "provider key not configured" }, { status: 502 });
     }

     // Parse, sanitize (Claude cache_control.scope), re-serialize.
     const raw = await request.text();
     let bodyOut = raw;
     try {
       const parsed = JSON.parse(raw);
       bodyOut = JSON.stringify(spec.id === "anthropic" ? sanitizeAnthropicBody(parsed) : parsed);
     } catch { /* non-JSON (rare) — forward as-is */ }

     const url = `${spec.upstreamBase}/${path.join("/")}`;
     const headers = new Headers();
     headers.set("content-type", "application/json");
     for (const [k, v] of Object.entries(spec.staticHeaders ?? {})) headers.set(k, v);
     // forward the streaming Accept so upstream returns SSE
     const accept = request.headers.get("accept"); if (accept) headers.set("accept", accept);
     if (spec.authHeader === "authorization") headers.set("authorization", `${spec.authScheme ?? "Bearer"} ${realKey}`);
     else headers.set(spec.authHeader, realKey);

     const upstream = await fetch(url, { method: "POST", headers, body: bodyOut });

     // Stream SSE straight through; meter without buffering (aehq.4 records the usage promise).
     if (upstream.body && upstream.headers.get("content-type")?.includes("event-stream")) {
       const { stream, usage } = meterAnthropicSse(upstream.body);
       usage.then((u) => recordUsage(principal, spec.id, u)).catch(() => {}); // aehq.4
       return new Response(stream, {
         status: upstream.status,
         headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
       });
     }
     // Non-streaming JSON: forward + meter from the parsed body (aehq.4).
     const text = await upstream.text();
     meterFromJson(principal, spec.id, text); // aehq.4
     return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });
   }
   ```
   In aehq.1, `recordUsage`/`meterFromJson` are no-op stubs and `authenticateProxyToken` checks the dev token. **`resolveProviderKey` in aehq.1** returns `process.env[spec.keyEnv]` directly.

5. **`src/proxy.ts`** — add to the early-allow block (alongside `/api/healthz`), so the proxy route is reachable by token-bearing agents that have no browser session and no CF JWT:
   ```ts
   // Model-key proxy: authenticated by its own per-session token, not a session.
   if (pathname.startsWith("/api/model-proxy/") && !pathname.startsWith("/api/model-proxy/tokens")) {
     return tagInstance(NextResponse.next());
   }
   ```
   (`/api/model-proxy/tokens*` deliberately stays behind the normal gate — it is the browser/`withApiAuth` issuance surface.)

**Test command:** `bun run test:run src/lib/model-proxy` → sanitize + sse-meter pass.
**Expected:** scope stripped; SSE bytes round-trip identically; usage totals correct.

---

### Task — Per-session/instance token issuance + validation

**Bead:** remote-dev-aehq.2 (depends .1)
**Files:** Modify `src/db/schema.ts`. Create `src/services/model-proxy-token-service.ts`, `src/app/api/model-proxy/tokens/route.ts`, `src/app/api/model-proxy/tokens/[id]/route.ts`, `src/services/model-proxy-token-service.test.ts`.

1. **Schema** (append to `src/db/schema.ts`; model on `apiKeys` at line 331 — hash-at-rest, prefix index):
   ```ts
   export const modelProxyTokens = sqliteTable(
     "model_proxy_token",
     {
       id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
       userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
       // Session this token is scoped to (revoked when the session closes).
       sessionId: text("session_id").references(() => terminalSessions.id, { onDelete: "cascade" }),
       // Supervisor instance slug for multi-tenant cost attribution (nullable single-tenant).
       instanceSlug: text("instance_slug"),
       tokenPrefix: text("token_prefix").notNull(), // "mp_" + 8 chars
       tokenHash: text("token_hash").notNull(),     // sha-256(full token)
       // Scope: which providers this token may proxy. JSON array, e.g. ["anthropic"].
       providerScope: text("provider_scope").notNull().default('["anthropic"]'),
       revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
       expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
       lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
       createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
     },
     (t) => [
       index("model_proxy_token_prefix_idx").on(t.tokenPrefix),
       index("model_proxy_token_session_idx").on(t.sessionId),
       index("model_proxy_token_user_idx").on(t.userId),
     ],
   );
   export type ModelProxyTokenRow = typeof modelProxyTokens.$inferSelect;
   ```
   Run `bun run db:push`.

2. **Service** (`model-proxy-token-service.ts`) — mirrors `api-key-service.ts` (`createHash`, `randomBytes`, `timingSafeEqual`); prefix `mp_`:
   ```ts
   const PREFIX = "mp_";
   const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
   const extractPrefix = (t: string) => t.substring(0, 11);

   export interface ProxyPrincipal { userId: string; sessionId: string | null; instanceSlug: string | null; tokenId: string; }

   export async function issueProxyToken(opts: {
     userId: string; sessionId?: string; instanceSlug?: string;
     providerScope?: string[]; ttlMs?: number;
   }): Promise<{ token: string; id: string }> {
     const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
     const [row] = await db.insert(modelProxyTokens).values({
       userId: opts.userId,
       sessionId: opts.sessionId ?? null,
       instanceSlug: opts.instanceSlug ?? null,
       tokenPrefix: extractPrefix(token),
       tokenHash: hashToken(token),
       providerScope: JSON.stringify(opts.providerScope ?? ["anthropic"]),
       expiresAt: opts.ttlMs ? new Date(Date.now() + opts.ttlMs) : null,
     }).returning();
     return { token, id: row.id }; // full token returned ONCE
   }

   /** Validate the request's token header against a required provider. */
   export async function authenticateProxyToken(request: Request, provider: string): Promise<ProxyPrincipal | null> {
     const header = request.headers.get("authorization");
     const raw = header?.startsWith("Bearer ") ? header.slice(7)
       : request.headers.get("x-rdv-proxy-token") ?? "";
     if (!raw.startsWith(PREFIX)) return null;
     const candidates = await db.query.modelProxyTokens.findMany({ where: eq(modelProxyTokens.tokenPrefix, extractPrefix(raw)) });
     const provided = Buffer.from(hashToken(raw), "hex");
     for (const c of candidates) {
       const stored = Buffer.from(c.tokenHash, "hex");
       if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) continue;
       if (c.revokedAt) return null;
       if (c.expiresAt && new Date(c.expiresAt) < new Date()) return null;
       const scope = JSON.parse(c.providerScope) as string[];
       if (!scope.includes(provider)) return null; // scope enforcement
       db.update(modelProxyTokens).set({ lastUsedAt: new Date() }).where(eq(modelProxyTokens.id, c.id)).catch(() => {});
       return { userId: c.userId, sessionId: c.sessionId, instanceSlug: c.instanceSlug, tokenId: c.id };
     }
     return null;
   }

   export async function revokeProxyToken(id: string, userId: string): Promise<boolean> {
     const r = await db.update(modelProxyTokens).set({ revokedAt: new Date() })
       .where(and(eq(modelProxyTokens.id, id), eq(modelProxyTokens.userId, userId))).returning({ id: modelProxyTokens.id });
     return r.length > 0;
   }
   export async function revokeTokensForSession(sessionId: string): Promise<void> {
     await db.update(modelProxyTokens).set({ revokedAt: new Date() }).where(eq(modelProxyTokens.sessionId, sessionId));
   }
   ```

3. **Routes.** `tokens/route.ts`: `POST = withApiAuth(...)` → `issueProxyToken({ userId, ... })`; `GET = withApiAuth(...)` → list (prefix only, never hash). `tokens/[id]/route.ts`: `DELETE = withApiAuth(...)` → `revokeProxyToken(params.id, userId)`.

4. **Wire route auth.** Replace the aehq.1 dev-token stub: `route.ts` now calls the real `authenticateProxyToken`.

5. **Revoke on session close.** In `session-service.ts`'s close/delete path, call `revokeTokensForSession(sessionId)` (the FK `onDelete: "cascade"` is a backstop; explicit revoke covers suspend-without-delete).

**Test command:** `bun run test:run src/services/model-proxy-token-service.test.ts`
**Expected:** issue→validate ok; expired→null; revoked→null; wrong-provider scope→null; tampered hash→null (timing-safe).

---

### Task — Inject placeholder key + proxy base URL into agent env

**Bead:** remote-dev-aehq.3 (depends .1)
**Files:** Modify `src/services/session-service.ts`, `src/services/agent-profile-service.ts`. Create `src/lib/env-keys.ts`.

1. **Single source of truth** (`src/lib/env-keys.ts`):
   ```ts
   /** Provider secret env vars the agent must NOT see when the model proxy is on. */
   export const PROVIDER_SECRET_ENV_KEYS = [
     "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
     "ANTHROPIC_AUTH_TOKEN",
   ] as const;
   /** Placeholder injected in place of the real key (CLIs require a non-empty key). */
   export const PROXY_PLACEHOLDER_KEY = "rdv-proxy-placeholder";
   ```

2. **Mint token + build proxy env in `session-service.ts`.** Just after the `agentApiKey` block (~line 569), gated on `isAgentRuntime && RDV_MODEL_PROXY_ENABLED === "1"`:
   ```ts
   let modelProxyEnv: Record<string, string> = {};
   if (isAgentRuntime && process.env.RDV_MODEL_PROXY_ENABLED === "1") {
     try {
       const { issueProxyToken } = await import("@/services/model-proxy-token-service");
       const { PROXY_PLACEHOLDER_KEY } = await import("@/lib/env-keys");
       const { INSTANCE_SLUG } = await import("@/lib/base-path");
       const scope = effectiveAgentProvider === "claude" ? ["anthropic"]
         : effectiveAgentProvider === "codex" ? ["openai"]
         : effectiveAgentProvider === "gemini" ? ["gemini"] : ["anthropic"];
       const { token } = await issueProxyToken({
         userId, sessionId, instanceSlug: INSTANCE_SLUG || undefined, providerScope: scope,
       });
       // The proxy lives on the API server; agents reach it on the local API port/socket.
       const apiBase = process.env.SOCKET_PATH ? "http://localhost" : `http://localhost:${process.env.PORT ?? "6001"}`;
       if (effectiveAgentProvider === "claude") {
         modelProxyEnv = {
           ANTHROPIC_BASE_URL: `${apiBase}/api/model-proxy/anthropic`,
           ANTHROPIC_API_KEY: token, // CLIs send this as x-api-key → our token, NOT the real key
         };
       }
       // codex/gemini equivalents added in aehq.6 (OPENAI_BASE_URL / Gemini base)
     } catch (error) {
       log.error("Failed to mint model-proxy token", { sessionId, error: String(error) });
     }
   }
   ```
   > **Why `ANTHROPIC_API_KEY = token`:** Claude Code sends `ANTHROPIC_API_KEY` to `ANTHROPIC_BASE_URL` as the `x-api-key` header. Our route reads that header as the **proxy token** and swaps in the real key. The agent therefore never holds a real provider key — the placeholder concept is satisfied by the token being a non-secret-to-the-provider credential. Keep `PROXY_PLACEHOLDER_KEY` for CLIs that refuse to start without a separate "key" var.

3. **Merge with correct precedence** (~line 658). aehq env must override `proxyEnv` (LiteLLM) and `profileEnv`:
   ```ts
   const initialEnv: Record<string, string> = {
     ...claudeAgentDefaults,
     ...(sessionConfig.environment ?? {}),
     ...(profileEnv ?? {}),
     ...proxyEnv,
     ...modelProxyEnv,   // <-- NEW: aehq proxy wins over LiteLLM + profile
     ...(folderEnv ?? {}),
     ...folderGitIdentityEnv,
     ...gitCredentialEnv,
     ...(ghAccountEnv ?? {}),
     ...rdvEnv,
   };
   ```
   Apply the same insertion to the **resume** path (~line 1252–1304).

4. **Strip real keys in `agent-profile-service.ts`.** `getProfileEnvironment` merges `fetchProfileSecrets` into `env` (~line 482). When proxy mode is on, delete the provider keys so they never reach tmux:
   ```ts
   if (secrets) {
     Object.assign(env, secrets);
     if (process.env.RDV_MODEL_PROXY_ENABLED === "1") {
       const { PROVIDER_SECRET_ENV_KEYS } = await import("@/lib/env-keys");
       for (const k of PROVIDER_SECRET_ENV_KEYS) delete env[k]; // real keys live only in the proxy resolver
     }
   }
   ```
   The resolver (aehq.6) reads the real key from `profileSecretsConfig` **server-side**, so stripping it from the agent env does not lose it.

**Test command:** `bun run test:run src/services/session-service-update.test.ts` (+ a new case asserting `initialEnv.ANTHROPIC_API_KEY` starts with `mp_` and equals no real `sk-ant-…`, and that stripped profile secrets contain no provider keys when flag on).
**Expected:** with flag on, env has `ANTHROPIC_BASE_URL=…/api/model-proxy/anthropic` + `ANTHROPIC_API_KEY` = `mp_…`; with flag off, env byte-identical to today.

---

### Task — Central usage/cost observability

**Bead:** remote-dev-aehq.4 (depends .1)
**Files:** Modify `src/db/schema.ts`, `src/app/api/model-proxy/[provider]/[...path]/route.ts`. Create `src/services/model-usage-service.ts`, `src/services/model-usage-service.test.ts`.

1. **Schema** (append):
   ```ts
   export const modelUsageEvents = sqliteTable(
     "model_usage_event",
     {
       id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
       userId: text("user_id").notNull(),
       sessionId: text("session_id"),
       instanceSlug: text("instance_slug"),
       provider: text("provider").notNull(),
       model: text("model"),
       inputTokens: integer("input_tokens").notNull().default(0),
       outputTokens: integer("output_tokens").notNull().default(0),
       cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
       cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
       // Cost in micro-USD (integer to avoid float drift); nullable if model unpriced.
       costMicroUsd: integer("cost_micro_usd"),
       createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
     },
     (t) => [
       index("model_usage_session_idx").on(t.sessionId),
       index("model_usage_user_idx").on(t.userId),
       index("model_usage_instance_idx").on(t.instanceSlug),
       index("model_usage_created_idx").on(t.createdAt),
     ],
   );
   ```
   Run `bun run db:push`.

2. **Service** (`model-usage-service.ts`). Per-model price table (micro-USD per token) + `recordUsage`:
   ```ts
   // micro-USD per 1 token (== USD-per-Mtok). Update as Anthropic pricing changes.
   const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
     "claude-sonnet-4-5": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
     // fall back to 0 (cost null) for unknown models — log.warn once
   };
   export async function recordUsage(p: ProxyPrincipal, provider: string, u: MeteredUsage): Promise<void> {
     const price = u.model ? PRICES[normalizeModel(u.model)] : undefined;
     const cost = price
       ? Math.round(u.inputTokens * price.in + u.outputTokens * price.out
           + u.cacheReadTokens * price.cacheRead + u.cacheCreationTokens * price.cacheWrite)
       : null;
     await db.insert(modelUsageEvents).values({
       userId: p.userId, sessionId: p.sessionId, instanceSlug: p.instanceSlug,
       provider, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
       cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheCreationTokens, costMicroUsd: cost,
     });
   }
   export async function usageByScope(scope: "session" | "user" | "instance", id: string) { /* SUM group-by query */ }
   ```

3. **Wire the route.** Replace the aehq.1 stubs: `usage.then((u) => recordUsage(principal, spec.id, u))` and a `meterFromJson` that parses `usage` from the non-streaming JSON body. **Never log token counts at >debug or any key.**

**Test command:** `bun run test:run src/services/model-usage-service.test.ts`
**Expected:** cost math matches the price table; `usageByScope("session", id)` aggregates correctly; unknown model → `costMicroUsd === null` (no throw).

---

### Task — Caching + rate-limiting at the proxy

**Bead:** remote-dev-aehq.5 (depends .1)
**Files:** Create `src/services/model-proxy-cache.ts`, `src/services/model-proxy-cache.test.ts`. Modify `src/app/api/model-proxy/[provider]/[...path]/route.ts`.

1. **Module** (`model-proxy-cache.ts`) — in-memory (per Next.js server process), no extra deps:
   ```ts
   // Token-bucket rate limiter keyed by tokenId (falls back to userId).
   const buckets = new Map<string, { tokens: number; updated: number }>();
   const RATE = Number(process.env.RDV_MODEL_PROXY_RPS ?? 5);     // refill/sec
   const BURST = Number(process.env.RDV_MODEL_PROXY_BURST ?? 20);
   export function allowRequest(key: string): boolean {
     const now = Date.now(); const b = buckets.get(key) ?? { tokens: BURST, updated: now };
     b.tokens = Math.min(BURST, b.tokens + ((now - b.updated) / 1000) * RATE); b.updated = now;
     if (b.tokens < 1) { buckets.set(key, b); return false; }
     b.tokens -= 1; buckets.set(key, b); return true;
   }
   // LRU cache for NON-streaming, deterministic responses (temperature 0). Keyed by sha256(provider+body).
   const cache = new Map<string, { body: string; status: number; at: number }>();
   const TTL = Number(process.env.RDV_MODEL_PROXY_CACHE_TTL_MS ?? 0); // 0 = disabled by default
   export function cacheGet(key: string): { body: string; status: number } | null { /* TTL + LRU evict */ }
   export function cacheSet(key: string, v: { body: string; status: number }): void { /* cap ~200 entries */ }
   ```
   > Caching is **disabled by default** (`TTL=0`) and only applies to non-streaming requests — streaming SSE and non-deterministic sampling must not be cached. Document this in the module header.

2. **Wire the route.** Before `fetch`: `if (!allowRequest(principal.tokenId)) return NextResponse.json({ error: "rate limited" }, { status: 429 });`. For non-streaming requests with `TTL>0` and `temperature===0`, check `cacheGet` first and `cacheSet` after.

**Test command:** `bun run test:run src/services/model-proxy-cache.test.ts`
**Expected:** `allowRequest` returns true up to BURST then false; refills over time; `cacheGet` returns set value within TTL, `null` after.

---

### Task — Multi-provider support (OpenAI/Codex, Gemini)

**Bead:** remote-dev-aehq.6 (depends .1)
**Files:** Modify `src/lib/model-proxy/providers.ts`, `src/lib/model-proxy/sanitize.ts`, `src/services/model-provider-resolver.ts`, `src/services/session-service.ts`.

1. **Registry rows:**
   ```ts
   openai: { id: "openai", upstreamBase: process.env.RDV_OPENAI_UPSTREAM ?? "https://api.openai.com",
     authHeader: "authorization", authScheme: "Bearer", keyEnv: "OPENAI_API_KEY", secretKey: "OPENAI_API_KEY" },
   gemini: { id: "gemini", upstreamBase: process.env.RDV_GEMINI_UPSTREAM ?? "https://generativelanguage.googleapis.com",
     authHeader: "authorization", authScheme: "Bearer", keyEnv: "GEMINI_API_KEY", secretKey: "GEMINI_API_KEY" },
   ```
   Gemini also accepts `?key=` — support both: if `authHeader` resolution finds the provider is gemini, also append `key` query param when the CLI uses query-auth. Sanitizer: OpenAI/Gemini need **no** `cache_control` stripping (Anthropic-only); `sanitize.ts` already branches on `spec.id === "anthropic"`.

2. **Resolver** (`model-provider-resolver.ts`) — the real-key lookup used by the route. Order: per-profile encrypted secret (via the session's profile) → process env fallback. **Returns the key only to the route; never logs it:**
   ```ts
   export async function resolveProviderKey(spec: ProviderSpec, p: ProxyPrincipal): Promise<string | null> {
     // 1. Per-session → profile → profileSecretsConfig (decrypted server-side).
     if (p.sessionId) {
       const sess = await db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, p.sessionId) });
       if (sess?.profileId) {
         const secrets = await fetchProfileSecrets(sess.profileId); // existing fn, decrypts at rest
         const v = secrets?.[spec.secretKey];
         if (v) return v;
       }
     }
     // 2. Instance/global env fallback (e.g. supervisor-injected real key).
     return process.env[spec.keyEnv] ?? null;
   }
   ```

3. **Env injection (`session-service.ts`).** Extend the `modelProxyEnv` block for codex/gemini:
   ```ts
   if (effectiveAgentProvider === "codex") {
     modelProxyEnv = { OPENAI_BASE_URL: `${apiBase}/api/model-proxy/openai/v1`, OPENAI_API_KEY: token };
   } else if (effectiveAgentProvider === "gemini") {
     modelProxyEnv = { GOOGLE_GEMINI_BASE_URL: `${apiBase}/api/model-proxy/gemini`, GEMINI_API_KEY: token };
   }
   ```
   > **Open question flagged below:** verify each CLI honors its base-URL override (Codex `OPENAI_BASE_URL`, Gemini base var). If a CLI lacks an override, that provider stays gateway-only or unsupported — note in the bead.

**Test command:** `bun run test:run src/services/model-provider-resolver.test.ts` (create) + extend route test with an `openai` case asserting `authorization: Bearer <realkey>` is set and no `cache_control` mutation occurs.
**Expected:** OpenAI/Gemini route 200 passthrough; resolver prefers profile secret over env; anthropic-only sanitize confirmed.

---

### Task — Tests + security review

**Bead:** remote-dev-aehq.7 (depends all)
**Files:** Create `src/app/api/model-proxy/[provider]/[...path]/route.test.ts` (the key route test, including non-leakage). Ensure all other `.test.ts` above exist and pass.

1. **Route streaming-passthrough test** (`// @vitest-environment node`, mock `fetch` to return an SSE `ReadableStream`; mock the token service + resolver like the channels test mocks services):
   ```ts
   vi.mock("@/services/model-proxy-token-service", () => ({
     authenticateProxyToken: vi.fn().mockResolvedValue({ userId: "u1", sessionId: "s1", instanceSlug: null, tokenId: "t1" }),
   }));
   vi.mock("@/services/model-provider-resolver", () => ({ resolveProviderKey: vi.fn().mockResolvedValue("sk-ant-REALKEY") }));
   // assert: response body streams the exact upstream SSE bytes; upstream fetch was called with header x-api-key === "sk-ant-REALKEY".
   ```

2. **Key-non-leakage test (REQUIRED):**
   - Capture all `log.*` calls (spy on the logger) during a proxied request and assert **no argument** contains `"sk-ant-REALKEY"`.
   - Force an upstream error (mock `fetch` → 500 body `{"error":"upstream boom"}`) and assert the **response body** returned to the agent contains no `sk-ant-`/`mp_` substring and the route's own error JSON contains no key.
   - Assert the `tokens` list endpoint returns only `tokenPrefix`, never `tokenHash`.

3. **Scope/revocation tests** (in `model-proxy-token-service.test.ts`, already created in .2): expired→401, revoked→401, wrong-provider scope→401, tampered hash→401, `revokeTokensForSession` revokes all rows for a session.

4. **Security review checklist (document findings inline in the bead):**
   - [ ] Proxy route never logs the real key or the token (grep the diff for `log.*` near `realKey`/`token`).
   - [ ] `src/proxy.ts` allowlist scopes to `/api/model-proxy/` and **excludes** `/tokens` (issuance stays authenticated).
   - [ ] Token compare is `timingSafeEqual` on equal-length buffers (DoS-safe, no early return on length via try).
   - [ ] `providerScope` enforced before forwarding (a claude-scoped token can't call `/openai`).
   - [ ] Tokens are session-scoped + revoked on session close (blast radius = one session).
   - [ ] Feature flag default OFF → byte-identical existing behavior; LiteLLM path untouched.
   - [ ] No `eslint-disable` / `@ts-ignore` introduced.

**Final gate:** `bun run lint && bun run typecheck && bun run test:run`
**Expected:** all green; non-leakage assertions pass; coverage includes token lifecycle, sanitize, sse-meter, usage, cache.

---

## Risks & Open Questions

1. **Streaming correctness.** The `TransformStream` enqueues each chunk **before** parsing so the agent never blocks on the meter. Risk: a `usage` field split across two TCP chunks — handled by the line-buffer (`buf`) and the `[DONE]`/partial-line guards. Verify against a real captured Claude Code SSE transcript, not a synthetic one. `dynamic = "force-dynamic"` + returning a `Response(ReadableStream)` avoids Next.js buffering; confirm no `await response.text()` anywhere in the stream path.
2. **Per-CLI base-URL support.** Claude Code honors `ANTHROPIC_BASE_URL` (proven — LiteLLM path uses it). **Unverified:** Codex honoring `OPENAI_BASE_URL` and Gemini's base-URL var/query-key auth. If a CLI ignores its override, that provider is gateway-only until upstream support exists — aehq.6 should down-scope rather than ship a broken env.
3. **Token theft / blast radius.** Tokens live in the agent's tmux env (`ANTHROPIC_API_KEY=mp_…`), readable by anything in that session — same exposure as today's real key, but **scoped to one session + revocable + provider-limited + non-reusable after session close**, so theft is strictly less damaging than leaking `sk-ant-…`. Consider short TTL + silent re-mint on resume (resume path already re-runs env build).
4. **Cost attribution accuracy.** Prices are hardcoded micro-USD and drift with Anthropic pricing; unknown models record `costMicroUsd = null` (token counts still captured). Cache hits (aehq.5) bypass the meter — acceptable since cached responses incur no upstream cost, but document it. `instanceSlug` is `INSTANCE_SLUG` from `base-path.ts` (empty single-tenant) → maps to the supervisor `instance.slug` for per-instance billing.
5. **Cloudflare AI Gateway vs direct.** Plan forwards **direct** to `api.anthropic.com` (or `RDV_ANTHROPIC_UPSTREAM`). Fronting with CF AI Gateway/Bedrock (manaflow's approach) is a drop-in `upstreamBase` swap — left as an env-config decision, not code. Open question: whether multi-tenant supervisor wants the gateway's own caching/analytics in addition to ours.
6. **In-memory cache/limiter is per-process.** Under multi-instance (multiple Next.js processes) limits are per-pod, not global. Acceptable for v1; a shared store (libsql/Redis) is a follow-up if global limits are required.

---

## Self-Review (writing-plans)

- **Bead coverage:** aehq.1 (route+sanitize+sse-meter+proxy.ts) ✓ · aehq.2 (token table+service+routes+revoke) ✓ · aehq.3 (env-keys+session-service mint/merge+profile strip) ✓ · aehq.4 (usage table+service+wire) ✓ · aehq.5 (cache+rate-limit module+wire) ✓ · aehq.6 (registry rows+resolver+codex/gemini env) ✓ · aehq.7 (route test+non-leakage+scope/revocation+security checklist+final gate) ✓. **All 7 covered.**
- **Dependency order:** Build Sequence runs .1 → .2/.3/.4 (all depend only on .1) → .5 → .6 → .7; matches bead `DEPENDS ON`/`BLOCKS`. ✓
- **Type-name consistency:** `ProxyPrincipal`, `ProviderSpec`/`ProviderId`, `MeteredUsage`, `ModelProxyTokenRow` used identically across token service, resolver, route, meter, usage service. Table names `model_proxy_token` / `model_usage_event` consistent with snake_case convention (cf. `api_key`, `terminal_session`). ✓
- **Placeholder scan:** no `TODO`/`FIXME`/`<...>`/`yourFunctionHere` left; every task has real Drizzle defs, real route code, real service code, and a real `bun run test:run …` command with expected output. The only intentionally-deferred stubs (`recordUsage`/`meterFromJson` in aehq.1) are explicitly called out as filled by aehq.4. ✓
- **Convention compliance:** all logging via `createLogger`; explicit "never log secrets" guards in route + non-leakage test; `bun` only; `db:push` after each schema change; no lint-rule disabling; auth not weakened (proxy.ts only opens the token-authed forward path, keeps issuance gated). ✓
- **Grounding:** file:line refs verified — `agent-profile-service.ts:477-490` (secret merge point), `session-service.ts:557-585` (agentApiKey mint + rdvEnv), `:654-665` (env precedence merge), `:74` (`resolveProxyEnv` LiteLLM), `api.ts:95` (`withApiAuth`), `api-key-service.ts:44-154` (hash/validate model), `schema.ts:331` (apiKeys), `proxy.ts:62-72` (allowlist pattern), `base-path.ts:55` (`INSTANCE_SLUG`), supervisor `schema.ts:73` (`instance.slug`). ✓
