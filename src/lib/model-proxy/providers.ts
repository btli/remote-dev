/**
 * Provider registry for the centralized model-key proxy.
 *
 * Each row maps a route segment (`/api/model-proxy/<provider>/...`) to the
 * upstream base URL, the header the upstream expects the real key in, the
 * server-side env var that may hold the real key, and the logical secret name
 * looked up in the encrypted `profileSecretsConfig` store.
 *
 * aehq.6 adds `openai` / `gemini` rows; the proxy route + resolver are written
 * generically so adding a row is all that's required.
 */

export type ProviderId = "anthropic" | "openai" | "gemini";

export interface ProviderSpec {
  id: ProviderId;
  /** Upstream base, overridable (Bedrock / CF AI-Gateway) via env. */
  upstreamBase: string;
  /** Header the upstream expects the key in. */
  authHeader: "x-api-key" | "authorization" | "x-goog-api-key";
  /** For authorization-style headers (e.g. `Bearer <key>`). */
  authScheme?: "Bearer";
  /** Env var holding the real key (server-side only). */
  keyEnv: string;
  /** Logical secret name in profileSecretsConfig. */
  secretKey: string;
  /** Extra required headers (e.g. the Anthropic version pin). */
  staticHeaders?: Record<string, string>;
}

/**
 * NOTE: read `process.env` lazily via getters so tests / runtime overrides of
 * `RDV_*_UPSTREAM` are honored even after this module is first imported.
 */
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    get upstreamBase(): string {
      return process.env.RDV_ANTHROPIC_UPSTREAM ?? "https://api.anthropic.com";
    },
    authHeader: "x-api-key",
    keyEnv: "ANTHROPIC_API_KEY",
    secretKey: "ANTHROPIC_API_KEY",
    staticHeaders: { "anthropic-version": "2023-06-01" },
  } as ProviderSpec,
  openai: {
    id: "openai",
    get upstreamBase(): string {
      return process.env.RDV_OPENAI_UPSTREAM ?? "https://api.openai.com";
    },
    authHeader: "authorization",
    authScheme: "Bearer",
    keyEnv: "OPENAI_API_KEY",
    secretKey: "OPENAI_API_KEY",
  } as ProviderSpec,
  gemini: {
    id: "gemini",
    get upstreamBase(): string {
      return process.env.RDV_GEMINI_UPSTREAM ?? "https://generativelanguage.googleapis.com";
    },
    // The Gemini API (generativelanguage.googleapis.com) expects the key in the
    // `x-goog-api-key` header — NOT `Authorization: Bearer`. (It also accepts a
    // `?key=` query param, but the header form keeps the key out of URLs/logs.)
    authHeader: "x-goog-api-key",
    keyEnv: "GEMINI_API_KEY",
    secretKey: "GEMINI_API_KEY",
  } as ProviderSpec,
} as Record<ProviderId, ProviderSpec>;

export function getProvider(id: string): ProviderSpec | null {
  return (PROVIDERS as Record<string, ProviderSpec>)[id] ?? null;
}
