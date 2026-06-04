/**
 * Tests for the supervisor login `safeCallbackPath` open-redirect guard.
 *
 * The supervisor login page reads `?callbackUrl=` and uses it as NextAuth's
 * `redirectTo` so the user returns to their original destination after OIDC
 * sign-in. Only same-origin relative paths (a single leading `/`) are accepted;
 * scheme-relative / absolute / backslash-escaped forms are rejected.
 */

import { describe, it, expect } from "vitest";
import { safeCallbackPath } from "@/lib/safe-callback-path";

describe("safeCallbackPath (supervisor)", () => {
  it("keeps a same-origin relative path (with query)", () => {
    expect(safeCallbackPath("/dev/auth/mobile-callback?state=xyz")).toBe(
      "/dev/auth/mobile-callback?state=xyz",
    );
  });

  it("rejects scheme-relative, absolute, and backslash-escaped forms", () => {
    expect(safeCallbackPath("//evil.com")).toBeUndefined();
    expect(safeCallbackPath("https://evil.com")).toBeUndefined();
    expect(safeCallbackPath("/\\evil")).toBeUndefined();
  });

  it("applies the rules to the first array element", () => {
    expect(safeCallbackPath(["/dev/ok", "/dev/second"])).toBe("/dev/ok");
    expect(safeCallbackPath(["//evil.com", "/dev/ok"])).toBeUndefined();
  });

  it("returns undefined for undefined / non-path input", () => {
    expect(safeCallbackPath(undefined)).toBeUndefined();
    expect(safeCallbackPath("relative-no-slash")).toBeUndefined();
  });
});
