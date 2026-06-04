/**
 * [aehq] Single source of truth for provider-key env vars + the model-proxy
 * env mapping. Shared by the env-injection path (session-service) and the
 * key-stripping path (agent-profile-service) so the two never drift.
 */

/**
 * Provider secret env vars the agent must NOT see when the model proxy is on —
 * the real keys live only in the server-side resolver. Stripped from the merged
 * profile-secret env before it reaches tmux.
 */
export const PROVIDER_SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

/**
 * Placeholder injected in place of a real key for CLIs that refuse to start
 * without a non-empty key var distinct from the proxy token. (For Claude Code
 * the token itself doubles as the key — see `buildModelProxyEnv`.)
 */
export const PROXY_PLACEHOLDER_KEY = "rdv-proxy-placeholder";

/**
 * Remove every real provider-secret env var from `env` IN PLACE (so it never
 * reaches the agent's tmux session under proxy mode). The real keys are read
 * server-side by the resolver, so stripping here loses nothing. Returns the
 * same object for convenience.
 *
 * Generic over the value type so it accepts both a plain `Record<string,string>`
 * and the wider `ProfileEnvironment` (`string | undefined` values).
 */
export function stripProviderSecrets<T extends Record<string, string | undefined>>(env: T): T {
  for (const k of PROVIDER_SECRET_ENV_KEYS) delete env[k];
  return env;
}

/** Agent providers the model proxy currently understands. */
export type ModelProxyProvider = "claude" | "codex" | "gemini";

/**
 * Map an agent provider to the provider-scope array its proxy token needs.
 * Unknown providers fall back to anthropic (the default, single-provider scope).
 */
export function providerScopeFor(agentProvider: string): string[] {
  switch (agentProvider) {
    case "codex":
      return ["openai"];
    case "gemini":
      return ["gemini"];
    case "claude":
    default:
      return ["anthropic"];
  }
}

/**
 * Build the agent-facing env that points a CLI at the in-Next.js model proxy
 * and hands it the per-session `mp_…` token in place of a real key.
 *
 * The CLI sends this "key" to `*_BASE_URL`; our proxy route reads it as the
 * token and swaps in the real provider key server-side. The agent therefore
 * never holds a real provider key.
 *
 * `apiBase` is the local API origin (e.g. `http://localhost:6001`).
 *
 * Provider support:
 *  - `claude` — Claude Code honors `ANTHROPIC_BASE_URL` (PROVEN; the LiteLLM
 *    path uses it). Always on under the feature flag.
 *  - `codex` / `gemini` — the upstream route + resolver fully support these, but
 *    whether the Codex (`OPENAI_BASE_URL`) and Gemini (`GOOGLE_GEMINI_BASE_URL`)
 *    CLIs honor their base-URL override is UNVERIFIED in this repo (plan Risk
 *    #2). Per the plan's "down-scope rather than ship a broken env" directive,
 *    these are gated behind explicit opt-in flags (`RDV_MODEL_PROXY_CODEX` /
 *    `RDV_MODEL_PROXY_GEMINI`) and OFF by default. Returns `{}` when not opted
 *    in, so an unverified CLI is never silently pointed at a broken base URL.
 */
export function buildModelProxyEnv(
  agentProvider: string,
  token: string,
  apiBase: string,
): Record<string, string> {
  switch (agentProvider) {
    case "claude":
      return {
        // Claude Code sends ANTHROPIC_API_KEY to ANTHROPIC_BASE_URL as the
        // x-api-key header → our route reads it as the proxy token.
        ANTHROPIC_BASE_URL: `${apiBase}/api/model-proxy/anthropic`,
        ANTHROPIC_API_KEY: token,
      };
    case "codex":
      if (process.env.RDV_MODEL_PROXY_CODEX !== "1") return {};
      return {
        OPENAI_BASE_URL: `${apiBase}/api/model-proxy/openai/v1`,
        OPENAI_API_KEY: token,
      };
    case "gemini":
      if (process.env.RDV_MODEL_PROXY_GEMINI !== "1") return {};
      return {
        GOOGLE_GEMINI_BASE_URL: `${apiBase}/api/model-proxy/gemini`,
        GEMINI_API_KEY: token,
      };
    default:
      return {};
  }
}
