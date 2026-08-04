import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { STABLE_SPAWN_CWD } from "@/lib/exec";

const execFileAsync = promisify(execFile);

export type TmuxAsyncRunner = (args: string[]) => Promise<void>;
export type TmuxSyncRunner = (args: string[]) => void;

const runTmuxAsync: TmuxAsyncRunner = async (args) => {
  await execFileAsync("tmux", args, { cwd: STABLE_SPAWN_CWD });
};

const runTmuxSync: TmuxSyncRunner = (args) => {
  execFileSync("tmux", args, { stdio: "pipe", cwd: STABLE_SPAWN_CWD });
};

export function tmuxAbsenceConfirmed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { stderr?: unknown; message?: unknown };
  const stderr = Buffer.isBuffer(candidate.stderr)
    ? candidate.stderr.toString("utf8")
    : typeof candidate.stderr === "string"
      ? candidate.stderr
      : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /can't find session|no server running|error connecting to .*(No such file or directory|Connection refused)/i.test(
    `${stderr}\n${message}`,
  );
}

/** Kill a tmux session, returning false whenever its absence is uncertain. */
export async function stopTmuxSessionAndConfirmAbsent(
  sessionName: string,
  run: TmuxAsyncRunner = runTmuxAsync,
): Promise<boolean> {
  try {
    await run(["kill-session", "-t", sessionName]);
    return true;
  } catch {
    try {
      await run(["has-session", "-t", sessionName]);
      return false;
    } catch (probeError) {
      return tmuxAbsenceConfirmed(probeError);
    }
  }
}

/** Synchronous variant for the serialized WebSocket restart state machine. */
export function stopTmuxSessionAndConfirmAbsentSync(
  sessionName: string,
  run: TmuxSyncRunner = runTmuxSync,
): boolean {
  try {
    run(["kill-session", "-t", sessionName]);
    return true;
  } catch {
    try {
      run(["has-session", "-t", sessionName]);
      return false;
    } catch (probeError) {
      return tmuxAbsenceConfirmed(probeError);
    }
  }
}
