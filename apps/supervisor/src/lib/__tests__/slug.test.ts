import { describe, it, expect } from "vitest";
import {
  validateSlug,
  isValidSlug,
  isReserved,
  namespaceForSlug,
  RESERVED_SLUGS,
} from "@/lib/slug";

describe("validateSlug — format", () => {
  it("accepts valid slugs", () => {
    for (const s of ["a", "alpha", "alpha-1", "a1", "my-instance", "abcdefghijklmno"]) {
      expect(validateSlug(s).valid, s).toBe(true);
    }
  });

  it("rejects empty / non-string", () => {
    expect(validateSlug("").error).toBe("empty");
    expect(validateSlug(undefined).error).toBe("empty");
    expect(validateSlug(123).error).toBe("empty");
  });

  it("rejects bad formats", () => {
    expect(validateSlug("1abc").error).toBe("format"); // must start with a letter
    expect(validateSlug("-abc").error).toBe("format"); // cannot start with hyphen
    expect(validateSlug("Alpha").error).toBe("format"); // no uppercase
    expect(validateSlug("a_b").error).toBe("format"); // no underscore
    expect(validateSlug("a".repeat(16)).error).toBe("format"); // max 15 chars
    expect(validateSlug("al pha").error).toBe("format"); // no spaces
  });

  it("exactly 15 chars is allowed, 16 is not", () => {
    expect(validateSlug("a".repeat(15)).valid).toBe(true);
    expect(validateSlug("a".repeat(16)).valid).toBe(false);
  });
});

describe("reserved slugs", () => {
  it("flags every reserved name", () => {
    for (const r of RESERVED_SLUGS) expect(isReserved(r)).toBe(true);
  });

  it("includes the required root paths and supervisor prefix", () => {
    for (const r of [
      "api",
      "ws",
      "_next",
      "login",
      "healthz",
      "readyz",
      "manifest.json",
      "sw.js",
      "favicon.svg",
      "favicon.ico",
      "icons",
      "supervisor",
    ]) {
      expect(isReserved(r), r).toBe(true);
    }
  });

  it("validateSlug rejects reserved names that are otherwise well-formed", () => {
    // "api" is format-valid but reserved.
    expect(validateSlug("api").error).toBe("reserved");
    expect(validateSlug("login").error).toBe("reserved");
  });

  it("reserved check is case-insensitive", () => {
    expect(isReserved("API")).toBe(true);
  });

  it("non-reserved well-formed slug passes", () => {
    expect(isValidSlug("alpha")).toBe(true);
    expect(isReserved("alpha")).toBe(false);
  });
});

describe("namespaceForSlug", () => {
  it("maps slug -> rdv-<slug> (one namespace per instance, §15 B2)", () => {
    expect(namespaceForSlug("alpha")).toBe("rdv-alpha");
    expect(namespaceForSlug("my-instance")).toBe("rdv-my-instance");
  });
});
