// @vitest-environment node
/**
 * [remote-dev-ipbo] Tests for the attach-time dead-pane cwd classifier.
 *
 * THE incident regression: a pane parked in `.next/standalone` whose directory
 * EXISTS (the deploy re-created it) must still classify broken — the marker
 * check, not stat, catches it.
 *
 * THE false-positive regression: the terminal server's own process.cwd() is
 * the repo checkout, which is simultaneously a legitimate user project on a
 * dogfooding instance — it must NOT be a marker, or every healthy pane parked
 * at the repo root gets a false banner and a typed `cd` injected on reconnect.
 */
import { describe, expect, it } from "vitest";

import { classifyPaneCwd, computeServerAppDirMarkers } from "./detect-dead-pane-cwd";

/** Mirrors real usage: markers derived from the server's cwd (repo checkout). */
const MARKERS = computeServerAppDirMarkers("/srv/app");

/** statFn that accepts every path. */
const statOk = (): void => {};
/** statFn that rejects every path (deleted dir). */
const statFail = (): void => {
  throw new Error("ENOENT");
};

function classify(
  panePath: string,
  paneCommand: string,
  statFn: (p: string) => void = statOk,
  sessionProjectPath?: string,
) {
  return classifyPaneCwd(panePath, paneCommand, {
    statFn,
    serverAppDirMarkers: MARKERS,
    sessionProjectPath,
  });
}

describe("computeServerAppDirMarkers", () => {
  it("marks only the nested .next/standalone dir, NOT the server cwd itself", () => {
    // The terminal server runs from the repo checkout — a legitimate user
    // project when dogfooding. Including it would false-positive every pane
    // parked at the repo root.
    expect(computeServerAppDirMarkers("/srv/app")).toEqual([
      "/srv/app/.next/standalone",
    ]);
  });

  it("uses the cwd itself when the server already runs from .next/standalone", () => {
    expect(computeServerAppDirMarkers("/srv/app/.next/standalone")).toEqual([
      "/srv/app/.next/standalone",
    ]);
  });
});

describe("classifyPaneCwd", () => {
  it("classifies a healthy pane as not broken", () => {
    expect(classify("/projects/app", "zsh")).toEqual({
      broken: false,
      reason: null,
      healable: false,
    });
  });

  it("does NOT flag a pane parked at the server's own cwd (dogfooding repo root)", () => {
    // THE false-positive regression: /srv/app is the terminal server's cwd
    // AND a legitimate project directory — must be healthy.
    expect(classify("/srv/app", "zsh")).toEqual({
      broken: false,
      reason: null,
      healable: false,
    });
  });

  it("classifies a stat failure (deleted dir) as broken/stat-failed", () => {
    const result = classify("/deleted/dir", "zsh", statFail);
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("stat-failed");
    expect(result.healable).toBe(true);
  });

  it("classifies a pane AT a server-app-dir marker as broken even when stat succeeds", () => {
    // THE incident pane: the rebuilt .next/standalone exists again, so stat
    // passes — only the marker comparison catches it.
    const result = classify("/srv/app/.next/standalone", "zsh", statOk);
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("in-server-app-dir");
    expect(result.healable).toBe(true);
  });

  it("still flags the marker when the session project is its ancestor (dogfood incident)", () => {
    // A remote-dev-on-remote-dev session poisoned into the server standalone
    // dir: under its own project, but AT the marker — marker wins.
    const result = classify("/srv/app/.next/standalone", "zsh", statOk, "/srv/app");
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("in-server-app-dir");
  });

  it("classifies a foreign path ending in /.next/standalone as broken", () => {
    const result = classify("/elsewhere/.next/standalone", "bash", statOk);
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("in-server-app-dir");
  });

  it("exempts the session's OWN .next/standalone from the suffix rule", () => {
    // A user deliberately inspecting their own project's standalone build
    // must not be "healed" back out of it.
    const result = classify(
      "/projects/my-next-app/.next/standalone",
      "zsh",
      statOk,
      "/projects/my-next-app",
    );
    expect(result.broken).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("still stat-checks the session's own .next/standalone when exempted", () => {
    const result = classify(
      "/projects/my-next-app/.next/standalone",
      "zsh",
      statFail,
      "/projects/my-next-app",
    );
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("stat-failed");
  });

  it("treats a pane exactly at its session row's project path as healthy", () => {
    // Healthy by definition — even if it coincided with a marker, a pane
    // sitting where its row says it belongs needs no heal.
    const result = classifyPaneCwd("/srv/app/.next/standalone", "zsh", {
      statFn: statOk,
      serverAppDirMarkers: MARKERS,
      sessionProjectPath: "/srv/app/.next/standalone",
    });
    expect(result.broken).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("classifies an empty pane path as broken", () => {
    const result = classify("", "zsh");
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("stat-failed");
    expect(result.healable).toBe(true);
  });

  it("marks broken panes healable only for plain shells", () => {
    for (const shell of ["zsh", "bash", "sh", "fish", "-zsh", "-bash", "-sh", "-fish"]) {
      expect(classify("/deleted", shell, statFail).healable).toBe(true);
    }
    for (const nonShell of ["claude", "vim", "node"]) {
      const result = classify("/deleted", nonShell, statFail);
      expect(result.broken).toBe(true);
      expect(result.healable).toBe(false);
    }
  });

  it("never marks a healthy pane healable, even for shells", () => {
    expect(classify("/projects/app", "zsh").healable).toBe(false);
  });
});
