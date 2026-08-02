import { describe, it, expect } from "vitest";
import {
  resolveClaudeModelFamily,
  claudeModelIdentityMatches,
  requestedModelFromAgentFlags,
} from "./ClaudeModelIdentity";

describe("resolveClaudeModelFamily", () => {
  it("reduces a model id to its family token", () => {
    expect(resolveClaudeModelFamily("claude-fable-5")).toBe("fable");
    expect(resolveClaudeModelFamily("claude-opus-5")).toBe("opus");
    expect(resolveClaudeModelFamily("claude-sonnet-5")).toBe("sonnet");
    expect(resolveClaudeModelFamily("claude-haiku-4-5")).toBe("haiku");
    expect(resolveClaudeModelFamily("claude-mythos-5")).toBe("mythos");
  });

  it("reduces the endpoint's display name to the same token", () => {
    expect(resolveClaudeModelFamily("Fable")).toBe("fable");
    expect(resolveClaudeModelFamily("Opus")).toBe("opus");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(resolveClaudeModelFamily("  FABLE  ")).toBe("fable");
    expect(resolveClaudeModelFamily("Claude Fable 5")).toBe("fable");
    expect(resolveClaudeModelFamily("claude_fable_5")).toBe("fable");
  });

  it("finds the family even when it is not the last segment", () => {
    // The dated-snapshot style puts the family in the middle.
    expect(resolveClaudeModelFamily("claude-3-5-sonnet-20241022")).toBe(
      "sonnet"
    );
  });

  it("strips context-window / variant suffixes", () => {
    expect(resolveClaudeModelFamily("sonnet[1m]")).toBe("sonnet");
    expect(resolveClaudeModelFamily("claude-sonnet-5[1m]")).toBe("sonnet");
  });

  it("returns null for an unrecognized family — never a guessed identity", () => {
    // [review G4] A fall-back to the normalized string could fail CLOSED: a
    // `cowork` alias would exact-match an upstream "Cowork" window and block an
    // account for a family we have never validated.
    expect(resolveClaudeModelFamily("Cowork")).toBeNull();
    expect(resolveClaudeModelFamily("claude-cowork-6")).toBeNull();
    expect(resolveClaudeModelFamily("some-future-model-9")).toBeNull();
  });

  it("does not mistake a third-party model for a Claude family", () => {
    // The `claude-` prefix requirement on the segment scan is what stops a
    // proxy model from being blocked by Anthropic's Sonnet window. [review G4]
    expect(resolveClaudeModelFamily("vendor-sonnet-proxy")).toBeNull();
    expect(resolveClaudeModelFamily("my-opus-clone")).toBeNull();
    // …while the genuine id styles still resolve.
    expect(resolveClaudeModelFamily("claude-sonnet-5")).toBe("sonnet");
  });

  it("declines aliases that do not name a single family", () => {
    // [review G11] `opusplan` plans on Opus and executes on Sonnet; `default`
    // means "let the CLI decide". Mapping either to one family would narrow
    // availability on a guess.
    expect(resolveClaudeModelFamily("opusplan")).toBeNull();
    expect(resolveClaudeModelFamily("default")).toBeNull();
  });

  it("returns null for anything carrying no identity", () => {
    expect(resolveClaudeModelFamily("")).toBeNull();
    expect(resolveClaudeModelFamily("   ")).toBeNull();
    expect(resolveClaudeModelFamily("---")).toBeNull();
    expect(resolveClaudeModelFamily(null)).toBeNull();
    expect(resolveClaudeModelFamily(undefined)).toBeNull();
    expect(resolveClaudeModelFamily(42)).toBeNull();
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
