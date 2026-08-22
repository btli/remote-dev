// @vitest-environment node
//
// Regression tests for the LaunchAgent bun-path resolution.
//
// Background: `install-supervision.ts` used to render the plist's exec path
// from `process.execPath`, which bun resolves to the VERSIONED Homebrew Cellar
// path (`…/Cellar/bun/<version>/bin/bun`). The next `brew upgrade bun` deletes
// that path, so launchd can no longer exec the wrapper — prod hangs in
// `spawn scheduled` with a stale `exit 78` (the 2026-08-21 dev.bryanli.net
// outage). `resolveStableBunPath` rewrites a Cellar keg path to the
// upgrade-stable Homebrew symlink instead.

import { describe, expect, it } from "vitest";

import { resolveStableBunPath } from "../scripts/bun-path";

const never = () => false;
const always = () => true;
const onlyThese = (present: string[]) => (p: string) => present.includes(p);

describe("resolveStableBunPath", () => {
  it("rewrites an Apple-silicon Homebrew Cellar keg to the stable bin symlink", () => {
    expect(
      resolveStableBunPath(
        "/opt/homebrew/Cellar/bun/1.4.0/bin/bun",
        onlyThese(["/opt/homebrew/bin/bun"]),
      ),
    ).toBe("/opt/homebrew/bin/bun");
  });

  it("rewrites an Intel Homebrew Cellar keg to /usr/local/bin/bun", () => {
    expect(
      resolveStableBunPath(
        "/usr/local/Cellar/bun/1.4.0/bin/bun",
        onlyThese(["/usr/local/bin/bun"]),
      ),
    ).toBe("/usr/local/bin/bun");
  });

  it("falls back to the opt/<formula> symlink when bin/bun is absent", () => {
    expect(
      resolveStableBunPath(
        "/opt/homebrew/Cellar/bun/1.4.0/bin/bun",
        onlyThese(["/opt/homebrew/opt/bun/bin/bun"]),
      ),
    ).toBe("/opt/homebrew/opt/bun/bin/bun");
  });

  it("prefers bin/bun over opt/bun/bin/bun when both exist", () => {
    expect(
      resolveStableBunPath("/opt/homebrew/Cellar/bun/1.4.0/bin/bun", always),
    ).toBe("/opt/homebrew/bin/bun");
  });

  it("returns the Cellar path unchanged when no stable symlink exists (never invent a broken path)", () => {
    const cellar = "/opt/homebrew/Cellar/bun/1.4.0/bin/bun";
    expect(resolveStableBunPath(cellar, never)).toBe(cellar);
  });

  it("leaves a non-Homebrew install (~/.bun) untouched — it is already stable", () => {
    const p = "/Users/someone/.bun/bin/bun";
    // `exists` must not even be consulted for a non-Cellar path.
    expect(
      resolveStableBunPath(p, () => {
        throw new Error("exists() should not be called for non-Cellar paths");
      }),
    ).toBe(p);
  });

  it("leaves an arbitrary absolute bun path untouched", () => {
    expect(resolveStableBunPath("/usr/bin/bun", never)).toBe("/usr/bin/bun");
  });

  it("does not rewrite a lookalike path that is not a bun Cellar keg", () => {
    // A Cellar path for a DIFFERENT formula must not match.
    const p = "/opt/homebrew/Cellar/node/26.7.0/bin/bun";
    expect(resolveStableBunPath(p, always)).toBe(p);
  });
});
