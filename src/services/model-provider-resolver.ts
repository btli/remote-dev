/**
 * Real-provider-key resolver for the centralized model-key proxy.
 *
 * SECURITY: this is the ONLY module that returns a real provider key, and it
 * returns it ONLY to the proxy route (server-side). The key is NEVER logged and
 * NEVER returned in any API response.
 *
 * Resolution order:
 *   1. Per-session → profile → encrypted `profileSecretsConfig` (decrypted
 *      server-side via `fetchProfileSecrets`). This is where operators store the
 *      real key today; stripping it from the agent env (aehq.3) loses nothing
 *      because the resolver reads it straight from this store.
 *   2. Instance / global env fallback (e.g. a supervisor-injected real key).
 */
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchProfileSecrets } from "@/services/agent-profile-service";
import type { ProviderSpec } from "@/lib/model-proxy/providers";
import type { ProxyPrincipal } from "@/services/model-proxy-token-service";

export async function resolveProviderKey(
  spec: ProviderSpec,
  principal: ProxyPrincipal,
): Promise<string | null> {
  // 1. Per-session → profile → profileSecretsConfig (decrypted server-side).
  if (principal.sessionId) {
    const sess = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, principal.sessionId),
    });
    if (sess?.profileId) {
      const secrets = await fetchProfileSecrets(sess.profileId);
      const v = secrets?.[spec.secretKey];
      if (v) return v;
    }
  }
  // 2. Instance/global env fallback.
  return process.env[spec.keyEnv] ?? null;
}
