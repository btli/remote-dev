// @vitest-environment node
//
// Unit tests for the prod supervision core (remote-dev-7fsq — Spec v3 §5).
// Everything runs against INJECTED exec/fs/clock/kill deps — no bun:ffi, no
// launchctl, no real processes. Covered here:
//
//   - delegation decision tables incl. provenance forgeries [R1] and every
//     fail-closed branch [F9];
//   - manifest lifecycle: atomic temp+rename writes, pointer flip, phase
//     transitions, corrupt-manifest fail-closed [R3];
//   - process identity verification (startTimeNs mismatch ⇒ refuse) [R13];
//   - the socket dev/ino unlink rule incl. mismatch [R2];
//   - reclaim of prior generations (identity-verified PGID kills, owned-socket
//     unlinks, orphan sockets, archiving);
//   - custody journal write/recovery classification (abandoned vs intentional
//     stop) [R4, R5];
//   - grace counting math incl. worst-case tick alignment [R10];
//   - ledger thresholds (>= 3/hour) + restart-vs-generation ledger separation
//     (generation starts never stamp last-restart) [R12];
//   - the watchdog-act transaction: deploy suppression, desired-state gating,
//     grace deferral, the gen-keyed flap fast-path, and custody recovery.
//
// The pure-flock vs deploy-flock behavior split [R14] needs real kernel
// flocks and lives in tests/pure-flock.test.ts (bun subprocess fixtures).

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  CorruptManifestError,
  DEFAULT_MAX_FAILURES,
  SupervisionEvidenceError,
  beginChildSpawn,
  claimedSocketPaths,
  clearDeployRestartToken,
  commandMatchesRecorded,
  closeOutCustodyJournal,
  completeChildSpawn,
  consumeDeployRestartToken,
  custodyJournalOwnedBy,
  isPidAliveDeps,
  issueDeployRestartToken,
  manifestFullyDead,
  maxGenerationLedgerNumber,
  probeUnixHttp,
  reconcileAbandonedDeployResult,
  recordChildSpawnPid,
  socketHolder,
  unresolvedPlaceholders,
  ESCALATION_THRESHOLD,
  FLAP_TICKS_REQUIRED,
  GRACE_SECONDS,
  PROD_LABEL,
  appendGenerationStart,
  appendLedger,
  attributeAndKillGroup,
  archiveManifest,
  classifyCustody,
  countLedgerSince,
  currentGenerationState,
  custodyOwnerAlive,
  decideRestartProd,
  decideStartProd,
  decideStopProd,
  deployLockHolderPid,
  deployLockLive,
  doctorSupervision,
  evaluateEscalation,
  evaluateGraceTick,
  flipCurrentGen,
  listGenerations,
  nextGenNumber,
  pgroupOccupied,
  procEntryFullyDead,
  procIdentityState,
  readCurrentGen,
  readCustodyJournal,
  readDesiredState,
  readManifest,
  readWatchdogState,
  reclaimPriorGenerations,
  supervisionPaths,
  unlinkOwnedSocket,
  updateManifestPhase,
  verifyLaunchdProvenance,
  verifyProcIdentity,
  waitForGenerationExit,
  watchdogAct,
  writeCustodyJournal,
  writeDesiredState,
  writeManifest,
  writeWatchdogState,
  type CustodyJournal,
  type DelegationInput,
  type FsDeps,
  type GenerationManifest,
  type LstatInfo,
  type ProcId,
  type SupervisionDeps,
  type SupervisionPaths,
} from "../scripts/rdv-supervision";

// ─────────────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────────────

class FakeFs implements FsDeps {
  files = new Map<string, string>();
  /** lstat entries for non-regular paths (sockets). */
  stats = new Map<string, LstatInfo>();
  unlinked: string[] = [];
  renames: Array<[string, string]> = [];
  writes: string[] = [];
  /** Permission bits passed to writeFileSync (0600 token file, …). */
  modes = new Map<string, number>();
  /**
   * Injected non-ENOENT readdir failure — the "evidence unavailable" case that
   * must never read as "no generations".
   */
  readdirFailure: Error | null = null;
  /** Injected non-ENOENT lstat failure, same rule. */
  lstatFailure: Error | null = null;

  existsSync(p: string): boolean {
    return this.files.has(p) || this.stats.has(p);
  }
  readFileSync(p: string): string {
    const v = this.files.get(p);
    if (v === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    return v;
  }
  writeFileSync(p: string, data: string, mode?: number): void {
    this.files.set(p, data);
    this.writes.push(p);
    if (mode !== undefined) this.modes.set(p, mode);
  }
  appendFileSync(p: string, data: string): void {
    this.files.set(p, (this.files.get(p) ?? "") + data);
  }
  renameSync(from: string, to: string): void {
    const v = this.files.get(from);
    if (v === undefined) throw Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" });
    this.files.delete(from);
    this.files.set(to, v);
    this.renames.push([from, to]);
  }
  unlinkSync(p: string): void {
    this.files.delete(p);
    this.stats.delete(p);
    this.unlinked.push(p);
  }
  mkdirSync(): void {
    /* directories are implicit in the fake */
  }
  readdirSync(dir: string): string[] {
    if (this.readdirFailure) throw this.readdirFailure;
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.stats.keys()]) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
    }
    return [...names];
  }
  lstatSync(p: string): LstatInfo | null {
    if (this.lstatFailure) throw this.lstatFailure;
    const st = this.stats.get(p);
    if (st) return st;
    // Regular files lstat as non-sockets (dev/ino irrelevant for them here).
    if (this.files.has(p)) return { dev: 1, ino: 1, isSocket: false };
    return null;
  }
}

interface FakeWorld {
  deps: SupervisionDeps;
  fs: FakeFs;
  paths: SupervisionPaths;
  execCalls: string[][];
  killCalls: Array<[number, NodeJS.Signals | 0]>;
  logs: string[];
  /** pid → startTimeNs (presence == alive). */
  procs: Map<number, string>;
  /** pid → pgid (defaults to pid). */
  pgids: Map<number, number>;
  /** pgids whose member processes survive every signal (EPERM-style). */
  unkillablePgids: Set<number>;
  /** pids that are ALIVE but whose start time cannot be read (sysctl failure). */
  identityUnavailablePids: Set<number>;
  /** pid → command line for `ps -o command=` (absent ⇒ unreadable). */
  procCommands: Map<number, string>;
  /** socket path → live holder pids for `lsof` (absent/empty ⇒ free). */
  socketHolders: Map<string, number[]>;
  setNow(ms: number): void;
  now(): number;
  setJobLoaded(v: boolean | "unknown"): void;
  setKickstartFails(v: boolean): void;
  setBootstrapFails(v: boolean): void;
  /** HTTP code every curl probe returns (default "000" = unhealthy). */
  setCurlCode(v: string): void;
  /** Mark both prod sockets present + probes 200 (a healthy stack). */
  makeHealthy(): void;
}

