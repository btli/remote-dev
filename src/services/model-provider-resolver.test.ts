// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  session: null as { profileId: string | null } | null,
  fetchProfileSecrets: vi.fn<(profileId: string) => Promise<Record<string, string> | null>>(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      terminalSessions: {
        findFirst: vi.fn(async () => hoisted.session),
      },
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _eq: args }),
}));

vi.mock("@/db/schema", () => ({
  terminalSessions: new Proxy({}, { get: (_t, p) => ({ _col: String(p) }) }),
}));

vi.mock("@/services/agent-profile-service", () => ({
  fetchProfileSecrets: hoisted.fetchProfileSecrets,
}));

import { resolveProviderKey } from "./model-provider-resolver";
import { PROVIDERS } from "@/lib/model-proxy/providers";
import type { ProxyPrincipal } from "./model-proxy-token-service";

const principal: ProxyPrincipal = {
  userId: "u1",
  sessionId: "s1",
  instanceSlug: null,
  tokenId: "t1",
};

describe("resolveProviderKey", () => {
  beforeEach(() => {
    hoisted.session = null;
    hoisted.fetchProfileSecrets.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("prefers the per-profile encrypted secret over the env fallback", async () => {
    hoisted.session = { profileId: "p1" };
    hoisted.fetchProfileSecrets.mockResolvedValue({ ANTHROPIC_API_KEY: "sk-ant-FROM-PROFILE" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-FROM-ENV";

    const key = await resolveProviderKey(PROVIDERS.anthropic, principal);
    expect(key).toBe("sk-ant-FROM-PROFILE");
    expect(hoisted.fetchProfileSecrets).toHaveBeenCalledWith("p1");
  });

  it("falls back to the env key when the profile has no secret for the provider", async () => {
    hoisted.session = { profileId: "p1" };
    hoisted.fetchProfileSecrets.mockResolvedValue({ SOMETHING_ELSE: "x" });
    process.env.OPENAI_API_KEY = "sk-FROM-ENV";

    const key = await resolveProviderKey(PROVIDERS.openai, principal);
    expect(key).toBe("sk-FROM-ENV");
  });

  it("falls back to env when the principal has no session", async () => {
    process.env.GEMINI_API_KEY = "g-FROM-ENV";
    const key = await resolveProviderKey(PROVIDERS.gemini, {
      ...principal,
      sessionId: null,
    });
    expect(key).toBe("g-FROM-ENV");
    expect(hoisted.fetchProfileSecrets).not.toHaveBeenCalled();
  });

  it("returns null when neither profile nor env has the key", async () => {
    hoisted.session = { profileId: null };
    const key = await resolveProviderKey(PROVIDERS.anthropic, principal);
    expect(key).toBeNull();
  });

  it("maps each provider to its own secret key + env var", () => {
    expect(PROVIDERS.openai.authHeader).toBe("authorization");
    expect(PROVIDERS.openai.authScheme).toBe("Bearer");
    expect(PROVIDERS.openai.secretKey).toBe("OPENAI_API_KEY");
    expect(PROVIDERS.gemini.secretKey).toBe("GEMINI_API_KEY");
    // Gemini uses x-goog-api-key (NOT Authorization: Bearer).
    expect(PROVIDERS.gemini.authHeader).toBe("x-goog-api-key");
    expect(PROVIDERS.gemini.authScheme).toBeUndefined();
    // Anthropic is x-api-key with the version pin.
    expect(PROVIDERS.anthropic.authHeader).toBe("x-api-key");
    expect(PROVIDERS.anthropic.staticHeaders?.["anthropic-version"]).toBe("2023-06-01");
  });
});
