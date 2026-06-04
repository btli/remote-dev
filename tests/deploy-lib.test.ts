import { describe, it, expect } from "vitest";
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { dirname, delimiter as PATH_DELIM } from "path";
import {
  isAcceptableSsrStatus,
  restoreStandalone,
  deploySourceDir,
  gitSyncCommands,
  ancestryGuardDecision,
  isSafeDeploySrcToRemove,
  nativeRebuildCommand,
  pathWithRuntimeNodeFirst,
  NATIVE_MODULES_TO_REBUILD,
} from "../scripts/deploy-lib";

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
  it("replaces a stale live build with the newer slot build (forward-activation, remote-dev-4vmm)", () => {
    // Forward deploys build into a slot but historically never copied it over
    // the live serving dir — the restart then re-served the OLD build. This
    // locks in that activating a slot (the same restoreStandalone the forward
    // path now calls between stop and restart) fully replaces stale live
    // content with the freshly-built slot, including nested + asset dirs.
    const root = mkdtempSync(join(tmpdir(), "rdv-fwd-activate-"));
    try {
      const slot = join(root, "slot", "standalone");
      const live = join(root, "live", ".next", "standalone");

      // Freshly-built slot (NEW): a server bundle, static + public assets.
      mkdirSync(join(slot, ".next", "server"), { recursive: true });
      mkdirSync(join(slot, ".next", "static"), { recursive: true });
      mkdirSync(join(slot, "public"), { recursive: true });
      writeFileSync(join(slot, "server.js"), "NEW");
      writeFileSync(join(slot, ".next", "server", "page.js"), "NEW-PAGE");
      writeFileSync(join(slot, ".next", "static", "app.js"), "NEW-STATIC");
      writeFileSync(join(slot, "public", "favicon.ico"), "NEW-ICON");

      // Stale live build (OLD): an outdated bundle + a file the new build drops.
      mkdirSync(join(live, ".next", "server"), { recursive: true });
      writeFileSync(join(live, "server.js"), "OLD");
      writeFileSync(join(live, ".next", "server", "page.js"), "OLD-PAGE");
      writeFileSync(join(live, "removed-route.js"), "OLD-ONLY"); // must be gone

      const res = restoreStandalone(slot, live);
      expect(res.ok).toBe(true);

      // Live now mirrors the slot exactly: old content replaced by new...
      expect(readFileSync(join(live, "server.js"), "utf-8")).toBe("NEW");
      expect(readFileSync(join(live, ".next", "server", "page.js"), "utf-8")).toBe(
        "NEW-PAGE",
      );
      // ...assets (public + .next/static) carried over...
      expect(readFileSync(join(live, ".next", "static", "app.js"), "utf-8")).toBe(
        "NEW-STATIC",
      );
      expect(readFileSync(join(live, "public", "favicon.ico"), "utf-8")).toBe(
        "NEW-ICON",
      );
      // ...and files that only existed in the stale build are gone.
      expect(existsSync(join(live, "removed-route.js"))).toBe(false);
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

describe("deploySourceDir", () => {
  it("places the deploy source worktree under the data dir, outside the repo", () => {
    expect(deploySourceDir("/home/u/.remote-dev")).toBe("/home/u/.remote-dev/deploy-src");
  });
  it("composes relative data dirs with join (no double slashes)", () => {
    expect(deploySourceDir("/data/")).toBe("/data/deploy-src");
  });
});

describe("gitSyncCommands", () => {
  const PROJECT_ROOT = "/repo";
  const DEPLOY_SRC = "/data/deploy-src";

  it("first create: fetch in PROJECT_ROOT, then worktree add --detach @ origin/master", () => {
    const cmds = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, true);
    expect(cmds).toEqual([
      ["git", "-C", PROJECT_ROOT, "fetch", "origin"],
      ["git", "-C", PROJECT_ROOT, "worktree", "add", "--detach", DEPLOY_SRC, "origin/master"],
    ]);
  });

  it("first create never resets — only ever ADDS the worktree (no reset --hard)", () => {
    const cmds = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, true);
    const hasReset = cmds.some((c) => c.includes("reset"));
    expect(hasReset).toBe(false);
  });

  it("refresh: fetch + hard-reset to origin/master, all scoped to DEPLOY_SRC", () => {
    const cmds = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, false);
    expect(cmds).toEqual([
      ["git", "-C", DEPLOY_SRC, "fetch", "origin"],
      ["git", "-C", DEPLOY_SRC, "reset", "--hard", "origin/master"],
    ]);
  });

  it("refresh NEVER targets PROJECT_ROOT — the live tree is never touched", () => {
    const cmds = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, false);
    for (const cmd of cmds) {
      expect(cmd).not.toContain(PROJECT_ROOT);
    }
    // And the only reset present is the hard reset of DEPLOY_SRC to origin/master.
    const reset = cmds.find((c) => c.includes("reset"));
    expect(reset).toEqual(["git", "-C", DEPLOY_SRC, "reset", "--hard", "origin/master"]);
  });

  it("always pins to origin/master in both modes (only ever build origin/master)", () => {
    for (const firstCreate of [true, false]) {
      const cmds = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, firstCreate);
      const refsTouched = cmds.flat().filter((tok) => tok === "origin/master");
      expect(refsTouched.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("ancestryGuardDecision", () => {
  it("exit 0 → proceed (HEAD is ancestor of / equal to origin/master)", () => {
    expect(ancestryGuardDecision(0)).toBe("proceed");
  });
  it("exit 1 → diverged (local commits not on origin — refuse hard reset)", () => {
    expect(ancestryGuardDecision(1)).toBe("diverged");
  });
  it("other non-zero (e.g. 128 missing ref) → git-error, NOT diverged", () => {
    expect(ancestryGuardDecision(128)).toBe("git-error");
    expect(ancestryGuardDecision(2)).toBe("git-error");
    expect(ancestryGuardDecision(-1)).toBe("git-error");
  });
});

describe("isSafeDeploySrcToRemove", () => {
  const SEP = "/";
  it("allows the exact derived deploy-src path", () => {
    expect(isSafeDeploySrcToRemove("/home/u/.remote-dev/deploy-src", SEP)).toBe(true);
    // Whatever the data dir prefix, the trailing /deploy-src is what matters.
    expect(isSafeDeploySrcToRemove(deploySourceDir("/data"), SEP)).toBe(true);
  });
  it("refuses dangerous / unintended paths (mis-wired DATA_DIR)", () => {
    expect(isSafeDeploySrcToRemove("/", SEP)).toBe(false);
    expect(isSafeDeploySrcToRemove("", SEP)).toBe(false);
    expect(isSafeDeploySrcToRemove("/home/u/.remote-dev", SEP)).toBe(false);
    expect(isSafeDeploySrcToRemove("/home/u", SEP)).toBe(false);
    // A directory merely CONTAINING the token mid-path is not the leaf — refuse.
    expect(isSafeDeploySrcToRemove("/home/deploy-src/other", SEP)).toBe(false);
    // The bare segment with no separator prefix must not match.
    expect(isSafeDeploySrcToRemove("deploy-src", SEP)).toBe(false);
  });
  it("honors the supplied platform separator", () => {
    expect(isSafeDeploySrcToRemove("C:\\rd\\deploy-src", "\\")).toBe(true);
    // Right token, wrong separator → not the leaf under that platform's rules.
    expect(isSafeDeploySrcToRemove("C:\\rd\\deploy-src", "/")).toBe(false);
  });
});

describe("nativeRebuildCommand (remote-dev-7wgn)", () => {
  it("rebuilds the registered native modules from source, with foreground scripts", () => {
    expect(nativeRebuildCommand()).toEqual([
      "npm",
      "rebuild",
      "better-sqlite3",
      "--build-from-source",
      "--foreground-scripts",
    ]);
  });
  it("includes every module in NATIVE_MODULES_TO_REBUILD", () => {
    const cmd = nativeRebuildCommand();
    for (const m of NATIVE_MODULES_TO_REBUILD) {
      expect(cmd).toContain(m);
    }
  });
  it("accepts an explicit module list", () => {
    expect(nativeRebuildCommand(["a", "b"])).toEqual([
      "npm",
      "rebuild",
      "a",
      "b",
      "--build-from-source",
      "--foreground-scripts",
    ]);
  });
});

describe("pathWithRuntimeNodeFirst (remote-dev-7wgn)", () => {
  it("prepends the runtime node's dir to PATH", () => {
    const result = pathWithRuntimeNodeFirst(
      "/opt/homebrew/bin/node",
      "/usr/bin:/bin",
      ":",
      dirname,
    );
    expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });
  it("de-duplicates when the runtime dir is already present", () => {
    const result = pathWithRuntimeNodeFirst(
      "/opt/homebrew/bin/node",
      "/usr/bin:/opt/homebrew/bin:/bin",
      ":",
      dirname,
    );
    // The dir appears exactly once, and leading.
    expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(result.split(":").filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
  });
  it("handles an empty inherited PATH", () => {
    expect(
      pathWithRuntimeNodeFirst("/opt/homebrew/bin/node", "", ":", dirname),
    ).toBe("/opt/homebrew/bin");
  });
  it("works with the real platform delimiter + dirname", () => {
    const result = pathWithRuntimeNodeFirst(
      "/opt/homebrew/bin/node",
      `/x${PATH_DELIM}/y`,
      PATH_DELIM,
      dirname,
    );
    expect(result.split(PATH_DELIM)[0]).toBe("/opt/homebrew/bin");
  });
});