function makeWorld(): FakeWorld {
  const fs = new FakeFs();
  const paths = supervisionPaths({ RDV_DATA_DIR: "/data", HOME: "/home/u" });
  const execCalls: string[][] = [];
  const killCalls: Array<[number, NodeJS.Signals | 0]> = [];
  const logs: string[] = [];
  const procs = new Map<number, string>();
  const pgids = new Map<number, number>();
  const unkillablePgids = new Set<number>();
  const identityUnavailablePids = new Set<number>();
  /** pid → command line, as `ps -o command=` would report it. */
  const procCommands = new Map<number, string>();
  /** socket path → pids holding it, as `lsof -t -U` would report. */
  const socketHolders = new Map<string, number[]>();
  let nowMs = 1_700_000_000_000;
  let jobLoaded: boolean | "unknown" = true;
  let kickstartFails = false;
  let bootstrapFails = false;
  let curlCode = "000";

  const killGroup = (pgid: number): void => {
    if (unkillablePgids.has(pgid)) return; // survives every signal
    for (const [pid, gid] of [...pgids.entries()]) {
      if (gid === pgid) {
        procs.delete(pid);
        pgids.delete(pid);
      }
    }
    // pids without an explicit pgid entry default to pgid == pid.
    if (procs.has(pgid) && !pgids.has(pgid)) procs.delete(pgid);
  };

  /** Does any live pid belong to this pgroup? (default pgid == pid) */
  const groupHasMembers = (pgid: number): boolean => {
    if (unkillablePgids.has(pgid)) return true;
    for (const pid of procs.keys()) {
      if ((pgids.get(pid) ?? pid) === pgid) return true;
    }
    for (const pid of identityUnavailablePids) {
      if ((pgids.get(pid) ?? pid) === pgid) return true;
    }
    return false;
  };

  const deps: SupervisionDeps = {
    fs,
    exec: (cmd) => {
      execCalls.push(cmd);
      if (cmd[0] === "launchctl" && cmd[1] === "print") {
        if (jobLoaded === "unknown") return { exitCode: 127, stdout: "", stderr: "not found" };
        return { exitCode: jobLoaded ? 0 : 113, stdout: "", stderr: "" };
      }
      if (cmd[0] === "launchctl" && cmd[1] === "kickstart" && kickstartFails) {
        return { exitCode: 1, stdout: "", stderr: "kickstart failed" };
      }
      if (cmd[0] === "launchctl" && cmd[1] === "bootstrap" && bootstrapFails) {
        return { exitCode: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" };
      }
      if (cmd[0] === "ps") {
        const pid = parseInt(cmd[cmd.length - 1], 10);
        if (cmd.includes("command=")) {
          // Command lines are only known for pids the test registered.
          const command = procCommands.get(pid);
          if (command === undefined) return { exitCode: 1, stdout: "", stderr: "" };
          return { exitCode: 0, stdout: `${command}\n`, stderr: "" };
        }
        if (!procs.has(pid)) return { exitCode: 1, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: ` ${pgids.get(pid) ?? pid}\n`, stderr: "" };
      }
      if (cmd[0] === "lsof") {
        const path = cmd[cmd.length - 1];
        const holders = socketHolders.get(path) ?? [];
        if (holders.length === 0) return { exitCode: 1, stdout: "", stderr: "" };
        return cmd.includes("-t")
          ? { exitCode: 0, stdout: `${holders.join("\n")}\n`, stderr: "" }
          : { exitCode: 0, stdout: `COMMAND PID\nserver ${holders[0]}\n`, stderr: "" };
      }
      if (cmd[0] === "pgrep" && cmd[1] === "-g") {
        // Group enumeration for start-time attribution [F4].
        const pgid = parseInt(cmd[2], 10);
        const members = new Set<number>();
        for (const pid of procs.keys()) {
          if ((pgids.get(pid) ?? pid) === pgid) members.add(pid);
        }
        for (const pid of identityUnavailablePids) {
          if ((pgids.get(pid) ?? pid) === pgid) members.add(pid);
        }
        if (members.size === 0) return { exitCode: 1, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: `${[...members].join("\n")}\n`, stderr: "" };
      }
      if (cmd[0] === "curl") {
        return { exitCode: 0, stdout: curlCode, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += Math.max(ms, 100);
    },
    kill: (pid, signal) => {
      killCalls.push([pid, signal]);
      if (pid < 0) {
        // Group signal: signal 0 probes occupancy (ESRCH = empty), a real
        // signal kills the members (unless the group is marked unkillable).
        if (signal === 0) {
          if (!groupHasMembers(-pid)) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
          return;
        }
        killGroup(-pid);
        return;
      }
      if (signal === 0) {
        if (!procs.has(pid) && !identityUnavailablePids.has(pid)) {
          throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        }
        return;
      }
      procs.delete(pid);
    },
    procStartTimeNs: (pid) => (identityUnavailablePids.has(pid) ? null : (procs.get(pid) ?? null)),
    uid: () => 501,
    tryFlock: async (path) => ({ fd: 42, path, release: () => {} }),
    log: (m) => logs.push(m),
  };

  return {
    deps,
    fs,
    paths,
    execCalls,
    killCalls,
    logs,
    procs,
    pgids,
    unkillablePgids,
    identityUnavailablePids,
    procCommands,
    socketHolders,
    setNow: (ms) => {
      nowMs = ms;
    },
    now: () => nowMs,
    setJobLoaded: (v) => {
      jobLoaded = v;
    },
    setKickstartFails: (v) => {
      kickstartFails = v;
    },
    setBootstrapFails: (v) => {
      bootstrapFails = v;
    },
    setCurlCode: (v) => {
      curlCode = v;
    },
    makeHealthy: () => {
      curlCode = "200";
      fs.stats.set(paths.nextSocket, { dev: 7, ino: 70, isSocket: true });
      fs.stats.set(paths.terminalSocket, { dev: 7, ino: 71, isSocket: true });
    },
  };
}

/** Unwrap readDesiredState's tri-state for assertions. */
function desiredOf(w: FakeWorld): string | null {
  const d = readDesiredState(w.deps, w.paths);
  return d === "corrupt" ? "corrupt" : (d?.state ?? null);
}

function baseInput(overrides: Partial<DelegationInput> = {}): DelegationInput {
  return {
    launchdChildFlag: false,
    ppid: 1234,
    xpcServiceName: undefined,
    label: PROD_LABEL,
    jobLoaded: true,
    plistInstalled: true,
    desiredState: "running",
    deployLockLive: false,
    foregroundDeployAuthorized: false,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<GenerationManifest> = {}): GenerationManifest {
  return {
    gen: 1,
    phase: "running",
    startedAt: 1_700_000_000_000,
    wrapper: { pid: 100, pgid: 100, startTimeNs: "111" },
    next: { pid: 200, pgid: 200, startTimeNs: "222" },
    terminal: { pid: 300, pgid: 300, startTimeNs: "333" },
    sockets: {
      next: { path: "/data/run/nextjs.sock", dev: 5, ino: 50 },
      terminal: { path: "/data/run/terminal.sock", dev: 5, ino: 51 },
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// launchd provenance [F2, R1]
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyLaunchdProvenance", () => {
  it("accepts ppid==1 with an exact label match", () => {
    expect(verifyLaunchdProvenance(1, PROD_LABEL, PROD_LABEL)).toBe(true);
  });
  it("accepts ppid==1 with a gui/<uid>/<label> XPC name", () => {
    expect(verifyLaunchdProvenance(1, `gui/501/${PROD_LABEL}`, PROD_LABEL)).toBe(true);
  });
  it("rejects a forged flag from a non-launchd parent (ppid != 1)", () => {
    expect(verifyLaunchdProvenance(4321, PROD_LABEL, PROD_LABEL)).toBe(false);
  });
  it("rejects a mismatched XPC_SERVICE_NAME", () => {
    expect(verifyLaunchdProvenance(1, "dev.remote.app.watchdog", PROD_LABEL)).toBe(false);
  });
  it("rejects a missing XPC_SERVICE_NAME", () => {
    expect(verifyLaunchdProvenance(1, undefined, PROD_LABEL)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delegation decision tables (§3.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("decideStartProd", () => {
  it("provenance + marker (canonical plist) takes the real start path with no legacy warning", () => {
    const d = decideStartProd(
      baseInput({ launchdChildFlag: true, ppid: 1, xpcServiceName: PROD_LABEL }),
    );
    expect(d.action).toBe("real-start-launchd");
    if (d.action === "real-start-launchd") expect(d.legacyPlist).toBe(false);
  });

  it("provenance ALONE (legacy plist, no --launchd-child) takes the real start path", () => {
    // The plist installed before the canonical one has no marker. Requiring it
    // would send a launchd-started wrapper down `delegate-kickstart`, which
    // kickstarts its own job and loops forever with prod never coming up.
    const d = decideStartProd(
      baseInput({ launchdChildFlag: false, ppid: 1, xpcServiceName: PROD_LABEL, jobLoaded: true }),
    );
    expect(d.action).toBe("real-start-launchd");
    if (d.action === "real-start-launchd") expect(d.legacyPlist).toBe(true);
  });

  it("neither marker nor provenance (a shell invocation) falls through to delegation", () => {
    const d = decideStartProd(
      baseInput({ launchdChildFlag: false, ppid: 4321, xpcServiceName: undefined, jobLoaded: true }),
    );
    expect(d.action).toBe("delegate-kickstart");
  });
  it("the marker WITHOUT provenance (wrong ppid) is never a real start [R1]", () => {
    const d = decideStartProd(
      baseInput({ launchdChildFlag: true, ppid: 999, xpcServiceName: PROD_LABEL, jobLoaded: true }),
    );
    expect(d.action).not.toBe("real-start-launchd");
    expect(d.action).toBe("delegate-kickstart");
  });
  it("a FORGED --launchd-child (wrong XPC name) falls through to delegation [R1]", () => {
    const d = decideStartProd(
      baseInput({ launchdChildFlag: true, ppid: 1, xpcServiceName: "com.evil.forge", jobLoaded: true }),
    );
    expect(d.action).toBe("delegate-kickstart");
  });
  it("job loaded ⇒ delegate (probe/kickstart)", () => {
    expect(decideStartProd(baseInput({ jobLoaded: true })).action).toBe("delegate-kickstart");
  });
  it("plist installed, job not loaded ⇒ bootstrap", () => {
    expect(decideStartProd(baseInput({ jobLoaded: false, plistInstalled: true })).action).toBe(
      "delegate-bootstrap",
    );
  });
  it("no plist ⇒ foreground start (never while a plist is installed)", () => {
    expect(decideStartProd(baseInput({ jobLoaded: false, plistInstalled: false })).action).toBe(
      "foreground-start",
    );
  });
  it("unknown launchctl state fails CLOSED [F9]", () => {
    const d = decideStartProd(baseInput({ jobLoaded: "unknown" }));
    expect(d.action).toBe("fail-closed");
    if (d.action === "fail-closed") expect(d.reason).toContain("Remediation");
  });
});

describe("decideRestartProd", () => {
  it("job loaded ⇒ kickstart", () => {
    expect(decideRestartProd(baseInput({ jobLoaded: true })).action).toBe("delegate-kickstart");
  });
  it("live deploy lock refuses the restart (no forgeable bypass) [R8]", () => {
    expect(decideRestartProd(baseInput({ deployLockLive: true })).action).toBe(
      "refuse-deploy-in-progress",
    );
  });
  it("plist installed + intentionally unloaded (desired=stopped) refuses [R15]", () => {
    expect(
      decideRestartProd(baseInput({ jobLoaded: false, plistInstalled: true, desiredState: "stopped" }))
        .action,
    ).toBe("refuse-desired-stopped");
  });
  it("plist installed + unloaded WITHOUT an intentional stop fails closed", () => {
    const d = decideRestartProd(
      baseInput({ jobLoaded: false, plistInstalled: true, desiredState: "running" }),
    );
    expect(d.action).toBe("fail-closed");
  });
  it("job absent (no plist) ⇒ foreground restart [R15]", () => {
    expect(
      decideRestartProd(baseInput({ jobLoaded: false, plistInstalled: false })).action,
    ).toBe("foreground-restart");
  });
  it("unknown launchctl state fails CLOSED [F9]", () => {
    expect(decideRestartProd(baseInput({ jobLoaded: "unknown" })).action).toBe("fail-closed");
  });
});

describe("decideStopProd", () => {
  it("job loaded ⇒ bootout", () => {
    expect(decideStopProd(baseInput({ jobLoaded: true })).action).toBe("bootout");
  });
  it("job absent ⇒ manifest-based foreground stop", () => {
    expect(decideStopProd(baseInput({ jobLoaded: false })).action).toBe("foreground-stop");
  });
  it("unknown launchctl state fails CLOSED [F9]", () => {
    expect(decideStopProd(baseInput({ jobLoaded: "unknown" })).action).toBe("fail-closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manifest lifecycle [R3]
// ─────────────────────────────────────────────────────────────────────────────

describe("generation manifests", () => {
  it("writes atomically: temp file + rename, never a partial final file", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest());
    const finalPath = join(w.paths.generationsDir, "1.json");
    expect(w.fs.files.has(finalPath)).toBe(true);
    // The write landed on a temp path and was renamed into place.
    const rename = w.fs.renames.find(([, to]) => to === finalPath);
    expect(rename).toBeDefined();
    expect(rename![0]).not.toBe(finalPath);
    // No temp leftovers.
    expect([...w.fs.files.keys()].filter((k) => k.includes(".tmp."))).toEqual([]);
  });

  it("flips the current-generation pointer atomically and reads it back", () => {
    const w = makeWorld();
    expect(readCurrentGen(w.deps, w.paths)).toBeNull();
    flipCurrentGen(w.deps, w.paths, 7);
    expect(readCurrentGen(w.deps, w.paths)).toBe(7);
    const rename = w.fs.renames.find(([, to]) => to === w.paths.currentGenerationFile);
    expect(rename).toBeDefined();
  });

  it("phase transitions rewrite the manifest without losing fields", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ phase: "starting" }));
    updateManifestPhase(w.deps, w.paths, 1, "running");
    const m = readManifest(w.deps, w.paths, 1);
    expect(m).not.toBe("corrupt");
    if (m && m !== "corrupt") {
      expect(m.phase).toBe("running");
      expect(m.next?.pid).toBe(200);
      expect(m.sockets.next?.ino).toBe(50);
    }
  });

  it("a corrupt manifest reads as 'corrupt' and reclaim fails CLOSED", async () => {
    const w = makeWorld();
    w.fs.files.set(join(w.paths.generationsDir, "3.json"), "{ not json !!");
    expect(readManifest(w.deps, w.paths, 3)).toBe("corrupt");
    await expect(
      reclaimPriorGenerations(w.deps, w.paths, { currentGen: null }),
    ).rejects.toBeInstanceOf(CorruptManifestError);
  });

  it("force-reclaim tolerates corrupt manifests (operator consent)", async () => {
    const w = makeWorld();
    w.fs.files.set(join(w.paths.generationsDir, "3.json"), "{ not json !!");
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null, force: true });
    expect(res.corruptGens).toEqual([3]);
  });

  it("nextGenNumber is monotonic over pointer + live + archived manifests", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 2 }));
    flipCurrentGen(w.deps, w.paths, 2);
    w.fs.files.set(join(w.paths.generationsArchiveDir, "5.json"), "{}");
    expect(nextGenNumber(w.deps, w.paths)).toBe(6);
    expect(listGenerations(w.deps, w.paths)).toEqual([2]);
  });

  it("archiveManifest moves the file out of the live generations dir", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest());
    archiveManifest(w.deps, w.paths, 1);
    expect(listGenerations(w.deps, w.paths)).toEqual([]);
    expect(w.fs.files.has(join(w.paths.generationsArchiveDir, "1.json"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Process identity [R13]
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyProcIdentity", () => {
  const id: ProcId = { pid: 200, pgid: 200, startTimeNs: "222" };
  it("matches when the live start time equals the recorded one", () => {
    const w = makeWorld();
    w.procs.set(200, "222");
    expect(verifyProcIdentity(w.deps, id)).toBe(true);
  });
  it("REFUSES a recycled pid (startTimeNs mismatch)", () => {
    const w = makeWorld();
    w.procs.set(200, "999999"); // same pid, different process
    expect(verifyProcIdentity(w.deps, id)).toBe(false);
  });
  it("refuses when the process is gone", () => {
    const w = makeWorld();
    expect(verifyProcIdentity(w.deps, id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket dev/ino unlink rule [R2]
// ─────────────────────────────────────────────────────────────────────────────

describe("unlinkOwnedSocket", () => {
  const sock = { path: "/data/run/nextjs.sock", dev: 5, ino: 50 };
  it("unlinks when dev/ino matches the manifest record", () => {
    const w = makeWorld();
    w.fs.stats.set(sock.path, { dev: 5, ino: 50, isSocket: true });
    expect(unlinkOwnedSocket(w.deps, sock.path, sock)).toBe(true);
    expect(w.fs.unlinked).toContain(sock.path);
  });
  it("NEVER unlinks on dev/ino mismatch (someone else's socket)", () => {
    const w = makeWorld();
    w.fs.stats.set(sock.path, { dev: 5, ino: 9999, isSocket: true });
    expect(unlinkOwnedSocket(w.deps, sock.path, sock)).toBe(false);
    expect(w.fs.unlinked).not.toContain(sock.path);
  });
  it("NEVER unlinks with no manifest record (unknown ownership)", () => {
    const w = makeWorld();
    w.fs.stats.set(sock.path, { dev: 5, ino: 50, isSocket: true });
    expect(unlinkOwnedSocket(w.deps, sock.path, undefined)).toBe(false);
    expect(w.fs.unlinked).not.toContain(sock.path);
  });
  it("no-ops when the path is already gone", () => {
    const w = makeWorld();
    expect(unlinkOwnedSocket(w.deps, sock.path, sock)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reclaim (§3.3)
// ─────────────────────────────────────────────────────────────────────────────

describe("reclaimPriorGenerations", () => {
  it("kills identity-verified prior-generation PGIDs and unlinks their sockets", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    // The prior gen's next server is verified alive; its socket is on disk.
    w.procs.set(200, "222");
    w.pgids.set(200, 200);
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    expect(res.killedPgids).toContain(200);
    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig === "SIGTERM")).toBe(true);
    expect(res.unlinkedSockets).toContain("/data/run/nextjs.sock");
    expect(res.archivedGens).toContain(1);
  });

  it("does NOT signal a recycled pid (identity mismatch)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    w.procs.set(200, "totally-different-start"); // recycled pid
    await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    // Occupancy PROBES (signal 0) are fine; no real SIGNAL may be sent.
    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
  });

  it("leaves the CURRENT generation and its socket alone", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 4 }));
    flipCurrentGen(w.deps, w.paths, 4);
    w.procs.set(200, "222");
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: 4 });
    expect(res.killedPgids).toEqual([]);
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
  });

  it("reclaims an ORPHAN socket that no manifest claims (no verifiable holder)", async () => {
    const w = makeWorld();
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 9, ino: 999, isSocket: true });
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    expect(res.unlinkedSockets).toContain("/data/run/nextjs.sock");
    // lsof diagnostics were captured (informational only [F6]).
    expect(w.execCalls.some((c) => c[0] === "lsof")).toBe(true);
  });

  // ── Wrapper pgroup safety ──────────────────────────────────────────────────

  it("signals a live wrapper by LEADER PID and never its (shell-shared) pgroup", async () => {
    const w = makeWorld();
    // A foreground wrapper started from an interactive shell: pid 100 lives in
    // the SHELL's process group (pgid 50), together with the shell itself and
    // an unrelated job. Group-signalling it would kill all three.
    writeManifest(
      w.deps,
      w.paths,
      makeManifest({ gen: 1, wrapper: { pid: 100, pgid: 50, startTimeNs: "111" }, next: undefined, terminal: undefined }),
    );
    w.procs.set(100, "111");
    w.pgids.set(100, 50);
    w.procs.set(50, "shell-start"); // the operator's shell (group leader)
    w.pgids.set(50, 50);
    w.procs.set(51, "unrelated-job-start");
    w.pgids.set(51, 50);

    await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === 100 && sig === "SIGTERM")).toBe(true);
    // No real signal to the shared group, ever (occupancy probes are fine).
    expect(w.killCalls.some(([pid, sig]) => pid === -50 && sig !== 0)).toBe(false);
    expect(w.procs.has(50)).toBe(true); // the shell survived
    expect(w.procs.has(51)).toBe(true); // so did the unrelated job
  });

  // ── Dead leader, live group [F4] ───────────────────────────────────────────

  it("kills a surviving descendant group only when every member is POSITIVELY identified", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 60_000;
    writeManifest(
      w.deps,
      w.paths,
      makeManifest({
        gen: 1,
        startedAt,
        stoppingAt: startedAt + 30_000,
        terminal: undefined,
        commands: { next: ["node", "scripts/standalone-server.js"] },
      }),
    );
    // `bun run tsx` (pid 200) is gone; the real server (pid 201) survives in
    // its group, started inside the generation's lifetime, and carries our
    // recorded script path.
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node /Users/x/app/scripts/standalone-server.js");
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig === "SIGTERM")).toBe(true);
    expect(res.killedPgids).toContain(200);
    expect(res.unresolvedGens).toEqual([]);
    expect(res.archivedGens).toContain(1);
  });

  it("refuses to signal a RECYCLED pgid (a member predates the generation) and fails closed", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 60_000;
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1, startedAt, terminal: undefined }));
    // pgid 200 now belongs to an unrelated process that started BEFORE this
    // generation — it cannot be our descendant.
    w.procs.set(205, String((startedAt - 500_000) * 1_000_000));
    w.pgids.set(205, 200);

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(w.procs.has(205)).toBe(true);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(res.archivedGens).not.toContain(1);
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
  });

  it("refuses to signal a group whose members' start times cannot be read", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 60_000;
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1, startedAt, terminal: undefined }));
    w.identityUnavailablePids.add(201); // alive, start time unreadable
    w.pgids.set(201, 200);

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
  });

  it("reports a generation that survives SIGKILL as UNRESOLVED (never archived)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1, terminal: undefined }));
    w.procs.set(200, "222");
    w.pgids.set(200, 200);
    w.unkillablePgids.add(200);
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(res.archivedGens).not.toContain(1);
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
  });

  // ── SIGKILL between spawn and manifest persistence [F4] ────────────────────

  it("never orphan-unlinks a socket claimed by an in-flight spawn (placeholder)", async () => {
    const w = makeWorld();
    // The wrapper was SIGKILLed between beginChildSpawn() and the pid record:
    // the manifest carries a placeholder with NO pid, and the child it spawned
    // (invisible to us) has already bound the socket.
    const m = makeManifest({ gen: 1, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });
    // The invisible child DID bind: a live process holds the socket.
    w.socketHolders.set(w.paths.nextSocket, [4242]);

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    // The live child's socket survives — unlinking it is the outage class.
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
    expect(res.unlinkedSockets).not.toContain(w.paths.nextSocket);
    // …and the generation is unresolved, so the next start refuses.
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(res.archivedGens).not.toContain(1);
  });

  it("kills an in-flight spawn recorded at spawn time (pid known, identity never captured)", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 60_000;
    const m = makeManifest({
      gen: 1,
      phase: "starting",
      startedAt,
      stoppingAt: startedAt + 10_000,
      next: undefined,
      terminal: undefined,
      sockets: {},
      commands: { next: ["node", "scripts/standalone-server.js"] },
    });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket, pid: 400, pgid: 400 }];
    writeManifest(w.deps, w.paths, m);
    w.procs.set(400, String((startedAt + 500) * 1_000_000));
    w.pgids.set(400, 400);
    w.procCommands.set(400, "node scripts/standalone-server.js");

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -400 && sig === "SIGTERM")).toBe(true);
    expect(res.unresolvedGens).toEqual([]);
    expect(res.archivedGens).toContain(1);
  });

  it("a resolved placeholder does not block archiving once the pid is gone", async () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1, next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket, pid: 400, pgid: 400 }];
    writeManifest(w.deps, w.paths, m);
    // pid 400 is not in `procs` ⇒ dead, and its group is empty.
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    expect(res.unresolvedGens).toEqual([]);
    expect(res.archivedGens).toContain(1);
  });

  it("fails closed when generation evidence cannot be ENUMERATED (not ENOENT)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    w.fs.readdirFailure = Object.assign(new Error("EACCES"), { code: "EACCES" });
    await expect(reclaimPriorGenerations(w.deps, w.paths, { currentGen: null })).rejects.toThrow(
      SupervisionEvidenceError,
    );
    expect(w.fs.unlinked).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spawn placeholders — the manifest never loses a spawned pid [F4]
// ─────────────────────────────────────────────────────────────────────────────

describe("child spawn bookkeeping", () => {
  it("persists the socket claim BEFORE the process can exist, then the pid, then the identity", () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 3, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    writeManifest(w.deps, w.paths, m);

    beginChildSpawn(w.deps, w.paths, m, "next", w.paths.nextSocket, ["node", "scripts/standalone-server.js"]);
    let onDisk = readManifest(w.deps, w.paths, 3) as GenerationManifest;
    expect(onDisk.spawning).toEqual([{ child: "next", socketPath: w.paths.nextSocket }]);
    expect(claimedSocketPaths(onDisk)).toContain(w.paths.nextSocket);
    expect(unresolvedPlaceholders(onDisk)).toHaveLength(1);

    recordChildSpawnPid(w.deps, w.paths, m, "next", 400);
    onDisk = readManifest(w.deps, w.paths, 3) as GenerationManifest;
    expect(onDisk.spawning?.[0]).toMatchObject({ pid: 400, pgid: 400 });
    expect(unresolvedPlaceholders(onDisk)).toHaveLength(0);

    completeChildSpawn(w.deps, w.paths, m, "next", { pid: 400, pgid: 400, startTimeNs: "444" });
    onDisk = readManifest(w.deps, w.paths, 3) as GenerationManifest;
    expect(onDisk.next).toEqual({ pid: 400, pgid: 400, startTimeNs: "444" });
    expect(onDisk.spawning).toEqual([]);
  });

  it("a manifest with an unresolved placeholder is NEVER fully dead", () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1, next: undefined, terminal: undefined });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    expect(manifestFullyDead(w.deps, m)).toBe(false);
  });

  it("rejects a structurally invalid placeholder as a CORRUPT manifest", () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1 });
    writeManifest(w.deps, w.paths, m);
    const raw = JSON.parse(w.fs.files.get(`/data/server/generations/1.json`) as string);
    raw.spawning = [{ child: "bogus", socketPath: "/x" }];
    w.fs.files.set(`/data/server/generations/1.json`, JSON.stringify(raw));
    expect(readManifest(w.deps, w.paths, 1)).toBe("corrupt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deploy restart token — single-use foreground authorization [F11]
// ─────────────────────────────────────────────────────────────────────────────

describe("deploy restart token", () => {
  it("authorizes exactly once and then invalidates itself", () => {
    const w = makeWorld();
    const token = issueDeployRestartToken(w.deps, w.paths);
    expect(consumeDeployRestartToken(w.deps, w.paths, token)).toBe(true);
    // Single use: a replay of the same token is refused.
    expect(consumeDeployRestartToken(w.deps, w.paths, token)).toBe(false);
  });

  it("refuses (and does NOT consume) a wrong or missing token", () => {
    const w = makeWorld();
    const token = issueDeployRestartToken(w.deps, w.paths);
    expect(consumeDeployRestartToken(w.deps, w.paths, "guessed")).toBe(false);
    expect(consumeDeployRestartToken(w.deps, w.paths, undefined)).toBe(false);
    // The deploy's own authorization survived the stray attempts.
    expect(consumeDeployRestartToken(w.deps, w.paths, token)).toBe(true);
  });

  it("refuses when no token was ever issued", () => {
    const w = makeWorld();
    expect(consumeDeployRestartToken(w.deps, w.paths, "anything")).toBe(false);
  });

  it("writes the token file 0600", () => {
    const w = makeWorld();
    issueDeployRestartToken(w.deps, w.paths);
    expect(w.fs.modes.get(w.paths.deployRestartToken)).toBe(0o600);
  });

  it("clearDeployRestartToken removes an unconsumed token", () => {
    const w = makeWorld();
    const token = issueDeployRestartToken(w.deps, w.paths);
    clearDeployRestartToken(w.deps, w.paths);
    expect(consumeDeployRestartToken(w.deps, w.paths, token)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custody journal [R4, R5]
// ─────────────────────────────────────────────────────────────────────────────

describe("custody journal", () => {
  const journal: CustodyJournal = {
    ownerPid: 777,
    ownerStartTimeNs: "777000",
    priorLoaded: true,
    plistPath: "/home/u/Library/LaunchAgents/dev.remote.app.prod.plist",
    slot: "blue",
    phase: "pre-migration",
    ts: 1_700_000_000_000,
  };

  it("round-trips through the fs", () => {
    const w = makeWorld();
    writeCustodyJournal(w.deps, w.paths, journal);
    expect(readCustodyJournal(w.deps, w.paths)).toEqual(journal);
  });

  it("classifies: no journal ⇒ none", () => {
    expect(
      classifyCustody({ journal: null, desiredState: "maintenance", ownerAlive: false, deployLockLive: false }),
    ).toBe("none");
  });
  it("classifies: live owner ⇒ active", () => {
    expect(
      classifyCustody({ journal, desiredState: "maintenance", ownerAlive: true, deployLockLive: false }),
    ).toBe("active");
  });
  it("classifies: live deploy lock ⇒ active even with a dead owner", () => {
    expect(
      classifyCustody({ journal, desiredState: "maintenance", ownerAlive: false, deployLockLive: true }),
    ).toBe("active");
  });
  it("classifies: dead owner + desired=stopped ⇒ intentional stop (never undone) [R5]", () => {
    expect(
      classifyCustody({ journal, desiredState: "stopped", ownerAlive: false, deployLockLive: false }),
    ).toBe("intentional-stop");
  });
  it("classifies: dead owner + free lock + maintenance ⇒ abandoned [R4]", () => {
    expect(
      classifyCustody({ journal, desiredState: "maintenance", ownerAlive: false, deployLockLive: false }),
    ).toBe("abandoned");
  });

  it("custodyOwnerAlive refuses a recycled owner pid (identity mismatch)", () => {
    const w = makeWorld();
    w.procs.set(777, "some-other-start-time");
    expect(custodyOwnerAlive(w.deps, journal)).toBe(false);
    w.procs.set(777, "777000");
    expect(custodyOwnerAlive(w.deps, journal)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deploy-lock liveness parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("deployLockLive", () => {
  it("bare live PID ⇒ live", () => {
    const w = makeWorld();
    w.procs.set(4242, "x");
    w.fs.files.set(w.paths.deployLock, "4242\n");
    expect(deployLockLive(w.deps, w.paths)).toBe(true);
  });
  it("bare dead PID ⇒ not live", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployLock, "4242\n");
    expect(deployLockLive(w.deps, w.paths)).toBe(false);
  });
  it("legacy JSON {pid,token} form is parsed too", () => {
    const w = makeWorld();
    w.procs.set(555, "x");
    w.fs.files.set(w.paths.deployLock, JSON.stringify({ pid: 555, token: "t" }));
    expect(deployLockLive(w.deps, w.paths)).toBe(true);
  });
  it("EPERM on kill(pid, 0) counts as ALIVE", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployLock, "888\n");
    const origKill = w.deps.kill;
    w.deps.kill = (pid, sig) => {
      if (pid === 888 && sig === 0) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      origKill(pid, sig);
    };
    expect(deployLockLive(w.deps, w.paths)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grace counting math [F7, F12, R10]
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateGraceTick", () => {
  it("counts failures during grace but defers action", () => {
    const r = evaluateGraceTick({
      nowSec: 1000 + 60,
      lastRestartSec: 1000,
      graceSec: GRACE_SECONDS,
      priorFailures: 0,
      maxFailures: DEFAULT_MAX_FAILURES,
    });
    expect(r.failures).toBe(1);
    expect(r.inGrace).toBe(true);
    expect(r.shouldAct).toBe(false);
  });

  it("acts on the first post-grace tick when the accumulated count meets the threshold", () => {
    // Failures counted at +60 (grace) then evaluated at +120 (grace expired).
    const r = evaluateGraceTick({
      nowSec: 1000 + GRACE_SECONDS,
      lastRestartSec: 1000,
      graceSec: GRACE_SECONDS,
      priorFailures: 1,
      maxFailures: DEFAULT_MAX_FAILURES,
    });
    expect(r.inGrace).toBe(false);
    expect(r.shouldAct).toBe(true);
  });

  it("worst-case detection is grace + 1 tick: restart at T, fail at T+60 and T+120 ⇒ act [R10]", () => {
    const T = 5000;
    const tick1 = evaluateGraceTick({
      nowSec: T + 60,
      lastRestartSec: T,
      graceSec: GRACE_SECONDS,
      priorFailures: 0,
      maxFailures: DEFAULT_MAX_FAILURES,
    });
    expect(tick1.inGrace).toBe(true);
    expect(tick1.shouldAct).toBe(false);
    const tick2 = evaluateGraceTick({
      nowSec: T + 120,
      lastRestartSec: T,
      graceSec: GRACE_SECONDS,
      priorFailures: tick1.failures,
      maxFailures: DEFAULT_MAX_FAILURES,
    });
    expect(tick2.inGrace).toBe(false);
    expect(tick2.shouldAct).toBe(true); // detection ≈ grace + 1 tick ≤ 4 min worst alignment
  });

  it("below-threshold failures outside grace do not act", () => {
    const r = evaluateGraceTick({
      nowSec: 9999,
      lastRestartSec: null,
      graceSec: GRACE_SECONDS,
      priorFailures: 0,
      maxFailures: DEFAULT_MAX_FAILURES,
    });
    expect(r.shouldAct).toBe(false);
    expect(r.failures).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ledgers + escalation [F17, R12]
// ─────────────────────────────────────────────────────────────────────────────

describe("ledgers and escalation", () => {
  it("appendLedger writes `<epoch> <actor> <reason>` lines", () => {
    const w = makeWorld();
    w.setNow(1_700_000_123_000);
    appendLedger(w.deps, w.paths.restartLedger, "watchdog", "unhealthy");
    expect(w.fs.files.get(w.paths.restartLedger)).toBe("1700000123 watchdog unhealthy\n");
  });

  it("countLedgerSince honors the window", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.restartLedger, "100 a x\n200 b y\n300 c z\n");
    expect(countLedgerSince(w.deps, w.paths.restartLedger, 200)).toBe(2);
  });

  it("escalates at >= 3 combined entries in the window, mixing BOTH ledgers [R12]", () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    w.fs.files.set(w.paths.restartLedger, `${nowSec - 10} watchdog a\n${nowSec - 3700} watchdog old\n`);
    // Both generation entries are far from the restart, so neither is that
    // restart's own wrapper start — they are unrequested KeepAlive respawns
    // and count in full.
    w.fs.files.set(
      w.paths.generationLedger,
      `${nowSec - 900} generation-start 4\n${nowSec - 1800} generation-start 5\n`,
    );
    const res = evaluateEscalation(w.deps, w.paths);
    expect(res.total).toBe(ESCALATION_THRESHOLD); // the hour-old entry is excluded
    expect(res.escalate).toBe(true);
  });

  it("an actuation and the wrapper generation it produces count as ONE event [R12]", () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    w.fs.files.set(w.paths.restartLedger, `${nowSec - 30} rdv restart-kickstart\n`);
    w.fs.files.set(w.paths.generationLedger, `${nowSec - 28} generation-start 7\n`);
    expect(evaluateEscalation(w.deps, w.paths).total).toBe(1);
  });

  it("absorbs a generation entry that PRECEDES its actuation (foreground start order)", () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    // A foreground start appends its generation entry at wrapper entry and
    // records the actuation only once the generation publishes.
    w.fs.files.set(w.paths.generationLedger, `${nowSec - 40} generation-start 7\n`);
    w.fs.files.set(w.paths.restartLedger, `${nowSec - 20} rdv foreground-start\n`);
    expect(evaluateEscalation(w.deps, w.paths).total).toBe(1);
  });

  it("TWO ordinary restarts do not trip the >= 3 threshold [R12]", () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    w.fs.files.set(
      w.paths.restartLedger,
      `${nowSec - 600} rdv restart-kickstart\n${nowSec - 30} rdv restart-kickstart\n`,
    );
    w.fs.files.set(
      w.paths.generationLedger,
      `${nowSec - 598} generation-start 7\n${nowSec - 28} generation-start 8\n`,
    );
    const res = evaluateEscalation(w.deps, w.paths);
    expect(res.total).toBe(2);
    expect(res.escalate).toBe(false);
  });

  it("each restart absorbs at most ONE generation entry (crash loop still escalates)", () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    w.fs.files.set(w.paths.restartLedger, `${nowSec - 50} rdv restart-kickstart\n`);
    // One of these is the restart's own wrapper; the other two are the crash
    // loop that followed.
    w.fs.files.set(
      w.paths.generationLedger,
      `${nowSec - 48} generation-start 7\n${nowSec - 40} generation-start 8\n${nowSec - 35} generation-start 9\n`,
    );
    const res = evaluateEscalation(w.deps, w.paths);
    expect(res.total).toBe(3);
    expect(res.escalate).toBe(true);
  });

  it("generation starts go to the GENERATION ledger only and never stamp last-restart", () => {
    const w = makeWorld();
    appendGenerationStart(w.deps, w.paths, 9);
    expect(w.fs.files.get(w.paths.generationLedger)).toContain("generation-start 9");
    expect(w.fs.files.has(w.paths.restartLedger)).toBe(false);
    // No perpetual grace renewal: the stamp file must not exist.
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(false);
  });

  it("a generation-start crash loop fires the escalation side effects [R12]", () => {
    const w = makeWorld();
    appendGenerationStart(w.deps, w.paths, 1);
    appendGenerationStart(w.deps, w.paths, 2);
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(false);
    appendGenerationStart(w.deps, w.paths, 3); // third within the hour ⇒ escalate
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// watchdog-act (§3.6)
// ─────────────────────────────────────────────────────────────────────────────

describe("watchdogAct", () => {
  it("a live deploy suppresses action AND resets the counter [F12]", async () => {
    const w = makeWorld();
    w.procs.set(4242, "x");
    w.fs.files.set(w.paths.deployLock, "4242\n");
    writeWatchdogState(w.deps, w.paths, { gen: null, failures: 5, flapTicks: 1, updatedAt: 0 });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(0);
    expect(w.fs.files.has(w.paths.watchdogStateFile)).toBe(false);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
  });

  it("desired=stopped gates the watchdog entirely [R5]", async () => {
    const w = makeWorld();
    writeDesiredState(w.deps, w.paths, "stopped");
    writeWatchdogState(w.deps, w.paths, { gen: null, failures: 5, flapTicks: 0, updatedAt: 0 });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(0);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
  });

  it("within grace: counts the failure, defers action", async () => {
    const w = makeWorld();
    const nowSec = Math.floor(w.now() / 1000);
    w.fs.files.set(w.paths.lastRestartStamp, `${nowSec - 30}\n`);
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(0);
    expect(readWatchdogState(w.deps, w.paths).failures).toBe(1);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
  });

  it("kickstarts after MAX_FAILURES consecutive failures, ledgers + stamps + resets", async () => {
    const w = makeWorld();
    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0); // failure 1/2
    expect(w.execCalls.some((c) => c[1] === "kickstart")).toBe(false);
    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0); // failure 2/2 ⇒ act
    expect(
      w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart" && c[3]?.includes(PROD_LABEL)),
    ).toBe(true);
    expect(w.fs.files.get(w.paths.restartLedger)).toContain("watchdog probe-failed");
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(true);
    expect(w.fs.files.has(w.paths.watchdogStateFile)).toBe(false); // reset post-actuation
  });

  it("flap fast-path: socket absent + verified-alive next + old gen, 2 persisted ticks ⇒ reclaim + kickstart", async () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 6, startedAt: w.now() - 600_000 }); // gen age 10 min
    writeManifest(w.deps, w.paths, m);
    flipCurrentGen(w.deps, w.paths, 6);
    w.procs.set(200, "222"); // next verified alive
    // nextjs.sock absent (no stats entry) — the flap signature.

    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0); // flap tick 1
    expect(readWatchdogState(w.deps, w.paths)).toMatchObject({ gen: 6, flapTicks: 1 });
    expect(w.execCalls.some((c) => c[1] === "kickstart")).toBe(false);

    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0); // flap tick 2 ⇒ act
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(true);
    expect(w.fs.files.get(w.paths.restartLedger)).toContain("watchdog flap");
    expect(readWatchdogState(w.deps, w.paths).flapTicks).toBe(0); // reset post-actuation
  });

  it(`flap ticks are keyed by generation (gen change resets, needs ${FLAP_TICKS_REQUIRED} again)`, async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 6, startedAt: w.now() - 600_000 }));
    flipCurrentGen(w.deps, w.paths, 6);
    w.procs.set(200, "222");
    await watchdogAct(w.deps, w.paths, "probe-failed"); // gen 6, tick 1

    // A new generation appears (same flap signature, different gen).
    writeManifest(w.deps, w.paths, makeManifest({ gen: 7, startedAt: w.now() - 600_000 }));
    flipCurrentGen(w.deps, w.paths, 7);
    await watchdogAct(w.deps, w.paths, "probe-failed"); // gen 7 ⇒ tick count restarts at 1
    expect(readWatchdogState(w.deps, w.paths)).toMatchObject({ gen: 7, flapTicks: 1 });
    expect(w.execCalls.some((c) => c[1] === "kickstart")).toBe(false);
  });

  it("abandoned deploy custody (maintenance) is restored per journal [R4]", async () => {
    const w = makeWorld();
    w.setJobLoaded(false); // the deploy died AFTER bootout — job unloaded
    writeDesiredState(w.deps, w.paths, "maintenance");
    writeCustodyJournal(w.deps, w.paths, {
      ownerPid: 777, // dead (not in w.procs)
      ownerStartTimeNs: "777000",
      priorLoaded: true,
      plistPath: w.paths.prodPlist,
      slot: "blue",
      phase: "pre-migration",
      ts: w.now() - 60_000,
    });
    const restored: string[] = [];
    const code = await watchdogAct(w.deps, w.paths, "probe-failed", {
      restoreSlot: (slot) => {
        restored.push(slot);
        return true;
      },
    });
    expect(code).toBe(0);
    expect(restored).toEqual(["blue"]);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap")).toBe(true);
    expect(desiredOf(w)).toBe("running");
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
    expect(w.fs.files.get(w.paths.restartLedger)).toContain("custody-recovery");
  });

  it("custody recovery with a FAILING bootstrap keeps the journal + maintenance and exits non-zero", async () => {
    const w = makeWorld();
    w.setJobLoaded(false);
    w.setBootstrapFails(true);
    writeDesiredState(w.deps, w.paths, "maintenance");
    writeCustodyJournal(w.deps, w.paths, {
      ownerPid: 777,
      ownerStartTimeNs: "777000",
      priorLoaded: true,
      plistPath: w.paths.prodPlist,
      slot: "blue",
      phase: "pre-migration",
      ts: w.now() - 60_000,
    });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed", {
      restoreSlot: () => true,
    });
    expect(code).toBe(1);
    // The crash-recovery evidence survives for the next tick's retry.
    expect(readCustodyJournal(w.deps, w.paths)).not.toBeNull();
    expect(desiredOf(w)).toBe("maintenance");
    // No successful actuation was recorded.
    expect(w.fs.files.get(w.paths.restartLedger) ?? "").not.toContain("custody-recovery");
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(false);
    // The failure escalated.
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
  });

  it("custody recovery with a FAILED slot restore bootstraps prod but keeps the journal (partial, non-zero)", async () => {
    const w = makeWorld();
    w.setJobLoaded(false);
    writeDesiredState(w.deps, w.paths, "maintenance");
    writeCustodyJournal(w.deps, w.paths, {
      ownerPid: 777,
      ownerStartTimeNs: "777000",
      priorLoaded: true,
      plistPath: w.paths.prodPlist,
      slot: "blue",
      phase: "pre-migration",
      ts: w.now() - 60_000,
    });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed", {
      restoreSlot: () => false,
    });
    expect(code).toBe(1);
    // Prod was brought up (bootstrap attempted)...
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap")).toBe(true);
    // ...but the journal + maintenance persist so the restore is retried.
    expect(readCustodyJournal(w.deps, w.paths)).not.toBeNull();
    expect(desiredOf(w)).toBe("maintenance");
  });

  it("ACTIVE custody (live deploy owner) is left alone", async () => {
    const w = makeWorld();
    writeDesiredState(w.deps, w.paths, "maintenance");
    w.procs.set(777, "777000"); // owner alive with matching identity
    writeCustodyJournal(w.deps, w.paths, {
      ownerPid: 777,
      ownerStartTimeNs: "777000",
      priorLoaded: true,
      plistPath: w.paths.prodPlist,
      slot: "blue",
      phase: "pre-migration",
      ts: w.now(),
    });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(0);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap")).toBe(false);
    expect(readCustodyJournal(w.deps, w.paths)).not.toBeNull();
    expect(desiredOf(w)).toBe("maintenance");
  });

  it("control-lock contention aborts without ANY action [R8]", async () => {
    const w = makeWorld();
    w.deps.tryFlock = async () => null; // always held
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(1);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
  });

  it("a CORRUPT desired-state file fails CLOSED (no kickstart, escalation, non-zero) [R5]", async () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.desiredStateFile, "{ this is not json");
    writeWatchdogState(w.deps, w.paths, { gen: null, failures: 5, flapTicks: 0, updatedAt: 0 });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(1);
    // The intentionally-stopped-job hazard: NEVER kickstart on a guess.
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
  });

  it("a FAILED kickstart is not recorded as a restart: no grace stamp, counters preserved, non-zero", async () => {
    const w = makeWorld();
    w.setKickstartFails(true);
    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0); // failure 1/2
    const code = await watchdogAct(w.deps, w.paths, "probe-failed"); // threshold ⇒ actuate ⇒ FAILS
    expect(code).toBe(1);
    // No ledger entry, no grace stamp — the next tick retries immediately.
    expect(w.fs.files.has(w.paths.restartLedger)).toBe(false);
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(false);
    expect(readWatchdogState(w.deps, w.paths).failures).toBe(2);
    // Escalated the actuation failure.
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
    // With kickstart working again, the very next tick actuates successfully.
    w.setKickstartFails(false);
    expect(await watchdogAct(w.deps, w.paths, "probe-failed")).toBe(0);
    expect(w.fs.files.get(w.paths.restartLedger)).toContain("watchdog probe-failed");
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation exit verification [R3]
// ─────────────────────────────────────────────────────────────────────────────

describe("currentGenerationState / waitForGenerationExit", () => {
  it("no pointer at all ⇒ no-evidence (legacy/fresh host proceeds)", async () => {
    const w = makeWorld();
    expect(currentGenerationState(w.deps, w.paths).state).toBe("no-evidence");
    expect(await waitForGenerationExit(w.deps, w.paths, 1000)).toBe("no-evidence");
  });

  it("pointer to a cleanly ARCHIVED generation ⇒ no-evidence", async () => {
    const w = makeWorld();
    flipCurrentGen(w.deps, w.paths, 3);
    w.fs.files.set(join(w.paths.generationsArchiveDir, "3.json"), "{}");
    expect(currentGenerationState(w.deps, w.paths).state).toBe("no-evidence");
  });

  it("pointer to a CORRUPT manifest ⇒ unverifiable (fail closed)", async () => {
    const w = makeWorld();
    flipCurrentGen(w.deps, w.paths, 3);
    w.fs.files.set(join(w.paths.generationsDir, "3.json"), "{ nope");
    expect(currentGenerationState(w.deps, w.paths).state).toBe("unverifiable");
    expect(await waitForGenerationExit(w.deps, w.paths, 1000)).toBe("unverifiable");
  });

  it("pointer to a MISSING (never archived) manifest ⇒ unverifiable (fail closed)", () => {
    const w = makeWorld();
    flipCurrentGen(w.deps, w.paths, 9);
    expect(currentGenerationState(w.deps, w.paths).state).toBe("unverifiable");
  });

  it("verified-alive processes past the deadline ⇒ timeout (callers must abort)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    flipCurrentGen(w.deps, w.paths, 1);
    w.procs.set(100, "111"); // wrapper stays alive forever
    expect(await waitForGenerationExit(w.deps, w.paths, 500)).toBe("timeout");
  });

  it("processes verified dead ⇒ exited", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    flipCurrentGen(w.deps, w.paths, 1);
    expect(await waitForGenerationExit(w.deps, w.paths, 500)).toBe("exited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reclaim fail-closed hardening [R2, R3]
// ─────────────────────────────────────────────────────────────────────────────

describe("reclaim hardening", () => {
  it("a DANGLING current-generation pointer fails reclaim CLOSED (force overrides)", async () => {
    const w = makeWorld();
    flipCurrentGen(w.deps, w.paths, 12); // no manifest 12.json anywhere
    await expect(
      reclaimPriorGenerations(w.deps, w.paths, { currentGen: null }),
    ).rejects.toBeInstanceOf(CorruptManifestError);
    // Operator consent proceeds.
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null, force: true });
    expect(res.killedPgids).toEqual([]);
  });

  it("an UNKILLABLE prior-generation process keeps its socket AND its manifest (no unlink, no archive)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    w.procs.set(200, "222");
    w.pgids.set(200, 200);
    w.unkillablePgids.add(200); // survives SIGTERM and SIGKILL (EPERM-style)
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    // Kill was ATTEMPTED...
    expect(w.killCalls.some(([pid]) => pid === -200)).toBe(true);
    // ...but the live process keeps its socket (unlinking would recreate the
    // outage class) and its manifest (archiving would hide it).
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
    expect(res.unlinkedSockets).not.toContain("/data/run/nextjs.sock");
    expect(res.archivedGens).not.toContain(1);
    expect(w.fs.files.has(join(w.paths.generationsDir, "1.json"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// doctor-supervision refusals [F11, R8]
// ─────────────────────────────────────────────────────────────────────────────

describe("doctorSupervision --force-reclaim", () => {
  it("refuses while a live deploy holds deploy.lock", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    w.procs.set(200, "222");
    w.procs.set(4242, "x");
    w.fs.files.set(w.paths.deployLock, "4242\n");
    const code = await doctorSupervision(w.deps, w.paths, { forceReclaim: true });
    expect(code).toBe(1);
    // Nothing was signalled or unlinked.
    expect(w.killCalls.filter(([pid]) => pid < 0)).toEqual([]);
    expect(w.fs.unlinked).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2 hardening: quad-state identity + pgroup emptiness [R13]
// ─────────────────────────────────────────────────────────────────────────────

describe("procIdentityState (quad-state)", () => {
  const id: ProcId = { pid: 200, pgid: 200, startTimeNs: "222" };
  it("dead: pid gone entirely", () => {
    const w = makeWorld();
    expect(procIdentityState(w.deps, id)).toBe("dead");
  });
  it("alive-same-identity: live with the recorded start time", () => {
    const w = makeWorld();
    w.procs.set(200, "222");
    expect(procIdentityState(w.deps, id)).toBe("alive-same-identity");
  });
  it("alive-different-identity: live but recycled", () => {
    const w = makeWorld();
    w.procs.set(200, "999");
    expect(procIdentityState(w.deps, id)).toBe("alive-different-identity");
  });
  it("identity-unavailable: pid alive but sysctl cannot read it — NEVER 'dead'", () => {
    const w = makeWorld();
    w.identityUnavailablePids.add(200);
    expect(procIdentityState(w.deps, id)).toBe("identity-unavailable");
  });
});

describe("pgroupOccupied / procEntryFullyDead", () => {
  it("an empty group reads ESRCH ⇒ not occupied", () => {
    const w = makeWorld();
    expect(pgroupOccupied(w.deps, 300)).toBe(false);
  });
  it("a group with a surviving member is occupied", () => {
    const w = makeWorld();
    w.procs.set(301, "x");
    w.pgids.set(301, 300);
    expect(pgroupOccupied(w.deps, 300)).toBe(true);
  });
  it("procEntryFullyDead requires BOTH leader-dead and group-empty", () => {
    const w = makeWorld();
    const id: ProcId = { pid: 200, pgid: 200, startTimeNs: "222" };
    expect(procEntryFullyDead(w.deps, id)).toBe(true); // both gone
    // Leader dead but a GRANDCHILD survives in the group.
    w.procs.set(201, "grandchild");
    w.pgids.set(201, 200);
    expect(procEntryFullyDead(w.deps, id)).toBe(false);
  });
});

describe("reclaim — dead leader with a live grandchild in the pgroup", () => {
  it("keeps the socket AND the manifest when the child's pgroup is still occupied", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    // The `bun run tsx` leader (pid 200) is dead, but a detached grandchild
    // (pid 201) lives on in pgroup 200 and still owns the socket.
    w.procs.set(201, "grandchild-start");
    w.pgids.set(201, 200);
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    // SIGTERM was sent to the group... (leader identity dead ⇒ no signal;
    // group occupancy still blocks cleanup)
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
    expect(res.archivedGens).not.toContain(1);
    expect(w.fs.files.has(join(w.paths.generationsDir, "1.json"))).toBe(true);
  });

  it("identity-unavailable processes block cleanup too (sysctl outage ≠ death)", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    w.identityUnavailablePids.add(200); // alive, identity unreadable
    w.fs.stats.set("/data/run/nextjs.sock", { dev: 5, ino: 50, isSocket: true });
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    expect(w.fs.unlinked).not.toContain("/data/run/nextjs.sock");
    expect(res.archivedGens).not.toContain(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: manifest structural validation [R3] + watchdog corrupt gate
// ─────────────────────────────────────────────────────────────────────────────

describe("readManifest structural validation", () => {
  it("filename ↔ gen disagreement ⇒ corrupt", () => {
    const w = makeWorld();
    w.fs.files.set(join(w.paths.generationsDir, "2.json"), JSON.stringify(makeManifest({ gen: 5 })));
    expect(readManifest(w.deps, w.paths, 2)).toBe("corrupt");
  });
  it("a malformed child identity ⇒ corrupt (never 'dead')", () => {
    const w = makeWorld();
    const bad = makeManifest({ gen: 2 }) as unknown as Record<string, unknown>;
    bad.next = { pid: "not-a-number", pgid: 200, startTimeNs: "222" };
    w.fs.files.set(join(w.paths.generationsDir, "2.json"), JSON.stringify(bad));
    expect(readManifest(w.deps, w.paths, 2)).toBe("corrupt");
  });
  it("an unknown phase ⇒ corrupt", () => {
    const w = makeWorld();
    const bad = { ...makeManifest({ gen: 2 }), phase: "zombie" };
    w.fs.files.set(join(w.paths.generationsDir, "2.json"), JSON.stringify(bad));
    expect(readManifest(w.deps, w.paths, 2)).toBe("corrupt");
  });
  it("a malformed socket record ⇒ corrupt", () => {
    const w = makeWorld();
    const bad = makeManifest({ gen: 2 }) as unknown as { sockets: Record<string, unknown> };
    bad.sockets.next = { path: "/x", dev: "nope", ino: 1 };
    w.fs.files.set(join(w.paths.generationsDir, "2.json"), JSON.stringify(bad));
    expect(readManifest(w.deps, w.paths, 2)).toBe("corrupt");
  });
});

describe("watchdogAct — corrupt-manifest actuation gate", () => {
  it("a corrupt manifest blocks the GENERIC kickstart too (escalate, no stamp, non-zero)", async () => {
    const w = makeWorld();
    w.fs.files.set(join(w.paths.generationsDir, "3.json"), "{ not json");
    // Prime the counter to the actuation threshold.
    writeWatchdogState(w.deps, w.paths, { gen: null, failures: 5, flapTicks: 0, updatedAt: 0 });
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(1);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(false);
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: deploy-lock fail-closed parsing + foreground gate [F11]
// ─────────────────────────────────────────────────────────────────────────────

describe("deployLockLive — unreadable content fails CLOSED", () => {
  it("garbage lock content counts as LIVE", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployLock, "!!!not-a-pid!!!");
    expect(deployLockHolderPid(w.deps, w.paths)).toBe("unreadable");
    expect(deployLockLive(w.deps, w.paths)).toBe(true);
  });
  it("an unreadable lock file counts as LIVE", () => {
    const w = makeWorld();
    w.fs.stats.set(w.paths.deployLock, { dev: 1, ino: 1, isSocket: false }); // exists but not readable
    expect(deployLockLive(w.deps, w.paths)).toBe(true);
  });
});

describe("decideStartProd — job-absent foreground deploy gate [F11]", () => {
  it("refuses a foreground start while a deploy is live (external caller)", () => {
    const d = decideStartProd(
      baseInput({ jobLoaded: false, plistInstalled: false, deployLockLive: true, foregroundDeployAuthorized: false }),
    );
    expect(d.action).toBe("fail-closed");
  });
  it("permits the deploy's OWN restart (authorized channel)", () => {
    const d = decideStartProd(
      baseInput({ jobLoaded: false, plistInstalled: false, deployLockLive: true, foregroundDeployAuthorized: true }),
    );
    expect(d.action).toBe("foreground-start");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: custody journal validation + healthy-tick custody sweep [F6]
// ─────────────────────────────────────────────────────────────────────────────

describe("custody journal structural validation", () => {
  it("a journal missing required fields reads as CORRUPT (not absent)", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.custodyJournal, JSON.stringify({ ownerPid: 5, priorLoaded: true }));
    expect(readCustodyJournal(w.deps, w.paths)).toBe("corrupt");
  });
  it("watchdogAct fails CLOSED on a corrupt journal (escalate, no action)", async () => {
    const w = makeWorld();
    writeDesiredState(w.deps, w.paths, "maintenance");
    w.fs.files.set(w.paths.custodyJournal, "{ nope");
    const code = await watchdogAct(w.deps, w.paths, "probe-failed");
    expect(code).toBe(1);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap")).toBe(false);
    expect(w.execCalls.some((c) => c[0] === "osascript")).toBe(true);
    expect(w.fs.files.has(w.paths.custodyJournal)).toBe(true); // evidence retained
  });
});

describe("watchdogAct custody-check (healthy-tick sweep)", () => {
  const deadOwnerJournal = (w: FakeWorld): void => {
    writeCustodyJournal(w.deps, w.paths, {
      ownerPid: 777, // dead
      ownerStartTimeNs: "777000",
      priorLoaded: true,
      plistPath: w.paths.prodPlist,
      slot: "blue",
      phase: "pre-migration",
      ts: w.now() - 60_000,
    });
  };

  it("clears a leftover journal when prod is loaded + healthy (finalize died late)", async () => {
    const w = makeWorld();
    w.makeHealthy();
    writeDesiredState(w.deps, w.paths, "running");
    deadOwnerJournal(w);
    const code = await watchdogAct(w.deps, w.paths, "custody-check");
    expect(code).toBe(0);
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
    // No actuation happened, so nothing may be recorded as one.
    expect(w.fs.files.has(w.paths.restartLedger)).toBe(false);
    expect(w.fs.files.has(w.paths.lastRestartStamp)).toBe(false);
    expect(w.execCalls.some((c) => c[1] === "kickstart" || c[1] === "bootstrap")).toBe(false);
  });

  it("custody-check on a healthy tick performs NO failure counting", async () => {
    const w = makeWorld();
    w.makeHealthy();
    writeDesiredState(w.deps, w.paths, "running");
    deadOwnerJournal(w);
    await watchdogAct(w.deps, w.paths, "custody-check");
    expect(readWatchdogState(w.deps, w.paths).failures).toBe(0);
  });

  it("maintenance + abandoned custody with a LOADED HEALTHY job finalizes WITHOUT restoring files", async () => {
    const w = makeWorld();
    w.makeHealthy();
    w.setJobLoaded(true); // the deploy died AFTER a successful bootstrap
    writeDesiredState(w.deps, w.paths, "maintenance");
    deadOwnerJournal(w);
    const restored: string[] = [];
    const code = await watchdogAct(w.deps, w.paths, "custody-check", {
      restoreSlot: (slot) => {
        restored.push(slot);
        return true;
      },
    });
    expect(code).toBe(0);
    // The RUNNING stack is the evidence: no restore under a live process, no
    // bootout, no bootstrap — just a verified close-out.
    expect(restored).toEqual([]);
    expect(w.execCalls.some((c) => c[1] === "bootout" || c[1] === "bootstrap")).toBe(false);
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
    expect(desiredOf(w)).toBe("running");
  });

  it("maintenance + abandoned custody with a LOADED UNHEALTHY job takes real custody (bootout → restore → bootstrap)", async () => {
    const w = makeWorld();
    w.setJobLoaded(true);
    w.setCurlCode("000"); // loaded but unhealthy
    writeDesiredState(w.deps, w.paths, "maintenance");
    deadOwnerJournal(w);
    const restored: string[] = [];
    const code = await watchdogAct(w.deps, w.paths, "probe-failed", {
      restoreSlot: (slot) => {
        restored.push(slot);
        return true;
      },
    });
    expect(code).toBe(0);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootout")).toBe(true);
    expect(restored).toEqual(["blue"]);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap")).toBe(true);
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
    expect(desiredOf(w)).toBe("running");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2: unpointed generations are visible evidence [R3]
// ─────────────────────────────────────────────────────────────────────────────

describe("unpointed (starting) generations", () => {
  it("waitForGenerationExit waits on a live UNPOINTED manifest (not no-evidence)", async () => {
    const w = makeWorld();
    // Manifest exists, pointer NEVER flipped (starting window), wrapper live.
    writeManifest(w.deps, w.paths, makeManifest({ gen: 9, phase: "starting" }));
    w.procs.set(100, "111");
    expect(await waitForGenerationExit(w.deps, w.paths, 500)).toBe("timeout");
    // Once the wrapper dies (and groups empty), it exits.
    w.procs.delete(100);
    expect(await waitForGenerationExit(w.deps, w.paths, 500)).toBe("exited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-3 remediation: liveness polarity, evidence availability, custody
// ownership, and durable partial-restore accounting
// ─────────────────────────────────────────────────────────────────────────────

describe("liveness polarity — only ESRCH proves absence", () => {
  const failingKillDeps = (base: SupervisionDeps, code: string): SupervisionDeps => ({
    ...base,
    kill: () => {
      throw Object.assign(new Error(code), { code });
    },
    procStartTimeNs: () => null,
  });

  it("treats an unexpected kill(2) error as ALIVE, never dead", () => {
    const w = makeWorld();
    expect(isPidAliveDeps(failingKillDeps(w.deps, "EIO"), 500)).toBe(true);
    expect(isPidAliveDeps(failingKillDeps(w.deps, "EPERM"), 500)).toBe(true);
    expect(isPidAliveDeps(failingKillDeps(w.deps, "ESRCH"), 500)).toBe(false);
  });

  it("classifies an un-inspectable but signalable pid as identity-unavailable, not dead", () => {
    const w = makeWorld();
    const id: ProcId = { pid: 500, pgid: 500, startTimeNs: "555" };
    expect(procIdentityState(failingKillDeps(w.deps, "EIO"), id)).toBe("identity-unavailable");
    expect(procEntryFullyDead(failingKillDeps(w.deps, "EIO"), id)).toBe(false);
    expect(procIdentityState(failingKillDeps(w.deps, "ESRCH"), id)).toBe("dead");
  });
});

describe("evidence availability — enumeration failures are not 'nothing is running'", () => {
  it("listGenerations throws SupervisionEvidenceError on a non-ENOENT readdir failure", () => {
    const w = makeWorld();
    w.fs.readdirFailure = Object.assign(new Error("EACCES"), { code: "EACCES" });
    expect(() => listGenerations(w.deps, w.paths)).toThrow(SupervisionEvidenceError);
  });

  it("an ENOENT-style empty directory still reads as 'no generations'", () => {
    const w = makeWorld();
    expect(listGenerations(w.deps, w.paths)).toEqual([]);
  });

  it("watchdogAct fails closed (exit 1, nothing actuated) when evidence cannot be read", async () => {
    const w = makeWorld();
    writeDesiredState(w.deps, w.paths, "running");
    w.fs.readdirFailure = Object.assign(new Error("EIO"), { code: "EIO" });
    const code = await watchdogAct(w.deps, w.paths, "unhealthy");
    expect(code).toBe(1);
    expect(w.execCalls.some((c) => c[0] === "launchctl" && c[1] === "kickstart")).toBe(false);
    expect(w.fs.unlinked).toEqual([]);
    expect(w.logs.join("\n")).toContain("fail closed");
  });

  it("a failing lstat PROPAGATES instead of reading as 'socket absent'", () => {
    const w = makeWorld();
    w.fs.lstatFailure = Object.assign(new Error("EIO"), { code: "EIO" });
    // realDeps converts this to a SupervisionEvidenceError; what matters at
    // the logic level is that it is never swallowed into a null/"missing
    // socket" answer, which would read as failure evidence and drive action.
    expect(() => probeUnixHttp(w.deps, w.paths.nextSocket, "/api/healthz")).toThrow("EIO");
  });
});

describe("custody journal ownership [R4]", () => {
  const j: CustodyJournal = {
    ownerPid: 4242,
    ownerStartTimeNs: "4242000",
    priorLoaded: true,
    plistPath: "/home/u/Library/LaunchAgents/dev.remote.app.prod.plist",
    slot: "blue",
    phase: "pre-migration",
    ts: 1_700_000_000_000,
  };

  it("accepts only an exact pid + start-time match", () => {
    expect(custodyJournalOwnedBy(j, { pid: 4242, startTimeNs: "4242000" })).toBe(true);
  });

  it("rejects a different deploy's journal (pid mismatch)", () => {
    expect(custodyJournalOwnedBy(j, { pid: 9999, startTimeNs: "4242000" })).toBe(false);
  });

  it("rejects a RECYCLED pid (same pid, different start time)", () => {
    expect(custodyJournalOwnedBy(j, { pid: 4242, startTimeNs: "9999000" })).toBe(false);
  });

  it("rejects when our own start time is unreadable (ownership unprovable)", () => {
    expect(custodyJournalOwnedBy(j, { pid: 4242, startTimeNs: null })).toBe(false);
  });
});

describe("partial custody restoration is durable [R4]", () => {
  const journal: CustodyJournal = {
    ownerPid: 777,
    ownerStartTimeNs: "777000",
    priorLoaded: true,
    plistPath: "/home/u/Library/LaunchAgents/dev.remote.app.prod.plist",
    slot: "blue",
    phase: "pre-migration",
    ts: 1_700_000_000_000,
  };

  it("records restorePending when the bootstrap succeeds but the slot restore fails", async () => {
    const w = makeWorld();
    w.setJobLoaded(false);
    w.fs.files.set(w.paths.prodPlist, "<plist/>");
    writeDesiredState(w.deps, w.paths, "maintenance");
    writeCustodyJournal(w.deps, w.paths, journal); // owner pid 777 is dead

    const code = await watchdogAct(w.deps, w.paths, "unhealthy", { restoreSlot: () => false });

    expect(code).toBe(1);
    const retained = readCustodyJournal(w.deps, w.paths) as CustodyJournal;
    expect(retained.restorePending).toBe(true);
  });

  it("escalates PARTIAL exactly once on close-out, then clears the journal", () => {
    const w = makeWorld();
    writeCustodyJournal(w.deps, w.paths, { ...journal, restorePending: true });
    closeOutCustodyJournal(w.deps, w.paths, { ...journal, restorePending: true }, "prod healthy");
    expect(w.logs.join("\n")).toContain("PARTIAL");
    expect(w.logs.join("\n")).toContain("UNRECONCILED");
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
  });

  it("a healthy close-out of a restorePending journal surfaces it instead of dropping it", async () => {
    const w = makeWorld();
    w.setJobLoaded(true);
    w.makeHealthy();
    writeDesiredState(w.deps, w.paths, "maintenance");
    writeCustodyJournal(w.deps, w.paths, { ...journal, restorePending: true });

    const code = await watchdogAct(w.deps, w.paths, "custody-check");

    expect(code).toBe(0);
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
    expect(w.logs.join("\n")).toContain("PARTIAL");
    expect(desiredOf(w)).toBe("running");
  });

  it("a clean close-out does NOT claim a partial restoration", () => {
    const w = makeWorld();
    writeCustodyJournal(w.deps, w.paths, journal);
    closeOutCustodyJournal(w.deps, w.paths, journal, "prod healthy");
    expect(w.logs.join("\n")).not.toContain("PARTIAL");
    expect(readCustodyJournal(w.deps, w.paths)).toBeNull();
  });
});

describe("generation numbering can never be reused [R12]", () => {
  it("nextGenNumber counts LEDGER entries, not just manifests", () => {
    const w = makeWorld();
    // A wrapper appended its generation entry and then died before writing the
    // manifest: nothing on disk names generation 12, but reusing it would give
    // two generations one identity.
    w.fs.files.set(w.paths.generationLedger, "1700000000 generation-start 12\n");
    expect(maxGenerationLedgerNumber(w.deps, w.paths)).toBe(12);
    expect(nextGenNumber(w.deps, w.paths)).toBe(13);
  });

  it("still advances past on-disk manifests when the ledger is behind", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 20 }));
    w.fs.files.set(w.paths.generationLedger, "1700000000 generation-start 3\n");
    expect(nextGenNumber(w.deps, w.paths)).toBe(21);
  });
});

describe("installer rollback gate: a slow-exiting generation blocks the re-bootstrap", () => {
  it("waitForGenerationExit reports timeout while the replacement wrapper lives", async () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 5, phase: "running" }));
    w.procs.set(100, "111"); // the replacement wrapper is still shutting down
    // The installer's restore path treats anything but exited/no-evidence as
    // "do NOT bootstrap" — otherwise the restored job overlaps this one.
    expect(await waitForGenerationExit(w.deps, w.paths, 300)).toBe("timeout");
    w.procs.delete(100);
    w.procs.delete(200);
    w.procs.delete(300);
    expect(await waitForGenerationExit(w.deps, w.paths, 300)).toBe("exited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-4 remediation: attribution requires positive identification, and
// force-reclaim can actually recover the states it is advertised for
// ─────────────────────────────────────────────────────────────────────────────

describe("commandMatchesRecorded", () => {
  it("matches an inner process that kept the recorded script path", () => {
    // The wrapper exec'd `bun run tsx src/server/index.ts`; the surviving
    // descendant is the inner node process running the same script.
    expect(
      commandMatchesRecorded(
        "node /Users/x/app/node_modules/.bin/tsx src/server/index.ts",
        ["bun", "run", "tsx", "src/server/index.ts"],
      ),
    ).toBe(true);
  });
  it("matches the standalone server by its script path", () => {
    expect(
      commandMatchesRecorded("node scripts/standalone-server.js", ["node", "scripts/standalone-server.js"]),
    ).toBe(true);
  });
  it("rejects an unrelated command that merely inherited the pgid", () => {
    expect(
      commandMatchesRecorded("/usr/bin/python3 /Users/x/other/tool.py", ["node", "scripts/standalone-server.js"]),
    ).toBe(false);
  });
  it("rejects an empty/unreadable command line", () => {
    expect(commandMatchesRecorded("   ", ["node", "scripts/standalone-server.js"])).toBe(false);
  });
  it("falls back to the argv[0] basename when no script token was recorded", () => {
    expect(commandMatchesRecorded("/usr/local/bin/redis-server *:6379", ["redis-server"])).toBe(true);
    expect(commandMatchesRecorded("/usr/bin/python3 tool.py", ["redis-server"])).toBe(false);
  });
});

describe("group attribution refuses anything it cannot positively identify", () => {
  /** A prior generation whose child leader is dead but whose pgroup is occupied. */
  const deadLeaderWorld = (overrides: Partial<GenerationManifest> = {}) => {
    const w = makeWorld();
    const startedAt = w.now() - 600_000;
    writeManifest(
      w.deps,
      w.paths,
      makeManifest({
        gen: 1,
        startedAt,
        stoppingAt: startedAt + 60_000,
        terminal: undefined,
        commands: { next: ["node", "scripts/standalone-server.js"] },
        ...overrides,
      }),
    );
    return { w, startedAt };
  };

  it("does NOT signal a LATER, unrelated group that inherited the recycled pgid", async () => {
    // THE REGRESSION CASE: every member started AFTER the generation, so a
    // lower-bound-only test would have judged them descendants and SIGKILLed
    // an unrelated process group.
    const { w, startedAt } = deadLeaderWorld();
    w.procs.set(201, String((startedAt + 300_000) * 1_000_000)); // long after stoppingAt
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js"); // even the command matches

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(w.procs.has(201)).toBe(true);
    expect(res.killedPgids).not.toContain(200);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(w.logs.join("\n")).toContain("started AFTER the generation stopped being current");
  });

  it("does NOT signal a group whose member command does not match the recorded spawn command", async () => {
    const { w, startedAt } = deadLeaderWorld();
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000)); // inside the window
    w.pgids.set(201, 200);
    w.procCommands.set(201, "/usr/bin/python3 unrelated-tool.py");

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(w.logs.join("\n")).toContain("does not match the recorded spawn command");
  });

  it("does NOT signal when the generation has no recorded upper bound", async () => {
    const { w, startedAt } = deadLeaderWorld({ stoppingAt: undefined });
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js");

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(w.logs.join("\n")).toContain("no upper bound");
  });

  it("does NOT signal when no spawn command was recorded for the child", async () => {
    const { w, startedAt } = deadLeaderWorld({ commands: undefined });
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js");

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(w.logs.join("\n")).toContain("no spawn command recorded");
  });

  it("does NOT signal when a member's command line is unreadable", async () => {
    const { w, startedAt } = deadLeaderWorld();
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    // procCommands intentionally unset ⇒ `ps -o command=` reports failure.

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(w.killCalls.some(([pid, sig]) => pid === -200 && sig !== 0)).toBe(false);
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
  });

  it("reports the exact pids and commands of an unattributable group", async () => {
    const { w, startedAt } = deadLeaderWorld();
    w.procs.set(201, String((startedAt + 300_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js");
    await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    const logs = w.logs.join("\n");
    expect(logs).toContain("201 (node scripts/standalone-server.js)");
    expect(logs).toContain("ESCALATION");
  });
});

describe("manifest records the bounds attribution needs", () => {
  it("entering `stopping` stamps stoppingAt", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 4, phase: "running" }));
    w.setNow(1_700_000_555_000);
    updateManifestPhase(w.deps, w.paths, 4, "stopping");
    const m = readManifest(w.deps, w.paths, 4) as GenerationManifest;
    expect(m.phase).toBe("stopping");
    expect(m.stoppingAt).toBe(1_700_000_555_000);
  });

  it("does not overwrite an existing stoppingAt", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 4, phase: "stopping", stoppingAt: 111 }));
    w.setNow(999_999);
    updateManifestPhase(w.deps, w.paths, 4, "stopping");
    expect((readManifest(w.deps, w.paths, 4) as GenerationManifest).stoppingAt).toBe(111);
  });

  it("beginChildSpawn records the spawn argv for later identification", () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 2, next: undefined, terminal: undefined, sockets: {} });
    writeManifest(w.deps, w.paths, m);
    beginChildSpawn(w.deps, w.paths, m, "next", w.paths.nextSocket, ["node", "scripts/standalone-server.js"]);
    const onDisk = readManifest(w.deps, w.paths, 2) as GenerationManifest;
    expect(onDisk.commands?.next).toEqual(["node", "scripts/standalone-server.js"]);
  });

  it("rejects a malformed commands record as a CORRUPT manifest", () => {
    const w = makeWorld();
    writeManifest(w.deps, w.paths, makeManifest({ gen: 1 }));
    const file = "/data/server/generations/1.json";
    const raw = JSON.parse(w.fs.files.get(file) as string);
    raw.commands = { next: "node scripts/standalone-server.js" }; // string, not string[]
    w.fs.files.set(file, JSON.stringify(raw));
    expect(readManifest(w.deps, w.paths, 1)).toBe("corrupt");
  });
});

describe("socketHolder", () => {
  it("reports a live holder's pids", () => {
    const w = makeWorld();
    w.fs.stats.set(w.paths.nextSocket, { dev: 5, ino: 50, isSocket: true });
    w.socketHolders.set(w.paths.nextSocket, [808, 809]);
    const h = socketHolder(w.deps, w.paths.nextSocket);
    expect(h.state).toBe("held");
    expect(h.detail).toContain("808, 809");
  });
  it("reports free when the socket exists with no holder", () => {
    const w = makeWorld();
    w.fs.stats.set(w.paths.nextSocket, { dev: 5, ino: 50, isSocket: true });
    expect(socketHolder(w.deps, w.paths.nextSocket).state).toBe("free");
  });
  it("reports free when the path is not a socket at all", () => {
    const w = makeWorld();
    expect(socketHolder(w.deps, w.paths.nextSocket).state).toBe("free");
  });
  it("reports UNKNOWN (never free) when lsof cannot be run", () => {
    const w = makeWorld();
    w.fs.stats.set(w.paths.nextSocket, { dev: 5, ino: 50, isSocket: true });
    const deps = {
      ...w.deps,
      exec: (cmd: string[]) => (cmd[0] === "lsof" ? { exitCode: 127, stdout: "", stderr: "not found" } : w.deps.exec(cmd)),
    };
    expect(socketHolder(deps, w.paths.nextSocket).state).toBe("unknown");
  });
});

describe("pid-less spawn placeholder is recoverable, never a permanent brick [F4]", () => {
  /** A generation SIGKILLed between the placeholder write and the pid write. */
  const placeholderWorld = () => {
    const w = makeWorld();
    const m = makeManifest({
      gen: 1,
      phase: "starting",
      next: undefined,
      terminal: undefined,
      sockets: {},
    });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    return w;
  };

  it("is NEVER retired automatically, even with a dead wrapper and a holder-free socket", async () => {
    // THE BIND WINDOW: the wrapper wrote the placeholder, spawn() succeeded,
    // and the wrapper died before recording the pid — all while the child had
    // not yet bound. lsof truthfully reports "free", but the child is about to
    // bind. Retiring here would admit a second generation onto that socket.
    const w = placeholderWorld(); // wrapper pid 100 is not in `procs` ⇒ dead
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(res.archivedGens).not.toContain(1);
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
  });

  it("stays unresolved while the claimed socket has a live holder", async () => {
    const w = placeholderWorld();
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });
    w.socketHolders.set(w.paths.nextSocket, [4242]);

    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });

    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
  });

  it("stays unresolved while the wrapper's identity is merely unavailable", async () => {
    const w = placeholderWorld();
    w.identityUnavailablePids.add(100); // wrapper alive, start time unreadable
    const res = await reclaimPriorGenerations(w.deps, w.paths, { currentGen: null });
    expect(res.unresolvedGens.map((u) => u.gen)).toContain(1);
    expect(res.archivedGens).not.toContain(1);
  });

  it("force-reclaim RETIRES an intact-but-unresolved generation and unlinks its holder-free socket", async () => {
    const w = makeWorld();
    // Unresolvable without consent: the wrapper is still identity-unavailable.
    const m = makeManifest({ gen: 1, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    w.identityUnavailablePids.add(100);
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });

    const code = await doctorSupervision(w.deps, w.paths, { forceReclaim: true });

    expect(code).toBe(0);
    expect(w.fs.unlinked).toContain(w.paths.nextSocket);
    expect(w.logs.join("\n")).toContain("WITH OPERATOR CONSENT");
    expect(w.logs.join("\n")).toContain("Evidence being discarded");
    expect(listGenerations(w.deps, w.paths)).not.toContain(1);
  });

  it("force-reclaim REFUSES a generation whose socket still has a live holder", async () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    w.identityUnavailablePids.add(100);
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });
    w.socketHolders.set(w.paths.nextSocket, [4242]);

    const code = await doctorSupervision(w.deps, w.paths, { forceReclaim: true });

    expect(code).toBe(1);
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
    expect(w.logs.join("\n")).toContain("REFUSING to retire generation 1");
    expect(w.logs.join("\n")).toContain("4242");
    expect(listGenerations(w.deps, w.paths)).toContain(1);
  });

  it("force-reclaim REFUSES when the socket's holder cannot be determined", async () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    w.identityUnavailablePids.add(100);
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });
    const deps = {
      ...w.deps,
      exec: (cmd: string[]) => (cmd[0] === "lsof" ? { exitCode: 127, stdout: "", stderr: "" } : w.deps.exec(cmd)),
    };

    const code = await doctorSupervision(deps, w.paths, { forceReclaim: true });

    expect(code).toBe(1);
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
  });
});

describe("deploy restart token file permissions [F11]", () => {
  it("re-creates the file so the 0600 mode actually applies", () => {
    const w = makeWorld();
    // A pre-existing token file with looser permissions.
    w.fs.writeFileSync(w.paths.deployRestartToken, "stale\n");
    w.fs.modes.delete(w.paths.deployRestartToken);

    const token = issueDeployRestartToken(w.deps, w.paths);

    expect(w.fs.unlinked).toContain(w.paths.deployRestartToken); // removed, not overwritten
    expect(w.fs.modes.get(w.paths.deployRestartToken)).toBe(0o600);
    // The stale token is dead; only the fresh one authorizes.
    expect(consumeDeployRestartToken(w.deps, w.paths, "stale")).toBe(false);
    expect(consumeDeployRestartToken(w.deps, w.paths, token)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-5 remediation: TOCTOU-free force-reclaim, abandoned deploy results
// ─────────────────────────────────────────────────────────────────────────────

describe("force-reclaim re-validates holders at every destructive step", () => {
  /** An unresolved generation (pid-less placeholder, unverifiable wrapper). */
  const unresolvedWorld = () => {
    const w = makeWorld();
    const m = makeManifest({ gen: 1, phase: "starting", next: undefined, terminal: undefined, sockets: {} });
    m.spawning = [{ child: "next", socketPath: w.paths.nextSocket }];
    writeManifest(w.deps, w.paths, m);
    w.identityUnavailablePids.add(100);
    w.fs.stats.set(w.paths.nextSocket, { dev: 9, ino: 999, isSocket: true });
    return w;
  };

  it("aborts the retirement when a holder appears between the check and the unlink", async () => {
    const w = unresolvedWorld();
    // lsof reports free on the first call and a holder on every call after —
    // a process that bound in the TOCTOU window.
    let calls = 0;
    const deps: SupervisionDeps = {
      ...w.deps,
      exec: (cmd) => {
        if (cmd[0] === "lsof") {
          calls += 1;
          return calls <= 1
            ? { exitCode: 1, stdout: "", stderr: "" }
            : { exitCode: 0, stdout: "5150\n", stderr: "" };
        }
        return w.deps.exec(cmd);
      },
    };

    const code = await doctorSupervision(deps, w.paths, { forceReclaim: true });

    expect(code).toBe(1);
    expect(w.fs.unlinked).not.toContain(w.paths.nextSocket);
    expect(listGenerations(w.deps, w.paths)).toContain(1); // never archived
    expect(w.logs.join("\n")).toContain("ABORTING retirement");
    expect(w.logs.join("\n")).toContain("5150");
  });

  it("does not archive when a process re-binds after the unlink but before archiving", async () => {
    const w = unresolvedWorld();
    // The child of the pid-less placeholder finally binds — right after our
    // unlink removed the stale path. The pre-archive re-check must catch it;
    // archiving would hide a LIVE generation from every later reclaim.
    const deps: SupervisionDeps = {
      ...w.deps,
      // FakeFs methods live on the prototype, so the override delegates
      // explicitly rather than spreading.
      fs: {
        existsSync: (p) => w.fs.existsSync(p),
        readFileSync: (p) => w.fs.readFileSync(p),
        writeFileSync: (p, data, mode) => w.fs.writeFileSync(p, data, mode),
        appendFileSync: (p, data) => w.fs.appendFileSync(p, data),
        renameSync: (from, to) => w.fs.renameSync(from, to),
        mkdirSync: () => w.fs.mkdirSync(),
        readdirSync: (p) => w.fs.readdirSync(p),
        lstatSync: (p) => w.fs.lstatSync(p),
        unlinkSync: (path: string) => {
          w.fs.unlinkSync(path);
          if (path === w.paths.nextSocket) {
            w.fs.stats.set(path, { dev: 9, ino: 1000, isSocket: true });
            w.socketHolders.set(path, [6161]);
          }
        },
      },
    };

    const code = await doctorSupervision(deps, w.paths, { forceReclaim: true });

    expect(code).toBe(1);
    expect(listGenerations(w.deps, w.paths)).toContain(1); // manifest kept as evidence
    expect(w.logs.join("\n")).toContain("NOT archiving generation 1");
    expect(w.logs.join("\n")).toContain("6161");
  });

  it("still retires cleanly when the socket stays holder-free throughout", async () => {
    const w = unresolvedWorld();
    const code = await doctorSupervision(w.deps, w.paths, { forceReclaim: true });
    expect(code).toBe(0);
    expect(w.fs.unlinked).toContain(w.paths.nextSocket);
    expect(listGenerations(w.deps, w.paths)).not.toContain(1);
  });
});

describe("abandoned in_progress deploy results are reconciled [C]", () => {
  const inProgress = (owner?: { pid: number; startTimeNs: string }) =>
    JSON.stringify({
      status: "in_progress",
      requestedCommit: "abc123",
      activeCommit: "def456",
      stage: "finalize",
      startedAt: "2026-08-03T00:00:00.000Z",
      ...(owner ? { owner } : {}),
    });

  it("rewrites to failed when the owning deploy is provably dead", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployResultFile, inProgress({ pid: 900, startTimeNs: "900000" }));
    // pid 900 is not in `procs` ⇒ dead.
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(true);
    const rewritten = JSON.parse(w.fs.files.get(w.paths.deployResultFile) as string);
    expect(rewritten.status).toBe("failed");
    expect(rewritten.error).toContain("died during finalization");
    expect(rewritten.finishedAt).toBeTruthy();
    // Preserves the record's other fields for the poll/UI.
    expect(rewritten.requestedCommit).toBe("abc123");
  });

  it("rewrites to failed when the owner's pid was RECYCLED (different identity)", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployResultFile, inProgress({ pid: 900, startTimeNs: "900000" }));
    w.procs.set(900, "totally-different-start");
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(true);
    expect(JSON.parse(w.fs.files.get(w.paths.deployResultFile) as string).status).toBe("failed");
  });

  it("leaves a LIVE deploy's record alone", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployResultFile, inProgress({ pid: 900, startTimeNs: "900000" }));
    w.procs.set(900, "900000");
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false);
    expect(JSON.parse(w.fs.files.get(w.paths.deployResultFile) as string).status).toBe("in_progress");
  });

  it("fails CLOSED when the owner's identity cannot be read", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployResultFile, inProgress({ pid: 900, startTimeNs: "900000" }));
    w.identityUnavailablePids.add(900);
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false);
    expect(JSON.parse(w.fs.files.get(w.paths.deployResultFile) as string).status).toBe("in_progress");
  });

  it("leaves an unstamped (pre-upgrade) record alone", () => {
    const w = makeWorld();
    w.fs.files.set(w.paths.deployResultFile, inProgress());
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false);
  });

  it("ignores terminal records and a missing/corrupt file", () => {
    const w = makeWorld();
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false); // absent
    w.fs.files.set(w.paths.deployResultFile, JSON.stringify({ status: "success", owner: { pid: 900, startTimeNs: "9" } }));
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false);
    w.fs.files.set(w.paths.deployResultFile, "{not json");
    expect(reconcileAbandonedDeployResult(w.deps, w.paths)).toBe(false);
  });

  it("the watchdog's custody sweep reconciles it and escalates once", async () => {
    const w = makeWorld();
    w.setJobLoaded(true);
    w.makeHealthy();
    writeDesiredState(w.deps, w.paths, "running");
    w.fs.files.set(w.paths.deployResultFile, inProgress({ pid: 900, startTimeNs: "900000" }));

    const code = await watchdogAct(w.deps, w.paths, "custody-check");

    expect(code).toBe(0);
    expect(JSON.parse(w.fs.files.get(w.paths.deployResultFile) as string).status).toBe("failed");
    expect(w.logs.join("\n")).toContain("rewrote an abandoned in_progress deploy result");
    // A second sweep has nothing left to do — no repeated escalation.
    w.logs.length = 0;
    await watchdogAct(w.deps, w.paths, "custody-check");
    expect(w.logs.join("\n")).not.toContain("rewrote an abandoned in_progress deploy result");
  });
});

