import { describe, it, expect } from "vitest";
import {
  normalizeClaudeModelIdentity,
  claudeModelIdentityMatches,
  requestedModelFromAgentFlags,
} from "./ClaudeModelIdentity";

describe("normalizeClaudeModelIdentity", () => {
  it("reduces a model id to its family token", () => {
    expect(normalizeClaudeModelIdentity("claude-fable-5")).toBe("fable");
    expect(normalizeClaudeModelIdentity("claude-opus-5")).toBe("opus");
    expect(normalizeClaudeModelIdentity("claude-sonnet-5")).toBe("sonnet");
    expect(normalizeClaudeModelIdentity("claude-haiku-4-5")).toBe("haiku");
    expect(normalizeClaudeModelIdentity("claude-mythos-5")).toBe("mythos");
  });

  it("reduces the endpoint's display name to the same token", () => {
    expect(normalizeClaudeModelIdentity("Fable")).toBe("fable");
    expect(normalizeClaudeModelIdentity("Opus")).toBe("opus");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(normalizeClaudeModelIdentity("  FABLE  ")).toBe("fable");
    expect(normalizeClaudeModelIdentity("Claude Fable 5")).toBe("fable");
    expect(normalizeClaudeModelIdentity("claude_fable_5")).toBe("fable");
  });

  it("finds the family even when it is not the last segment", () => {
    // The dated-snapshot style puts the family in the middle.
    expect(normalizeClaudeModelIdentity("claude-3-5-sonnet-20241022")).toBe(
      "sonnet"
    );
  });

  it("strips context-window / variant suffixes", () => {
    expect(normalizeClaudeModelIdentity("sonnet[1m]")).toBe("sonnet");
    expect(normalizeClaudeModelIdentity("claude-sonnet-5[1m]")).toBe("sonnet");
  });

  it("falls back to the whole normalized string for an unknown family", () => {
    // Not a guess — an exact normalized comparison, so an unknown display name
    // still matches an identically-named request and nothing else.
    expect(normalizeClaudeModelIdentity("Cowork")).toBe("cowork");
    expect(normalizeClaudeModelIdentity("some-future-model-9")).toBe(
      "some-future-model-9"
    );
  });

  it("returns null for anything carrying no identity", () => {
    expect(normalizeClaudeModelIdentity("")).toBeNull();
    expect(normalizeClaudeModelIdentity("   ")).toBeNull();
    expect(normalizeClaudeModelIdentity("---")).toBeNull();
    expect(normalizeClaudeModelIdentity(null)).toBeNull();
    expect(normalizeClaudeModelIdentity(undefined)).toBeNull();
    expect(normalizeClaudeModelIdentity(42)).toBeNull();
  });
});

describe("claudeModelIdentityMatches", () => {
  it("matches a model id against the endpoint display name", () => {
    // The exact live case: caller has `claude-fable-5`, the endpoint reported
    // `scope.model.display_name = "Fable"`.
    expect(claudeModelIdentityMatches("claude-fable-5", "Fable")).toBe(true);
    expect(claudeModelIdentityMatches("opus", "Opus")).toBe(true);
    expect(claudeModelIdentityMatches("claude-sonnet-5[1m]", "Sonnet")).toBe(
      true
    );
  });

  it("does not match different families", () => {
    expect(claudeModelIdentityMatches("claude-haiku-4-5", "Fable")).toBe(false);
    expect(claudeModelIdentityMatches("claude-opus-5", "Sonnet")).toBe(false);
  });

  it("returns false (never a match) when either side has no identity", () => {
    expect(claudeModelIdentityMatches(null, "Fable")).toBe(false);
    expect(claudeModelIdentityMatches("claude-fable-5", null)).toBe(false);
    expect(claudeModelIdentityMatches("", "")).toBe(false);
  });
});

describe("requestedModelFromAgentFlags", () => {
  it("reads the space-separated form", () => {
    expect(
      requestedModelFromAgentFlags(["--verbose", "--model", "claude-fable-5"])
    ).toBe("claude-fable-5");
  });

  it("reads the inline form", () => {
    expect(requestedModelFromAgentFlags(["--model=claude-opus-5"])).toBe(
      "claude-opus-5"
    );
  });

  it("takes the last occurrence, as a CLI would", () => {
    expect(
      requestedModelFromAgentFlags(["--model", "opus", "--model=sonnet"])
    ).toBe("sonnet");
  });

  it("returns null when no model flag is present", () => {
    expect(requestedModelFromAgentFlags(["--verbose"])).toBeNull();
    expect(requestedModelFromAgentFlags([])).toBeNull();
    expect(requestedModelFromAgentFlags(null)).toBeNull();
    expect(requestedModelFromAgentFlags(undefined)).toBeNull();
  });

  it("returns null for a dangling or empty --model", () => {
    expect(requestedModelFromAgentFlags(["--model"])).toBeNull();
    expect(requestedModelFromAgentFlags(["--model="])).toBeNull();
    expect(requestedModelFromAgentFlags(["--model", "   "])).toBeNull();
  });
});
