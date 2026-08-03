import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter } from "node:path";

import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { getDataDir } from "@/lib/paths";

const SHIMS = {
  pbcopy: "#!/bin/sh\nexec rdv clipboard copy \"$@\"\n",
  pbpaste: "#!/bin/sh\nexec rdv clipboard paste \"$@\"\n",
} as const;

function installExecutable(path: string, contents: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === contents) {
    chmodSync(path, 0o755);
    return;
  }

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o755,
      flag: "wx",
    });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o755);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The successful rename already removed the temporary pathname.
    }
  }
}

/** Generate stable, executable pbcopy/pbpaste compatibility wrappers. */
export function ensureClipboardShims(dataDir = getDataDir()): string {
  const shimDir = join(dataDir, "rdv", "clipboard-bin");
  mkdirSync(shimDir, { recursive: true, mode: 0o700 });
  for (const [name, contents] of Object.entries(SHIMS)) {
    installExecutable(join(shimDir, name), contents);
  }
  return shimDir;
}

export function prependPathEntry(entry: string, currentPath = ""): string {
  const remaining = currentPath
    .split(delimiter)
    .filter((part) => part.length > 0 && part !== entry);
  return [entry, ...remaining].join(delimiter);
}

interface ClipboardSessionEnvOptions {
  sessionId: string;
  terminalType: string;
  shimDir: string;
  currentPath?: string;
  terminalSocket?: string;
  terminalPort?: string;
}

/**
 * Build the non-secret environment needed by local clipboard shims. SSH is
 * excluded because these host paths and callback endpoints do not exist on the
 * remote machine.
 */
export function buildClipboardSessionEnv(
  options: ClipboardSessionEnvOptions,
): Record<string, string> {
  if (options.terminalType === "ssh") return {};

  return {
    RDV_SESSION_ID: options.sessionId,
    ...(options.terminalSocket
      ? { RDV_TERMINAL_SOCKET: options.terminalSocket }
      : { RDV_TERMINAL_PORT: options.terminalPort ?? "6002" }),
    PATH: prependPathEntry(options.shimDir, options.currentPath),
  };
}
