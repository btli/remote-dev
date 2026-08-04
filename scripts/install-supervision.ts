#!/usr/bin/env bun
/**
 * Canonical supervision installer (remote-dev-7fsq — Spec v3 §3.8 [F15, F16, R6])
 *
 * The ONE transactional installer for the macOS prod supervision layout:
 *   - dev.remote.app.prod   (KeepAlive wrapper job — the sole process owner)
 *   - dev.remote.app.watchdog (StartInterval 60 probe shim)
 *
 * Both plists are rendered from the repo-canonical templates in
 * scripts/service-config/ — the installed copies are never hand-authored
 * again [F15]. `install.sh` (macOS branch) and `deploy-setup.sh` (watchdog
 * block) delegate here.
 *
 * TRANSACTION ORDER — nothing destructive happens before the restore trap is
 * armed [R6]:
 *   1. Control lock; refuse while a live deploy holds deploy.lock.
 *   2. Render both plists → `plutil -lint` → diff vs installed → NO-OP exit if
 *      identical → back up installed plists + record each job's loaded state.
 *   3. Arm restore logic (finally + best-effort signal handlers): restore the
 *      backups and re-bootstrap ONLY jobs that were loaded before.
 *   4. Bootout watchdog → bootout prod → install both plists → bootstrap prod
 *      → wait probe-ready (bounded) → bootstrap watchdog → desired=running →
 *      disarm.
 *
 * Usage:
 *   bun scripts/install-supervision.ts [--project-root DIR] [--data-dir DIR]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import {
  PROD_LABEL,
  WATCHDOG_LABEL,
  acquireControlLock,
  bootoutJob,
  bootstrapJob,
  deployLockLive,
  launchdJobLoaded,
  notifyEscalation,
  probeProdHealthy,
  realDeps,
  supervisionPaths,
  waitForGenerationExit,
  writeDesiredState,
  type SupervisionDeps,
} from "./rdv-supervision";

const argv = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

const PROJECT_ROOT = argValue("--project-root") || process.env.DEPLOY_PROJECT_ROOT || join(import.meta.dir, "..");
const DATA_DIR = argValue("--data-dir") || process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const HOME = process.env.HOME || homedir();
/** The bun binary launchd should exec (this very runtime). */
const BUN_PATH = process.execPath;

/** How long to wait for prod probes after bootstrap before declaring failure. */
const PROBE_READY_TIMEOUT_MS = 180_000;
/** Bounded wait for a booted-out generation to be verifiably gone. */
const GENERATION_EXIT_TIMEOUT_MS = 40_000;

function log(msg: string): void {
  console.log(`[install-supervision] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[install-supervision] ERROR: ${msg}`);
  process.exit(1);
}

/** Render a service-config template with the standard placeholder set. */
function renderTemplate(templatePath: string): string {
  if (!existsSync(templatePath)) fail(`template missing: ${templatePath}`);
  return readFileSync(templatePath, "utf-8")
    .replaceAll("__BUN__", BUN_PATH)
    .replaceAll("__PROJECT_ROOT__", PROJECT_ROOT)
    .replaceAll("__DATA_DIR__", DATA_DIR)
    .replaceAll("__HOME__", HOME);
}

/** plutil -lint a rendered plist (via a temp file) — refuse to install garbage. */
function lintPlist(deps: SupervisionDeps, label: string, content: string): void {
  const tmp = join(DATA_DIR, `.${label}.render.plist`);
  writeFileSync(tmp, content);
  try {
    const res = deps.exec(["plutil", "-lint", tmp]);
    if (res.exitCode !== 0) {
      fail(`rendered ${label} plist failed plutil -lint: ${res.stdout} ${res.stderr}`);
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort temp cleanup
    }
  }
}

interface JobPlan {
  label: string;
  installedPath: string;
  rendered: string;
  /** Loaded state recorded BEFORE the transaction touches anything. */
  wasLoaded: boolean;
  /** Backup of the previously installed plist (null = none existed). */
  backupPath: string | null;
}

