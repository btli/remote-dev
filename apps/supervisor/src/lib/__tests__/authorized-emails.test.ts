import { describe, it, expect, vi } from "vitest";
import {
  normalizeAuthorizedEmailsStrict,
  normalizeAuthorizedEmailsLenient,
  AuthorizedEmailsError,
  MAX_ENTRIES,
  MAX_EMAIL_LEN,
} from "@/lib/authorized-emails";

/**
 * Tests for the shared authorized-emails normalizer (remote-dev-sb98). The
 * load-bearing rule is that a comma INSIDE an entry must never survive (it would
 * split into extra authorized users via the AUTHORIZED_USERS env round-trip), and
 * that control chars / oversized / over-count lists are bounded. STRICT throws
 * (API 400); LENIENT drops + caps (reconciler read).
 *
 * Control chars in test inputs use explicit escapes (\n, \r, \t) so the bytes are
 * unambiguous and interior (not leading/trailing, which trim() would strip).
 */

describe("normalizeAuthorizedEmailsStrict", () => {
  it("trims, drops blanks, and exact-case dedupes (order preserved)", () => {
    expect(
      normalizeAuthorizedEmailsStrict([" a@x.com ", "", "b@x.com", "a@x.com"]),
    ).toEqual(["a@x.com", "b@x.com"]);
  });

  it("preserves case (exact-case dedupe, not case-insensitive)", () => {
    expect(normalizeAuthorizedEmailsStrict(["A@x.com", "a@x.com"])).toEqual([
      "A@x.com",
      "a@x.com",
    ]);
  });

  it("rejects an entry containing a comma (the env delimiter)", () => {
    expect(() => normalizeAuthorizedEmailsStrict(["a@x.com,b@x.com"])).toThrow(
      AuthorizedEmailsError,
    );
    expect(() => normalizeAuthorizedEmailsStrict(["a@x.com,b@x.com"])).toThrow(
      /comma/,
    );
  });

  it("rejects an entry containing an interior control char (CR/LF/TAB)", () => {
    for (const bad of ["a\nb@x.com", "a\rb@x.com", "a\tb@x.com"]) {
      expect(() => normalizeAuthorizedEmailsStrict([bad])).toThrow(
        /control character/,
      );
    }
  });

  it("allows an interior space (a space is not a control char)", () => {
    // Only commas + control chars are rejected; a plain space passes through.
    expect(normalizeAuthorizedEmailsStrict(["a b@x.com"])).toEqual(["a b@x.com"]);
  });

  it("rejects an entry longer than MAX_EMAIL_LEN", () => {
    const tooLong = "a".repeat(MAX_EMAIL_LEN + 1) + "@x.com";
    expect(() => normalizeAuthorizedEmailsStrict([tooLong])).toThrow(
      new RegExp(`${MAX_EMAIL_LEN}`),
    );
  });

  it("rejects when the deduped list exceeds MAX_ENTRIES", () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => `u${i}@x.com`);
    expect(() => normalizeAuthorizedEmailsStrict(many)).toThrow(/too many/);
    // Exactly MAX_ENTRIES is allowed.
    const exactly = Array.from({ length: MAX_ENTRIES }, (_, i) => `u${i}@x.com`);
    expect(normalizeAuthorizedEmailsStrict(exactly)).toHaveLength(MAX_ENTRIES);
  });

  it("normalizes an all-blank input to [] (no throw)", () => {
    expect(normalizeAuthorizedEmailsStrict(["", "  "])).toEqual([]);
  });
});

describe("normalizeAuthorizedEmailsLenient", () => {
  it("returns [] (with onDrop reason) when input is not an array", () => {
    const dropped: string[] = [];
    expect(
      normalizeAuthorizedEmailsLenient("nope", (_e, r) => dropped.push(r)),
    ).toEqual([]);
    expect(dropped).toEqual(["not an array"]);
  });

  it("DROPS a comma-bearing entry but keeps the valid remainder", () => {
    const onDrop = vi.fn();
    const out = normalizeAuthorizedEmailsLenient(
      ["ok@x.com", "evil@x.com,extra@x.com", "ok2@x.com"],
      onDrop,
    );
    expect(out).toEqual(["ok@x.com", "ok2@x.com"]);
    expect(onDrop).toHaveBeenCalledWith("evil@x.com,extra@x.com", "contains a comma");
  });

  it("drops non-string + control-char entries, trims, and exact-case dedupes", () => {
    const out = normalizeAuthorizedEmailsLenient([
      " a@x.com ",
      123,
      "a@x.com",
      "b\tx@x.com",
      "c@x.com",
    ]);
    expect(out).toEqual(["a@x.com", "c@x.com"]);
  });

  it("caps survivors at MAX_ENTRIES, dropping the overflow", () => {
    const onDrop = vi.fn();
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => `u${i}@x.com`);
    const out = normalizeAuthorizedEmailsLenient(many, onDrop);
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(onDrop).toHaveBeenCalledWith(
      `u${MAX_ENTRIES}@x.com`,
      `exceeds max ${MAX_ENTRIES} entries`,
    );
  });
});
