import { mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SHIM_DIR = join(homedir(), ".remote-dev", "bin");

/**
 * Ensure the sox shim is installed at ~/.remote-dev/bin/sox.
 * Returns the shim directory path to prepend to PATH.
 *
 * The shim intercepts sox recording commands inside agent sessions,
 * reading audio from the voice FIFO instead of the real microphone.
 */
export function ensureSoxShim(): string {
  mkdirSync(SHIM_DIR, { recursive: true });

  const shimDest = join(SHIM_DIR, "sox");

  // The shim source lives alongside the terminal server
  const shimSrc = join(import.meta.dirname, "..", "server", "voice-sox-shim.sh");

  // Always overwrite to keep shim up to date
  copyFileSync(shimSrc, shimDest);
  chmodSync(shimDest, "755");

  return SHIM_DIR;
}