async function main(): Promise<number> {
  if (process.platform !== "darwin") {
    fail("install-supervision is macOS-only (launchd). Linux/k8s installs are container-supervised.");
  }
  if (!existsSync(join(PROJECT_ROOT, "scripts", "rdv.ts"))) {
    fail(
      `--project-root ${PROJECT_ROOT} does not contain scripts/rdv.ts — the prod job cannot run from it.`,
    );
  }

  const deps = realDeps();
  const paths = supervisionPaths({ ...process.env, RDV_DATA_DIR: DATA_DIR });
  const templateDir = join(import.meta.dir, "service-config");

  // 1. Control lock; refuse while a deploy is live.
  const lock = await acquireControlLock(deps, paths);
  if (!lock) fail("control lock busy — another supervision transaction is in flight; retry shortly.");
  try {
    if (deployLockLive(deps, paths)) {
      fail("a live deploy holds deploy.lock; refusing to reinstall supervision mid-deploy.");
    }

    // 2. Render + lint + diff.
    const jobs: JobPlan[] = [
      {
        label: PROD_LABEL,
        installedPath: paths.prodPlist,
        rendered: renderTemplate(join(templateDir, `${PROD_LABEL}.plist`)),
        wasLoaded: false,
        backupPath: null,
      },
      {
        label: WATCHDOG_LABEL,
        installedPath: paths.watchdogPlist,
        // Historical template filename (label inside is dev.remote.app.watchdog).
        rendered: renderTemplate(join(templateDir, "dev.remote.watchdog.plist")),
        wasLoaded: false,
        backupPath: null,
      },
    ];
    for (const job of jobs) lintPlist(deps, job.label, job.rendered);

    const allIdentical = jobs.every(
      (job) => existsSync(job.installedPath) && readFileSync(job.installedPath, "utf-8") === job.rendered,
    );
    if (allIdentical) {
      // NO-OP [R6]: installed config already matches the render — exit on
      // CONTENT identity alone, regardless of loaded state. Proceeding here
      // would bootstrap + desired=running, silently undoing an intentional
      // `rdv stop` (desired=stopped) [R5]; `rdv start prod` is the explicit
      // re-enable.
      log("installed plists already match the rendered config; nothing to do (rdv start prod re-enables a stopped job).");
      return 0;
    }

    // Fresh accounts may not have a LaunchAgents dir yet — create it BEFORE
    // any transactional step can try to write into it.
    for (const job of jobs) mkdirSync(dirname(job.installedPath), { recursive: true });

    // Record loaded state + take backups BEFORE anything destructive.
    for (const job of jobs) {
      const loaded = launchdJobLoaded(deps, job.label);
      if (loaded === "unknown") fail(`launchctl state for ${job.label} is unknown; refusing to proceed [F9].`);
      job.wasLoaded = loaded;
      if (existsSync(job.installedPath)) {
        job.backupPath = `${job.installedPath}.bak`;
        copyFileSync(job.installedPath, job.backupPath);
      }
    }

    // 3. Arm the restore trap [R6]: put back the backups and re-bootstrap ONLY
    // the jobs that were loaded before we started.
    let disarmed = false;
    const restore = async (): Promise<void> => {
      if (disarmed) return;
      disarmed = true; // restore runs at most once
      console.error("[install-supervision] transaction failed — restoring previous supervision state");
      for (const job of jobs) {
        try {
          if (launchdJobLoaded(deps, job.label) === true && !bootoutJob(deps, job.label)) {
            console.error(`[install-supervision] restore: bootout of ${job.label} failed`);
            notifyEscalation(deps, paths, `install-supervision restore: bootout of ${job.label} failed`);
          }
          // The replacement generation must be VERIFIABLY gone before the old
          // job is bootstrapped back — exactly the wait the forward path does.
          // launchctl bootout returns as soon as it has signalled, so without
          // this the restored job can overlap a slow-exiting wrapper for up to
          // ExitTimeOut, recreating the dual-owner transition on the very path
          // that exists to prevent it.
          let exitVerified = true;
          if (job.label === PROD_LABEL) {
            const outcome = await waitForGenerationExit(deps, paths, GENERATION_EXIT_TIMEOUT_MS);
            exitVerified = outcome === "exited" || outcome === "no-evidence";
            if (!exitVerified) {
              console.error(
                `[install-supervision] restore: previous ${job.label} generation did not verifiably exit ` +
                  `(${outcome}) — NOT bootstrapping over it`,
              );
            }
          }
          if (job.backupPath && existsSync(job.backupPath)) {
            copyFileSync(job.backupPath, job.installedPath);
          } else if (!job.backupPath && existsSync(job.installedPath)) {
            unlinkSync(job.installedPath); // nothing was installed before
          }
          if (!exitVerified) {
            // ROLLBACK FAILED — loudly. Bootstrapping here would put two
            // owners on one socket set; leaving it stopped is recoverable by
            // hand, a dual-writer flap is the outage we are preventing.
            notifyEscalation(
              deps,
              paths,
              `install-supervision ROLLBACK INCOMPLETE: ${job.label} plist restored but the job was NOT ` +
                "restarted (previous generation still alive/unverifiable). Prod is DOWN — run " +
                "`rdv doctor-supervision` and then `rdv start prod`.",
            );
            continue;
          }
          if (job.wasLoaded && existsSync(job.installedPath) && !bootstrapJob(deps, job.installedPath)) {
            console.error(`[install-supervision] restore: bootstrap of ${job.label} failed`);
            notifyEscalation(deps, paths, `install-supervision restore: bootstrap of ${job.label} failed`);
          }
        } catch (err) {
          console.error(`[install-supervision] restore of ${job.label} failed: ${String(err)}`);
          notifyEscalation(deps, paths, `install-supervision restore of ${job.label} failed: ${String(err)}`);
        }
      }
    };
    // Signal handlers cannot await, so the restore transaction is run to
    // completion before the process exits.
    const onSignal = (): void => {
      void restore().then(
        () => process.exit(1),
        () => process.exit(1),
      );
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      // 4. The transaction proper.
      const [prodJob, watchdogJob] = jobs;

      if (launchdJobLoaded(deps, WATCHDOG_LABEL) === true) {
        log(`bootout ${WATCHDOG_LABEL}`);
        if (!bootoutJob(deps, WATCHDOG_LABEL)) {
          throw new Error(`launchctl bootout ${WATCHDOG_LABEL} failed — aborting (restore will roll back)`);
        }
      }
      if (launchdJobLoaded(deps, PROD_LABEL) === true) {
        log(`bootout ${PROD_LABEL}`);
        if (!bootoutJob(deps, PROD_LABEL)) {
          throw new Error(`launchctl bootout ${PROD_LABEL} failed — aborting (restore will roll back)`);
        }
        // The old generation must verifiably exit BEFORE the plists are
        // overwritten and a new job bootstrapped — otherwise two stacks race.
        const outcome = await waitForGenerationExit(deps, paths, GENERATION_EXIT_TIMEOUT_MS);
        if (outcome === "timeout" || outcome === "unverifiable") {
          throw new Error(
            `previous generation did not verifiably exit after bootout (${outcome}) — aborting`,
          );
        }
      }

      for (const job of jobs) {
        log(`install ${job.installedPath}`);
        writeFileSync(job.installedPath, job.rendered);
      }

      log(`bootstrap ${PROD_LABEL}`);
      if (!bootstrapJob(deps, prodJob.installedPath)) {
        throw new Error(`launchctl bootstrap ${PROD_LABEL} failed`);
      }

      log(`waiting for prod probes (${Math.round(PROBE_READY_TIMEOUT_MS / 1000)}s budget)...`);
      const deadline = deps.now() + PROBE_READY_TIMEOUT_MS;
      let healthy = false;
      while (deps.now() < deadline) {
        if (probeProdHealthy(deps, paths)) {
          healthy = true;
          break;
        }
        await deps.sleep(3000);
      }
      if (!healthy) {
        throw new Error(`prod did not become probe-healthy within the budget — rolling back the install`);
      }

      log(`bootstrap ${WATCHDOG_LABEL}`);
      if (!bootstrapJob(deps, watchdogJob.installedPath)) {
        throw new Error(`launchctl bootstrap ${WATCHDOG_LABEL} failed`);
      }

      writeDesiredState(deps, paths, "running");
      disarmed = true; // success — the trap must not undo the new install.
      log("supervision installed: prod job healthy, watchdog armed, desired=running.");
      return 0;
    } catch (err) {
      console.error(`[install-supervision] ${String(err)}`);
      await restore();
      return 1;
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  } finally {
    lock.release();
  }
}

process.exit(await main());
