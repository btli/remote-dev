/**
 * Unit tests for getAttentionGlowClass (remote-dev-f9y9).
 *
 * The needs-attention ● dot in SessionMetadataBar was replaced by a glow halo
 * on the session ICON. The glow is driven by BOTH live agent status and the
 * highest unread notification severity, so a backgrounded agent that already
 * settled to idle still surfaces a pending actionable/error signal. Error
 * outranks actionable; passive/idle with no unread severity = no glow.
 *
 * The helper returns ONLY the glow class — never `agent-breathing`. The gentle
 * pulse for live `waiting` comes from getSessionIconColor; a notification-only /
 * idle attention is a calm static halo (matching the old static dot).
 */
import { describe, it, expect } from "vitest";
import { getAttentionGlowClass } from "../sessionIconColor";

describe("getAttentionGlowClass", () => {
  it("returns the attention glow (static, no breathe) for live waiting status", () => {
    expect(getAttentionGlowClass("waiting")).toBe("agent-glow-attention");
  });

  it("returns the error glow for live error status", () => {
    expect(getAttentionGlowClass("error")).toBe("agent-glow-error");
  });

  it("glows attention for an idle icon with an unread actionable notification", () => {
    expect(getAttentionGlowClass("idle", "actionable")).toBe("agent-glow-attention");
  });

  it("glows error for an idle icon with an unread error notification", () => {
    expect(getAttentionGlowClass("idle", "error")).toBe("agent-glow-error");
  });

  it("does not glow for an idle icon with no unread severity", () => {
    expect(getAttentionGlowClass("idle", null)).toBe("");
    expect(getAttentionGlowClass("idle")).toBe("");
  });

  it("does not glow for running/passive states with no unread severity", () => {
    expect(getAttentionGlowClass("running")).toBe("");
    expect(getAttentionGlowClass("compacting")).toBe("");
    expect(getAttentionGlowClass(null)).toBe("");
  });

  it("lets a live error outrank an unread actionable severity", () => {
    expect(getAttentionGlowClass("error", "actionable")).toBe("agent-glow-error");
  });

  it("lets an unread error severity outrank a live waiting status", () => {
    // waiting alone would be the attention glow, but error severity wins.
    expect(getAttentionGlowClass("waiting", "error")).toBe("agent-glow-error");
  });
});
