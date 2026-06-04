// @vitest-environment node
import { describe, it, expect } from "vitest";
import { stripSensitiveEnv, buildResumeBinding } from "../resume-binding";

describe("stripSensitiveEnv", () => {
  it("drops secrets but keeps home/dir vars needed for resume", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-secret",
      GH_TOKEN: "ghp_x",
      OPENAI_API_KEY: "sk-openai",
      CLAUDE_CONFIG_DIR: "/p/.config",
      HOME: "/home/u",
      FOO_PASSWORD: "p",
      AWS_SESSION_TOKEN: "aws",
      GITHUB_AUTH: "auth-val",
      CODEX_HOME: "/p/.codex",
      XDG_CONFIG_HOME: "/p/xdg",
    };
    const out = stripSensitiveEnv(env);
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.GH_TOKEN).toBeUndefined();
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.FOO_PASSWORD).toBeUndefined();
    expect(out.AWS_SESSION_TOKEN).toBeUndefined();
    expect(out.GITHUB_AUTH).toBeUndefined();
    // kept — needed to locate resume session files
    expect(out.CLAUDE_CONFIG_DIR).toBe("/p/.config");
    expect(out.HOME).toBe("/home/u");
    expect(out.CODEX_HOME).toBe("/p/.codex");
    expect(out.XDG_CONFIG_HOME).toBe("/p/xdg");
  });

  it("drops everything not explicitly safe (allowlist beats denylist)", () => {
    const out = stripSensitiveEnv({ SOME_RANDOM_VAR: "v", PATH: "/usr/bin" });
    // PATH and arbitrary vars are not in the allowlist → dropped.
    expect(out.SOME_RANDOM_VAR).toBeUndefined();
    expect(out.PATH).toBeUndefined();
  });
});

describe("buildResumeBinding", () => {
  it("captures flags + sanitized env + provider + timestamp", () => {
    const b = buildResumeBinding(
      { provider: "claude", resumeFlags: ["--resume", "abc"], argvOverride: null },
      { ANTHROPIC_API_KEY: "sk", HOME: "/h" },
    );
    expect(b.resumeFlags).toEqual(["--resume", "abc"]);
    expect(b.argvOverride).toBeNull();
    expect(b.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(b.env.HOME).toBe("/h");
    expect(b.provider).toBe("claude");
    expect(typeof b.capturedAt).toBe("string");
  });

  it("preserves a codex argv override", () => {
    const b = buildResumeBinding(
      { provider: "codex", resumeFlags: [], argvOverride: ["codex", "resume", "cx"] },
      {},
    );
    expect(b.argvOverride).toEqual(["codex", "resume", "cx"]);
  });
});
