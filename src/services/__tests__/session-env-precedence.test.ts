// @vitest-environment node
/**
 * Env-layer precedence for a launching session, including the Claude account
 * credential injected by [remote-dev-n4x4.6].
 *
 * `buildInitialEnv` is the pure extraction of the merge that session-service
 * hands to tmux at PTY spawn, so these assertions are the real launch contract
 * without standing up tmux, a DB, or a project.
 */
import { describe, it, expect } from "vitest";
import { buildInitialEnv } from "../session-service";

const TOKEN = "sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const STALE = "sk-ant-oat01-STALESTALESTALESTALESTALE0";

describe("buildInitialEnv — Claude account credential", () => {
  it("injects the selected account's CLAUDE_CODE_OAUTH_TOKEN", () => {
    const env = buildInitialEnv({
      claudeAgentDefaults: { CLAUDE_CODE_NO_FLICKER: "1" },
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
  });

  it("beats a stale token left in folder or profile env", () => {
    const env = buildInitialEnv({
      profile: { CLAUDE_CODE_OAUTH_TOKEN: STALE },
      folder: { CLAUDE_CODE_OAUTH_TOKEN: STALE },
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
  });

  it("does not override the RDV_* callback vars", () => {
    const env = buildInitialEnv({
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, RDV_SESSION_ID: "wrong" },
      rdv: { RDV_SESSION_ID: "sess-1" },
    });

    expect(env.RDV_SESSION_ID).toBe("sess-1");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
  });

  it("leaves the env untouched when no account is selected", () => {
    const env = buildInitialEnv({
      profile: { CLAUDE_CONFIG_DIR: "/home/me/.claude" },
      claudeAccount: {},
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    // The shared config dir is what the account layers on top of — an absent
    // account must never disturb it.
    expect(env.CLAUDE_CONFIG_DIR).toBe("/home/me/.claude");
  });

  it("never injects CLAUDE_CONFIG_DIR of its own", () => {
    // Contract fact #3: an explicit CLAUDE_CONFIG_DIR re-namespaces the macOS
    // Keychain, so the account layer must not touch it — the token alone
    // selects the account.
    const env = buildInitialEnv({
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});

describe("buildInitialEnv — existing layer order is preserved", () => {
  it("keeps the documented low→high precedence", () => {
    const env = buildInitialEnv({
      claudeAgentDefaults: { K: "defaults" },
      plugin: { K: "plugin" },
      profile: { K: "profile" },
      proxy: { K: "proxy" },
      modelProxy: { K: "modelProxy" },
      folder: { K: "folder" },
      folderGitIdentity: { K: "folderGitIdentity" },
      gitCredential: { K: "gitCredential" },
      ghAccount: { K: "ghAccount" },
      claudeAccount: { K: "claudeAccount" },
      rdv: { K: "rdv" },
    });
    expect(env.K).toBe("rdv");
  });

  it("model-proxy env still wins over LiteLLM proxy env and the profile", () => {
    const env = buildInitialEnv({
      profile: { ANTHROPIC_BASE_URL: "profile" },
      proxy: { ANTHROPIC_BASE_URL: "litellm" },
      modelProxy: { ANTHROPIC_BASE_URL: "model-proxy" },
    });
    expect(env.ANTHROPIC_BASE_URL).toBe("model-proxy");
  });

  it("omitted layers are treated as empty", () => {
    expect(buildInitialEnv({})).toEqual({});
  });
});
