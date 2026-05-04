/**
 * sessionStatusUtils tests (Phase 2 mobile redesign).
 *
 * Asserts the running pip class uses the design-system token, not a raw
 * Tailwind palette literal. The token-based class keeps chromatic signal
 * colors first-class (DESIGN.md "Signal" section).
 */

import { describe, it, expect } from "vitest";

import { pipClassName } from "@/components/mobile/sessions/sessionStatusUtils";

describe("pipClassName", () => {
  it("uses --color-signal-running token for the running pip (not bg-emerald-500)", () => {
    const cls = pipClassName("running");
    expect(cls).toContain("var(--color-signal-running)");
    expect(cls).not.toContain("emerald");
  });

  it("uses --color-signal-attention-solid token for the attention pip", () => {
    const cls = pipClassName("attention");
    expect(cls).toContain("var(--color-signal-attention-solid)");
  });

  it("uses bg-destructive for the error pip", () => {
    expect(pipClassName("error")).toBe("bg-destructive");
  });

  it("uses muted foreground for suspended", () => {
    expect(pipClassName("suspended")).toContain("muted-foreground");
  });

  it("uses foreground/40 for idle (achromatic default)", () => {
    expect(pipClassName("idle")).toBe("bg-foreground/40");
  });
});
