// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// ESM namespace exports can't be spied on, so mock node:fs's statSync directly.
const statSync = vi.fn();
vi.mock("node:fs", () => ({ statSync: (p: string) => statSync(p) }));

import {
  validatePathWithReason,
  validatePath,
  sanitizeCwdForDisplay,
} from "./validate-cwd";

/** Make statSync report a directory / a file. */
function asDir(): void {
  statSync.mockReturnValue({ isDirectory: () => true });
}
function asFile(): void {
  statSync.mockReturnValue({ isDirectory: () => false });
}
function asMissing(): void {
  statSync.mockImplementation(() => {
    throw new Error("ENOENT");
  });
}

describe("validatePathWithReason", () => {
  beforeEach(() => {
    statSync.mockReset();
  });

  it("passes a valid directory through (no reason)", () => {
    asDir();
    const result = validatePathWithReason("/some/real/dir");
    expect(result).toEqual({ path: "/some/real/dir" });
    expect(result.rejectedReason).toBeUndefined();
  });

  it("reports 'missing' when the path does not exist", () => {
    asMissing();
    const result = validatePathWithReason("/kaelyns.academy");
    expect(result.path).toBeUndefined();
    expect(result.rejectedReason).toBe("missing");
  });

  it("reports 'not-dir' when the path is a file", () => {
    asFile();
    const result = validatePathWithReason("/etc/hosts");
    expect(result.path).toBeUndefined();
    expect(result.rejectedReason).toBe("not-dir");
  });

  it("reports 'not-absolute' for a relative path", () => {
    const result = validatePathWithReason("relative/dir");
    expect(result.path).toBeUndefined();
    expect(result.rejectedReason).toBe("not-absolute");
    expect(statSync).not.toHaveBeenCalled();
  });

  it("returns undefined path with no reason when nothing was requested", () => {
    expect(validatePathWithReason(undefined)).toEqual({ path: undefined });
    expect(validatePathWithReason("")).toEqual({ path: undefined });
  });

  it("validatePath wrapper returns only the usable path", () => {
    asDir();
    expect(validatePath("/ok/dir")).toBe("/ok/dir");

    asMissing();
    expect(validatePath("/gone")).toBeUndefined();
  });
});

describe("sanitizeCwdForDisplay", () => {
  it("strips an embedded ESC/OSC sequence so nothing renders as a control code", () => {
    // OSC window-title injection: ESC ] 0 ; pwned BEL embedded in a path.
    const input = `/x${String.fromCharCode(0x1b)}]0;pwned${String.fromCharCode(0x07)}/y`;
    const out = sanitizeCwdForDisplay(input);
    // No control bytes survive (no ESC, no BEL).
    expect(out).not.toMatch(
      new RegExp(`[${String.fromCharCode(0x1b)}${String.fromCharCode(0x07)}]`)
    );
    // Each control byte became "?"; the visible text is preserved.
    expect(out).toBe("/x?]0;pwned?/y");
  });

  it("removes the CSI screen-clear sequence", () => {
    const input = `${String.fromCharCode(0x1b)}[2Jboom`;
    expect(sanitizeCwdForDisplay(input)).toBe("?[2Jboom");
  });

  it("passes a normal path through unchanged", () => {
    expect(sanitizeCwdForDisplay("/home/user/projects/app")).toBe(
      "/home/user/projects/app"
    );
  });

  it("truncates to 256 characters", () => {
    const long = "/" + "a".repeat(500);
    const out = sanitizeCwdForDisplay(long);
    expect(out).toHaveLength(256);
    expect(out).toBe(long.slice(0, 256));
  });
});
