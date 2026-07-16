// @vitest-environment node
/**
 * [remote-dev-ipbo] Tests for the attach-time dead-pane cwd classifier.
 *
 * THE incident regression: a pane parked in `.next/standalone` whose directory
 * EXISTS (the deploy re-created it) must still classify broken — the marker
 * check, not stat, catches it.
 */
import { describe, expect, it } from "vitest";

import { classifyPaneCwd } from "./detect-dead-pane-cwd";

const MARKERS = ["/srv/app", "/srv/app/.next/standalone"];

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
) {
  return classifyPaneCwd(panePath, paneCommand, {
    statFn,
    serverAppDirMarkers: MARKERS,
  });
}

describe("classifyPaneCwd", () => {
  it("classifies a healthy pane as not broken", () => {
    expect(classify("/projects/app", "zsh")).toEqual({
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

  it("classifies ANY path ending in /.next/standalone as broken", () => {
    const result = classify("/elsewhere/.next/standalone", "bash", statOk);
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("in-server-app-dir");
  });

  it("classifies an empty pane path as broken", () => {
    const result = classify("", "zsh");
    expect(result.broken).toBe(true);
    expect(result.reason).toBe("stat-failed");
    expect(result.healable).toBe(true);
  });

  it("marks broken panes healable only for plain shells", () => {
    for (const shell of ["zsh", "bash", "sh", "fish", "-zsh", "-bash", "-sh"]) {
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
