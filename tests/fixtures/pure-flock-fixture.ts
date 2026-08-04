// Bun fixture for tests/pure-flock.test.ts (remote-dev-7fsq [R14]).
//
// scripts/deploy-flock.ts imports bun:ffi, which cannot load under
// vitest/node — so the pure-vs-deploy flock behavior split is exercised by
// REAL bun subprocesses, mirroring tests/fixtures/deploy-flock-fixture.ts.
// Modes (selected by argv[2]):
//
//   pure    acquireFlock(LOCK_FILE) — the PURE primitive. File content is
//           informational only and must NEVER be consulted for liveness, so a
//           pre-written LIVE foreign PID must not block the acquire. Emits
//           RESULT { outcome, content } and optionally holds HOLD_MS.
//   deploy  acquireDeployFlock — the legacy deploy.lock path, where a LIVE
//           foreign PID under the held flock triggers the stale-PID backoff
//           (outcome "held"). Emits RESULT { outcome }.
import { readFileSync } from "node:fs";
import { acquireDeployFlock, acquireFlock } from "../../scripts/deploy-flock";

const lockFile = process.env.LOCK_FILE;
if (!lockFile) {
  console.error("LOCK_FILE env var is required");
  process.exit(2);
}
const mode = process.argv[2] ?? "pure";
const holdMs = parseInt(process.env.HOLD_MS || "0", 10);

function emit(result: Record<string, unknown>): void {
  console.log(`RESULT ${JSON.stringify(result)}`);
}

if (mode === "pure") {
  const handle = acquireFlock(lockFile);
  if (!handle) {
    emit({ outcome: "held" });
    process.exit(0);
  }
  emit({
    outcome: "acquired",
    ownerPid: process.pid,
    content: readFileSync(lockFile, "utf-8"),
  });
  if (holdMs > 0) await Bun.sleep(holdMs);
  handle.release();
  process.exit(0);
} else if (mode === "deploy") {
  const res = acquireDeployFlock({ lockFile, pid: process.pid });
  emit({ outcome: res.outcome });
  if (res.outcome === "acquired") {
    if (holdMs > 0) await Bun.sleep(holdMs);
    res.release();
  }
  process.exit(0);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
