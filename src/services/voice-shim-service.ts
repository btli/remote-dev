import { mkdirSync, copyFileSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SHIM_DIR = join(homedir(), ".remote-dev", "bin");

/** Timestamp of shim source files at last install (prevents redundant copies). */
let lastSoxMtime = 0;
let lastRecMtime = 0;

/**
 * Ensure the sox and rec shims are installed at ~/.remote-dev/bin/.
 * Returns the shim directory path to prepend to PATH.
 *
 * The shims intercept sox/rec recording commands inside agent sessions,
 * reading audio from the voice FIFO instead of the real microphone.
 *
 * Skips file writes if the source hasn't changed since the last install
 * (avoids redundant disk I/O on every agent session creation).
 */
export function ensureSoxShim(): string {
  mkdirSync(SHIM_DIR, { recursive: true });

  const soxSrc = join(import.meta.dirname, "..", "server", "voice-sox-shim.sh");
  const recSrc = join(import.meta.dirname, "..", "server", "voice-rec-shim.sh");

  // Install sox shim (only if source file changed)
  const soxMtime = statSync(soxSrc).mtimeMs;
  if (soxMtime !== lastSoxMtime) {
    const soxDest = join(SHIM_DIR, "sox");
    copyFileSync(soxSrc, soxDest);
    chmodSync(soxDest, "755");
    lastSoxMtime = soxMtime;
  }

  // Install rec shim (only if source file changed)
  const recMtime = statSync(recSrc).mtimeMs;
  if (recMtime !== lastRecMtime) {
    const recDest = join(SHIM_DIR, "rec");
    copyFileSync(recSrc, recDest);
    chmodSync(recDest, "755");
    lastRecMtime = recMtime;
  }

  return SHIM_DIR;
}
