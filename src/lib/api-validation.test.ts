import { describe, it, expect } from "vitest";
import { validateProjectPath } from "./api-validation";

describe("validateProjectPath", () => {
  const home = process.env.HOME || "/tmp";

  it("returns undefined for undefined or empty input", () => {
    expect(validateProjectPath(undefined)).toBeUndefined();
    expect(validateProjectPath("")).toBeUndefined();
  });

  it("rejects relative and whitespace-only paths", () => {
    expect(validateProjectPath("foo/bar")).toBeUndefined();
    expect(validateProjectPath("   ")).toBeUndefined();
  });

  it("canonicalizes traversal sequences within an allowed root", () => {
    expect(validateProjectPath("/tmp/a/b/../c")).toBe("/tmp/a/c");
    expect(validateProjectPath("/tmp//a///b")).toBe("/tmp/a/b");
    expect(validateProjectPath("/tmp/project/")).toBe("/tmp/project");
  });

  it("accepts paths under $HOME", () => {
    expect(validateProjectPath(`${home}/projects/app`)).toBe(`${home}/projects/app`);
  });

  it("accepts paths under /tmp", () => {
    expect(validateProjectPath("/tmp/workspace")).toBe("/tmp/workspace");
  });

  it("rejects paths outside $HOME and /tmp so the file endpoints stay sandboxed", () => {
    // Regression guard for the /api/files/* confinement: these must not become
    // arbitrary filesystem read/write.
    expect(validateProjectPath("/etc/passwd")).toBeUndefined();
    // Traversal that escapes the allowed roots is rejected after canonicalization.
    expect(validateProjectPath("/tmp/../etc/passwd")).toBeUndefined();
  });
});
