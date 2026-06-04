/**
 * Tests for `safeCallbackPath` — the open-redirect guard on the login page.
 *
 * The login page reads `?callbackUrl=` and hands it to `signIn({ callbackUrl })`
 * (instance) / `signIn({ redirectTo })` (supervisor) so the user returns to
 * their original destination after OIDC sign-in. To avoid an open redirect, only
 * same-origin relative paths (a single leading `/`) are accepted — protocol /
 * scheme-relative / backslash-escape forms are rejected.
 */

import { describe, it, expect } from "vitest";
import { safeCallbackPath } from "@/lib/safe-callback-path";

describe("safeCallbackPath", () => {
  it("keeps a same-origin relative path", () => {
    expect(safeCallbackPath("/dev/auth/mobile-callback")).toBe(
      "/dev/auth/mobile-callback",
    );
  });

  it("keeps a same-origin relative path with a query string", () => {
    expect(safeCallbackPath("/dev/auth/mobile-callback?state=xyz")).toBe(
      "/dev/auth/mobile-callback?state=xyz",
    );
  });

  it("rejects a scheme-relative (//) URL", () => {
    expect(safeCallbackPath("//evil.com")).toBeUndefined();
  });

  it("rejects an absolute http(s) URL", () => {
    expect(safeCallbackPath("https://evil.com")).toBeUndefined();
  });

  it("rejects a backslash-escape (/\\) path", () => {
    expect(safeCallbackPath("/\\evil")).toBeUndefined();
  });

  it("applies the same rules to the first element of an array", () => {
    expect(safeCallbackPath(["/dev/ok", "/dev/second"])).toBe("/dev/ok");
    expect(safeCallbackPath(["//evil.com", "/dev/ok"])).toBeUndefined();
  });

  it("returns undefined for undefined / non-path input", () => {
    expect(safeCallbackPath(undefined)).toBeUndefined();
    expect(safeCallbackPath("relative-no-slash")).toBeUndefined();
    expect(safeCallbackPath([])).toBeUndefined();
  });
});