describe("attributed-but-survived is still an incomplete stop [D]", () => {
  it("reports attributed:true, killed:false and leaves the group occupied", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 600_000;
    // Positively identifiable — in the window, command matches — but the
    // group survives every signal.
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js");
    w.unkillablePgids.add(200);

    const outcome = await attributeAndKillGroup(w.deps, {
      pgid: 200,
      startedAtMs: startedAt,
      endedAtMs: startedAt + 60_000,
      expectedArgv: ["node", "scripts/standalone-server.js"],
      label: "gen 1 child next 200",
    });

    // `attributed` alone would read as "handled" — it is not: the processes
    // are still there. stopProd() therefore keys its desired-state restore on
    // (!attributed || pgroupOccupied), which this pair drives.
    expect(outcome.attributed).toBe(true);
    expect(outcome.killed).toBe(false);
    expect(outcome.detail).toContain("survived SIGKILL");
    expect(pgroupOccupied(w.deps, 200)).toBe(true);
  });

  it("reports attributed:true, killed:true only when the group is verifiably gone", async () => {
    const w = makeWorld();
    const startedAt = w.now() - 600_000;
    w.procs.set(201, String((startedAt + 1_000) * 1_000_000));
    w.pgids.set(201, 200);
    w.procCommands.set(201, "node scripts/standalone-server.js");

    const outcome = await attributeAndKillGroup(w.deps, {
      pgid: 200,
      startedAtMs: startedAt,
      endedAtMs: startedAt + 60_000,
      expectedArgv: ["node", "scripts/standalone-server.js"],
      label: "gen 1 child next 200",
    });

    expect(outcome).toMatchObject({ attributed: true, killed: true });
    expect(pgroupOccupied(w.deps, 200)).toBe(false);
  });
});
