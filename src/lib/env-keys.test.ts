// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PROVIDER_SECRET_ENV_KEYS,
  PROXY_PLACEHOLDER_KEY,
  providerScopeFor,
  buildModelProxyEnv,
  stripProviderSecrets,
} from "./env-keys";

describe("env-keys", () => {
  it("lists the provider secret env keys that must be stripped under proxy mode", () => {
    expect(PROVIDER_SECRET_ENV_KEYS).toContain("ANTHROPIC_API_KEY");
    expect(PROVIDER_SECRET_ENV_KEYS).toContain("OPENAI_API_KEY");
    expect(PROVIDER_SECRET_ENV_KEYS).toContain("GEMINI_API_KEY");
    expect(PROVIDER_SECRET_ENV_KEYS).toContain("GOOGLE_API_KEY");
    expect(PROVIDER_SECRET_ENV_KEYS).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  it("exposes a non-empty placeholder key", () => {
    expect(PROXY_PLACEHOLDER_KEY.length).toBeGreaterThan(0);
  });

  it("maps providers to scopes (claude→anthropic, codex→openai, gemini→gemini)", () => {
    expect(providerScopeFor("claude")).toEqual(["anthropic"]);
    expect(providerScopeFor("codex")).toEqual(["openai"]);
    expect(providerScopeFor("gemini")).toEqual(["gemini"]);
    expect(providerScopeFor("none")).toEqual(["anthropic"]); // fallback
  });

  describe("buildModelProxyEnv", () => {
    const TOKEN = "mp_TESTTOKEN";
    const BASE = "http://localhost:6001";

    it("points Claude Code at the proxy with the token as its key (no real key)", () => {
      const env = buildModelProxyEnv("claude", TOKEN, BASE);
      expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:6001/api/model-proxy/anthropic");
      expect(env.ANTHROPIC_API_KEY).toBe(TOKEN);
      // The injected "key" is the proxy token, never a real sk-ant key.
      expect(env.ANTHROPIC_API_KEY.startsWith("mp_")).toBe(true);
      expect(env.ANTHROPIC_API_KEY.startsWith("sk-ant")).toBe(false);
    });

    it("returns empty env for codex/gemini unless explicitly opted in (down-scope)", () => {
      const prevCodex = process.env.RDV_MODEL_PROXY_CODEX;
      const prevGemini = process.env.RDV_MODEL_PROXY_GEMINI;
      delete process.env.RDV_MODEL_PROXY_CODEX;
      delete process.env.RDV_MODEL_PROXY_GEMINI;
      try {
        expect(buildModelProxyEnv("codex", TOKEN, BASE)).toEqual({});
        expect(buildModelProxyEnv("gemini", TOKEN, BASE)).toEqual({});
      } finally {
        if (prevCodex !== undefined) process.env.RDV_MODEL_PROXY_CODEX = prevCodex;
        if (prevGemini !== undefined) process.env.RDV_MODEL_PROXY_GEMINI = prevGemini;
      }
    });

    it("emits codex/gemini proxy env when the opt-in flag is set", () => {
      const prevCodex = process.env.RDV_MODEL_PROXY_CODEX;
      const prevGemini = process.env.RDV_MODEL_PROXY_GEMINI;
      process.env.RDV_MODEL_PROXY_CODEX = "1";
      process.env.RDV_MODEL_PROXY_GEMINI = "1";
      try {
        const codex = buildModelProxyEnv("codex", TOKEN, BASE);
        expect(codex.OPENAI_BASE_URL).toBe("http://localhost:6001/api/model-proxy/openai/v1");
        expect(codex.OPENAI_API_KEY).toBe(TOKEN);

        const gemini = buildModelProxyEnv("gemini", TOKEN, BASE);
        expect(gemini.GOOGLE_GEMINI_BASE_URL).toBe("http://localhost:6001/api/model-proxy/gemini");
        expect(gemini.GEMINI_API_KEY).toBe(TOKEN);
      } finally {
        if (prevCodex !== undefined) process.env.RDV_MODEL_PROXY_CODEX = prevCodex;
        else delete process.env.RDV_MODEL_PROXY_CODEX;
        if (prevGemini !== undefined) process.env.RDV_MODEL_PROXY_GEMINI = prevGemini;
        else delete process.env.RDV_MODEL_PROXY_GEMINI;
      }
    });
  });

  describe("stripProviderSecrets", () => {
    it("removes every real provider key, preserving all other env vars", () => {
      const env: Record<string, string> = {
        ANTHROPIC_API_KEY: "sk-ant-REAL",
        OPENAI_API_KEY: "sk-REAL",
        GEMINI_API_KEY: "g-REAL",
        GOOGLE_API_KEY: "goog-REAL",
        ANTHROPIC_AUTH_TOKEN: "tok-REAL",
        PATH: "/usr/bin",
        HOME: "/home/agent",
        SOME_OTHER_SECRET: "keep-me",
      };
      const result = stripProviderSecrets(env);
      for (const k of PROVIDER_SECRET_ENV_KEYS) {
        expect(result).not.toHaveProperty(k);
      }
      // Non-provider env is untouched.
      expect(result.PATH).toBe("/usr/bin");
      expect(result.HOME).toBe("/home/agent");
      expect(result.SOME_OTHER_SECRET).toBe("keep-me");
      // No real provider key value survives anywhere.
      expect(JSON.stringify(result)).not.toContain("sk-ant-REAL");
      expect(JSON.stringify(result)).not.toContain("sk-REAL");
    });

    it("is a no-op when no provider keys are present", () => {
      const env = { PATH: "/usr/bin" };
      expect(stripProviderSecrets({ ...env })).toEqual(env);
    });
  });
});
