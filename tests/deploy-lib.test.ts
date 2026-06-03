import { describe, it, expect } from "vitest";
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isAcceptableSsrStatus, restoreStandalone } from "../scripts/deploy-lib";

describe("isAcceptableSsrStatus", () => {
  it("accepts 2xx/3xx on / (unauth redirect to /login)", () => {
    expect(isAcceptableSsrStatus("/", 307)).toBe(true);
    expect(isAcceptableSsrStatus("/", 200)).toBe(true);
  });
  it("rejects 5xx on / — the broken-build signature", () => {
    expect(isAcceptableSsrStatus("/", 500)).toBe(false);
    expect(isAcceptableSsrStatus("/", 502)).toBe(false);
  });
  it("rejects 4xx on / (routing broken)", () => {
    expect(isAcceptableSsrStatus("/", 404)).toBe(false);
  });
  it("requires exactly 200 on /login", () => {
    expect(isAcceptableSsrStatus("/login", 200)).toBe(true);
    expect(isAcceptableSsrStatus("/login", 500)).toBe(false);
    expect(isAcceptableSsrStatus("/login", 307)).toBe(false);
  });
});

describe("restoreStandalone", () => {
  it("copies the slot standalone over the live dir, replacing old content", () => {
    const root = mkdtempSync(join(tmpdir(), "rdv-restore-"));
    try {
      const src = join(root, "slot", "standalone");
      const live = join(root, "live", ".next", "standalone");
      mkdirSync(join(src, ".next", "static"), { recursive: true });
      writeFileSync(join(src, "marker.txt"), "GOOD");
      writeFileSync(join(src, ".next", "static", "app.js"), "ok");
      mkdirSync(live, { recursive: true });
      writeFileSync(join(live, "stale.txt"), "BROKEN"); // must be removed

      const res = restoreStandalone(src, live);
      expect(res.ok).toBe(true);
      expect(readFileSync(join(live, "marker.txt"), "utf-8")).toBe("GOOD");
      expect(existsSync(join(live, ".next", "static", "app.js"))).toBe(true);
      expect(existsSync(join(live, "stale.txt"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("returns ok:false when the slot has no standalone build", () => {
    const root = mkdtempSync(join(tmpdir(), "rdv-restore-"));
    try {
      const res = restoreStandalone(
        join(root, "missing", "standalone"),
        join(root, "live", ".next", "standalone"),
      );
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
