/**
 * CrownJudgeEndpoint — resolve the Anthropic-compatible endpoint the Crown
 * judge calls, routed through the EXISTING model-key proxy that agent sessions
 * already use (litellm-process-manager / litellm-service). This is the
 * realization of the aehq cross-link ("Centralized model-key proxy") — the
 * judge does NOT wait on a separate model-proxy epic.
 *
 * Resolution order (mirrors session-service.resolveProxyEnv):
 *   1. LiteLLM proxy running → { baseUrl: http://127.0.0.1:<port>, apiKey:
 *      masterKey } (the proxy validates against the master key).
 *   2. A configured direct-endpoint model → its apiBase + decrypted key.
 *   3. None configured → null (caller falls back deterministically).
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("CrownJudgeEndpoint");

export interface JudgeEndpoint {
  baseUrl: string;
  apiKey: string;
  /** Model id to request; defaults to a Claude model when unspecified. */
  model: string;
}

const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-5";

/**
 * Resolve the judge endpoint for `userId`, or null when no model is configured.
 * `requestedModel` overrides the model id sent to the endpoint.
 */
export async function resolveJudgeEndpoint(
  userId: string,
  requestedModel?: string,
): Promise<JudgeEndpoint | null> {
  try {
    const { litellmProcessManager } = await import(
      "@/services/litellm-process-manager"
    );
    const LiteLLMService = await import("@/services/litellm-service");
    const { decrypt } = await import("@/lib/encryption");

    if (litellmProcessManager.isRunning()) {
      let port = litellmProcessManager.getPort();
      if (!port) {
        const config = await LiteLLMService.getConfig(userId);
        port = config?.port ?? null;
      }
      if (port) {
        const proxyModel = await LiteLLMService.getActiveDefaultModel(userId);
        if (proxyModel?.masterKey) {
          return {
            baseUrl: `http://127.0.0.1:${port}`,
            apiKey: proxyModel.masterKey,
            model: requestedModel ?? DEFAULT_JUDGE_MODEL,
          };
        }
      }
    }

    const directModel = await LiteLLMService.getActiveDirectModel(userId);
    if (directModel) {
      return {
        baseUrl: directModel.apiBase,
        apiKey: decrypt(directModel.encryptedKey),
        model: requestedModel ?? DEFAULT_JUDGE_MODEL,
      };
    }
  } catch (error) {
    log.warn("Failed to resolve judge endpoint", { error: String(error) });
  }
  return null;
}
