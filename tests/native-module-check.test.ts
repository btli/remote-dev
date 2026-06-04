import { describe, it, expect } from "vitest";
import {
  isAbiMismatchError,
  probeBetterSqlite3,
} from "../src/lib/native-module-check";

describe("isAbiMismatchError", () => {
  it("classifies the canonical Node NODE_MODULE_VERSION message as an ABI mismatch", () => {
    // The real shape Node throws from process.dlopen on ABI skew.
    const err = new Error(
      "The module '/Users/x/.next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node' " +
        "was compiled against a different Node.js version using NODE_MODULE_VERSION 141. " +
        "This version of Node.js requires NODE_MODULE_VERSION 147. " +
        "Please try re-compiling or re-installing the module.",
    ) as Error & { code?: string };
    err.code = "ERR_DLOPEN_FAILED";
    expect(isAbiMismatchError(err)).toBe(true);
  });

  it("classifies on the ERR_DLOPEN_FAILED code alone (message wording changed)", () => {
    const err = new Error("could not load addon") as Error & { code?: string };
    err.code = "ERR_DLOPEN_FAILED";
    expect(isAbiMismatchError(err)).toBe(true);
  });

  it("classifies on the NODE_MODULE_VERSION marker alone (no code set)", () => {
    const err = new Error(
      "compiled against a different Node.js version using NODE_MODULE_VERSION 141",
    );
    expect(isAbiMismatchError(err)).toBe(true);
  });

  it("matches a plain object error shape (not an Error instance)", () => {
    expect(
      isAbiMismatchError({ message: "x", code: "ERR_DLOPEN_FAILED" }),
    ).toBe(true);
  });

  it("does NOT classify unrelated errors", () => {
    expect(isAbiMismatchError(new Error("ENOENT: no such file"))).toBe(false);
    expect(
      isAbiMismatchError(new Error("SQLITE_BUSY: database is locked")),
    ).toBe(false);
  });

  it("does NOT classify a generic missing-module error as an ABI mismatch", () => {
    const err = new Error(
      "Cannot find module 'better-sqlite3'",
    ) as Error & { code?: string };
    err.code = "MODULE_NOT_FOUND";
    expect(isAbiMismatchError(err)).toBe(false);
  });

  it("is null/undefined/primitive safe", () => {
    expect(isAbiMismatchError(null)).toBe(false);
    expect(isAbiMismatchError(undefined)).toBe(false);
    expect(isAbiMismatchError("NODE_MODULE_VERSION")).toBe(false);
    expect(isAbiMismatchError(141)).toBe(false);
  });
});

describe("probeBetterSqlite3", () => {
  // In the test runtime better-sqlite3 is ABI-correct (vitest runs under the
  // same Node that installed it), so the live probe should succeed. This guards
  // the happy path and ensures the probe opens/closes a throwaway DB cleanly.
  it("succeeds against the correctly-built test-runtime addon", async () => {
    const result = await probeBetterSqlite3();
    expect(result.ok).toBe(true);
    expect(result.abiMismatch).toBe(false);
    expect(result.error).toBeUndefined();
  });
});
