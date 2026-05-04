import { describe, expect, it } from "vitest";

import { AnsiStripper } from "./ansi-stripper";

describe("AnsiStripper", () => {
  it("preserves SGR sequences (colors) and strips cursor-movement CSIs", () => {
    const s = new AnsiStripper();
    // Red "hi" + cursor-up + plain text — SGR kept, CSI A stripped.
    const out = s.process("\x1b[31mhi\x1b[0m\x1b[Aworld");
    expect(out).toBe("\x1b[31mhi\x1b[0mworld");
  });

  it("strips OSC sequences terminated by BEL", () => {
    const s = new AnsiStripper();
    const out = s.process("before\x1b]0;window title\x07after");
    expect(out).toBe("beforeafter");
  });

  it("buffers incomplete escape sequences across chunks", () => {
    const s = new AnsiStripper();
    // First chunk ends mid-CSI; stripper should hold the tail.
    const first = s.process("text\x1b[3");
    expect(first).toBe("text");
    // Second chunk completes the SGR — full sequence emitted, including the m.
    const second = s.process("1mred\x1b[0m");
    expect(second).toBe("\x1b[31mred\x1b[0m");
  });

  it("removes stray \\r that isn't followed by \\n (progress-bar overwrites)", () => {
    const s = new AnsiStripper();
    expect(s.process("loading\r10%\r20%")).toBe("loading10%20%");
    expect(s.process("line1\r\nline2")).toBe("line1\r\nline2");
  });

  it("reset() clears the pending buffer", () => {
    const s = new AnsiStripper();
    s.process("text\x1b[3"); // pending tail buffered
    s.reset();
    // Without the reset this would emit "1mred"; after reset the "1m" is no
    // longer treated as the tail of a CSI started in the previous chunk.
    const out = s.process("1mred");
    expect(out).toBe("1mred");
  });
});
