/**
 * Tests for `src/lib/directory-browse.ts`.
 *
 * `validateBrowsePath` resolves symlinks via `realpath` before applying the
 * allowlist. For paths that exist it returns the real path; for paths that do
 * not exist it falls back to the lexically-resolved path and still applies the
 * separator-exact allowlist. We exercise both: a real temp dir created under
 * HOME for the allowed case, and synthetic non-existent paths for the
 * traversal / bypass cases (where the lexical-resolution branch is what guards
 * us).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  validateBrowsePath,
  validateFolderName,
  getAllowedPrefixes,
} from "../directory-browse";

describe("validateBrowsePath", () => {
  let allowedDir: string;

  beforeAll(async () => {
    // tmpdir() resolves into an allowed prefix (/tmp -> /private/tmp on macOS,
    // /tmp on Linux) and definitely exists, so realpath succeeds.
    allowedDir = await mkdtemp(join(tmpdir(), "rdv-dirbrowse-"));
  });

  afterAll(async () => {
    await rm(allowedDir, { recursive: true, force: true });
  });

  it("returns the real path for an allowed, existing directory", async () => {
    const result = await validateBrowsePath(allowedDir);
    expect(result).not.toBeNull();
    // The result is realpath-resolved; on macOS /tmp -> /private/tmp.
    const prefixes = getAllowedPrefixes();
    const ok = prefixes.some(
      (p) => result === p || result?.startsWith(p + sep)
    );
    expect(ok).toBe(true);
  });

  it("returns null for empty input", async () => {
    expect(await validateBrowsePath("")).toBeNull();
  });

  it("returns null when traversal escapes the allowed area", async () => {
    // `/Users/foo/../../etc/passwd` lexically resolves to `/etc/passwd`,
    // which is not under any allowed prefix.
    const result = await validateBrowsePath("/Users/foo/../../etc/shadow");
    expect(result).toBeNull();
  });

  it("returns null for a sibling-prefix bypass like /Users-evil", async () => {
    // Must not be accepted just because it starts with the string "/Users".
    expect(await validateBrowsePath("/Users-evil")).toBeNull();
    expect(await validateBrowsePath("/Users-evil/secrets")).toBeNull();
    expect(await validateBrowsePath("/home-hack")).toBeNull();
  });

  it("returns null for a non-allowed root", async () => {
    expect(await validateBrowsePath("/etc")).toBeNull();
    expect(await validateBrowsePath("/usr/local/bin")).toBeNull();
    expect(await validateBrowsePath("/")).toBeNull();
  });

  it("allows the exact /Users root", async () => {
    // /Users exists on macOS; on Linux it does not, but lexical resolution
    // still matches the prefix exactly, so the allowlist accepts it.
    expect(await validateBrowsePath("/Users")).toBe("/Users");
  });
});

describe("validateFolderName", () => {
  it("accepts a normal name and trims it", () => {
    expect(validateFolderName("my-folder")).toBe("my-folder");
    expect(validateFolderName("  spaced  ")).toBe("spaced");
  });

  it("rejects empty / whitespace-only names", () => {
    expect(validateFolderName("")).toBeNull();
    expect(validateFolderName("   ")).toBeNull();
  });

  it("rejects path separators", () => {
    expect(validateFolderName("a/b")).toBeNull();
    expect(validateFolderName("a\\b")).toBeNull();
    expect(validateFolderName("../escape")).toBeNull();
  });

  it("rejects '.' and '..'", () => {
    expect(validateFolderName(".")).toBeNull();
    expect(validateFolderName("..")).toBeNull();
  });

  it("rejects NUL bytes", () => {
    expect(validateFolderName("evil\0name")).toBeNull();
  });

  it("rejects folder names containing control characters", () => {
    expect(validateFolderName("a\nb")).toBeNull();
    expect(validateFolderName("a\rb")).toBeNull();
    expect(validateFolderName("a\tb")).toBeNull();
    expect(validateFolderName("a\x01b")).toBeNull();
    expect(validateFolderName("a\x00b")).toBeNull();
  });

  it("accepts legitimate dot-prefixed and multi-dot names", () => {
    expect(validateFolderName(".hidden")).toBe(".hidden");
    expect(validateFolderName("...")).toBe("...");
    expect(validateFolderName("my.folder.v2")).toBe("my.folder.v2");
  });

  it("rejects overly long names", () => {
    expect(validateFolderName("x".repeat(256))).toBeNull();
    expect(validateFolderName("x".repeat(255))).toBe("x".repeat(255));
  });
});
