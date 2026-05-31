import { describe, expect, it } from "vitest";
import {
  isReserved,
  isValidSlug,
  namespaceForSlug,
  RESERVED_SLUGS,
  validateSlug,
} from "@/lib/slug";

describe("validateSlug", () => {
  it.each(["alpha", "a", "my-inst", "a1", "abcdefghijklmno" /* 15 chars */])(
    "accepts %s",
    (slug) => {
      expect(validateSlug(slug)).toEqual({ valid: true });
      expect(isValidSlug(slug)).toBe(true);
    },
  );

  it("rejects empty", () => {
    expect(validateSlug("")).toMatchObject({ valid: false, error: "empty" });
    expect(validateSlug(undefined)).toMatchObject({ valid: false, error: "empty" });
  });

  it.each([
    "1bad", // must start with a letter
    "Bad", // uppercase
    "has_underscore",
    "has.dot",
    "abcdefghijklmnop", // 16 chars (too long)
    "-leading-hyphen",
  ])("rejects malformed %s", (slug) => {
    expect(validateSlug(slug)).toMatchObject({ valid: false, error: "format" });
  });

  it.each([...RESERVED_SLUGS])("rejects reserved %s", (slug) => {
    // Reserved values that also pass the format check report `reserved`;
    // values like `manifest.json` fail format first — both are invalid.
    const result = validateSlug(slug);
    expect(result.valid).toBe(false);
  });

  it("flags simple reserved names as reserved (not format)", () => {
    expect(validateSlug("api")).toMatchObject({ valid: false, error: "reserved" });
    expect(validateSlug("supervisor")).toMatchObject({
      valid: false,
      error: "reserved",
    });
    expect(isReserved("API")).toBe(true); // case-insensitive
  });
});

describe("namespaceForSlug", () => {
  it("prefixes with rdv-", () => {
    expect(namespaceForSlug("alpha")).toBe("rdv-alpha");
    expect(namespaceForSlug("my-inst")).toBe("rdv-my-inst");
  });
});
