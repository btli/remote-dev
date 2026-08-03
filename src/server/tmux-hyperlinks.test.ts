// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  buildTmuxAttachArgs,
  parseTmuxVersion,
  tmuxSupportsHyperlinks,
  TmuxAttachArgumentResolver,
} from "./tmux-hyperlinks";

describe("parseTmuxVersion", () => {
  it.each([
    ["tmux 3.3", { major: 3, minor: 3 }],
    ["tmux 3.4", { major: 3, minor: 4 }],
    ["tmux 3.7b", { major: 3, minor: 7 }],
  ])("parses %s", (output, expected) => {
    expect(parseTmuxVersion(output)).toEqual(expected);
  });

  it.each([undefined, null, "", "tmux", "tmux version 3.7", "tmux 3.x", "3.7b"])(
    "rejects missing or malformed version output %#",
    (output) => {
      expect(parseTmuxVersion(output)).toBeNull();
    },
  );
});

describe("tmux hyperlink client capability", () => {
  it("requires tmux 3.4 or newer", () => {
    expect(tmuxSupportsHyperlinks(parseTmuxVersion("tmux 3.3"))).toBe(false);
    expect(tmuxSupportsHyperlinks(parseTmuxVersion("tmux 3.4"))).toBe(true);
    expect(tmuxSupportsHyperlinks(parseTmuxVersion("tmux 3.7b"))).toBe(true);
  });

  it("places the client feature before attach-session only when supported", () => {
    expect(buildTmuxAttachArgs("rdv-supported", true)).toEqual([
      "-T",
      "hyperlinks",
      "attach-session",
      "-t",
      "rdv-supported",
    ]);
    expect(buildTmuxAttachArgs("rdv-fallback", false)).toEqual([
      "attach-session",
      "-t",
      "rdv-fallback",
    ]);
  });

  it("uses the top-level client feature for tmux 3.4 without a compatibility warning", () => {
    const readVersion = vi.fn(() => "tmux 3.4");
    const warn = vi.fn();
    const resolver = new TmuxAttachArgumentResolver(readVersion, { warn });

    expect(resolver.forSession("rdv-supported")).toEqual([
      "-T",
      "hyperlinks",
      "attach-session",
      "-t",
      "rdv-supported",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("caches an unsupported version and warns once while retaining fallback args", () => {
    const readVersion = vi.fn(() => "tmux 3.3");
    const warn = vi.fn();
    const resolver = new TmuxAttachArgumentResolver(readVersion, { warn });

    expect(resolver.forSession("rdv-first")).toEqual(["attach-session", "-t", "rdv-first"]);
    expect(resolver.forSession("rdv-second")).toEqual(["attach-session", "-t", "rdv-second"]);

    expect(readVersion).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("tmux 3.4+");
  });

  it.each([null, "tmux 3.x"])(
    "falls back and warns once when the version is missing or malformed: %#",
    (output) => {
      const readVersion = vi.fn(() => output);
      const warn = vi.fn();
      const resolver = new TmuxAttachArgumentResolver(readVersion, { warn });

      expect(resolver.forSession("rdv-missing")).toEqual(["attach-session", "-t", "rdv-missing"]);
      expect(resolver.forSession("rdv-again")).toEqual(["attach-session", "-t", "rdv-again"]);

      expect(readVersion).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it("falls back and warns once when reading the version throws", () => {
    const readVersion = vi.fn((): string | null => {
      throw new Error("spawn tmux ENOENT");
    });
    const warn = vi.fn();
    const resolver = new TmuxAttachArgumentResolver(readVersion, { warn });

    expect(resolver.forSession("rdv-probe-error")).toEqual([
      "attach-session",
      "-t",
      "rdv-probe-error",
    ]);
    expect(resolver.forSession("rdv-again")).toEqual(["attach-session", "-t", "rdv-again"]);

    expect(readVersion).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
