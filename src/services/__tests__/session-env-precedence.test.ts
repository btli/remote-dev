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
import { ProfileIsolation } from "@/domain/value-objects/ProfileIsolation";

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

describe("accounts share ONE Claude config dir", () => {
  /**
   * The REAL profile overlay, straight from the value object that
   * `AgentProfileService.getProfileEnvironment` uses — not a hand-written
   * fixture. If ProfileIsolation ever starts emitting CLAUDE_CONFIG_DIR again,
   * these tests fail, which is the point: the guarantee is enforced at the
   * source now, with no downstream strip to paper over a regression.
   */
  function profileOverlay(profileDir: string): Record<string, string> {
    return ProfileIsolation.create({
      profileDir,
      realHome: "/home/user",
      provider: "claude",
      sshKeyPath: "/keys/id",
      gitIdentity: { name: "Me", email: "me@example.com" },
    })
      .toEnvironment()
      .toRecord();
  }

  it("the profile overlay carries no CLAUDE_CONFIG_DIR but keeps the rest", () => {
    const overlay = profileOverlay("/profiles/p1");

    expect(overlay).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    expect(overlay).toMatchObject({
      XDG_CONFIG_HOME: "/profiles/p1/.config",
      XDG_DATA_HOME: "/profiles/p1/.local/share",
      GIT_CONFIG_GLOBAL: "/profiles/p1/.gitconfig",
      GIT_AUTHOR_NAME: "Me",
      GIT_AUTHOR_EMAIL: "me@example.com",
      GIT_SSH_COMMAND: "ssh -i '/keys/id' -o IdentitiesOnly=yes",
    });
  });

  it("the key is ABSENT, not blanked (an empty value is still 'explicitly set')", () => {
    // Contract fact #3: Claude Code derives its macOS Keychain service name
    // from the SETTING, so any explicit value — "" or even $HOME/.claude — lands
    // in a different credential namespace. It must not appear at all.
    const env = buildInitialEnv({
      profile: profileOverlay("/profiles/p1"),
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });

    expect(Object.keys(env)).not.toContain("CLAUDE_CONFIG_DIR");
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("non-Claude providers keep their own config-dir isolation", () => {
    const codex = ProfileIsolation.create({
      profileDir: "/profiles/p1",
      realHome: "/home/user",
      provider: "codex",
    })
      .toEnvironment()
      .toRecord();

    expect(codex.CODEX_HOME).toBe("/profiles/p1/.codex");
    expect(codex).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  });

  it("two accounts launch with the SAME Claude config dir and DIFFERENT tokens", () => {
    // Two sessions, each auto-selected onto a different account whose origin
    // profile is a different directory — the exact scenario that used to give
    // each account its own isolated (and mostly empty) Claude context.
    const accountA = "sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const accountB = "sk-ant-oat01-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    const envA = buildInitialEnv({
      profile: profileOverlay("/profiles/p1"),
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: accountA },
    });
    const envB = buildInitialEnv({
      profile: profileOverlay("/profiles/p2"),
      claudeAccount: { CLAUDE_CODE_OAUTH_TOKEN: accountB },
    });

    // Same Claude config: neither session sets CLAUDE_CONFIG_DIR, so both
    // resolve to the user's real ~/.claude — one set of skills, CLAUDE.md, MCP
    // servers, settings and agents.
    expect(envA.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(envB.CLAUDE_CONFIG_DIR).toBeUndefined();

    // Different identity: the token is the ONLY thing that differs about which
    // Claude account each session acts as.
    expect(envA.CLAUDE_CODE_OAUTH_TOKEN).toBe(accountA);
    expect(envB.CLAUDE_CODE_OAUTH_TOKEN).toBe(accountB);
    expect(envA.CLAUDE_CODE_OAUTH_TOKEN).not.toBe(envB.CLAUDE_CODE_OAUTH_TOKEN);

    // The profiles still contribute their own non-Claude isolation.
    expect(envA.XDG_CONFIG_HOME).toBe("/profiles/p1/.config");
    expect(envB.XDG_CONFIG_HOME).toBe("/profiles/p2/.config");
  });
});
