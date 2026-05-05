/**
 * /api/ssh-connections/[id]/test — POST a connectivity probe.
 *
 * Runs `ssh -o BatchMode=yes -o ConnectTimeout=5 user@host -p N true`
 * (with the same auth flags the plugin would pass at session creation).
 * BatchMode prevents any password prompt — for password auth we still
 * shell out via sshpass and inject SSHPASS so the test mirrors a real
 * session start, but SSH itself never prompts the user.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SshConnectionService from "@/services/ssh-connection-service";
import { buildSshArgs } from "@/lib/terminal-plugins/plugins/ssh-plugin-server";
import { execFileNoThrow } from "@/lib/exec";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ssh-connections/[id]/test");

// Per-(userId, connectionId) rate limit: at most 1 connectivity probe every
// 5 seconds. SSH probes are expensive (network round-trip + crypto handshake)
// and trivially scriptable; without a guard a malicious client could hammer
// the same target until they trigger fail2ban on the remote host.
const lastTestAt = new Map<string, number>();
const RATE_LIMIT_MS = 5000;
const RATE_LIMIT_MAX_ENTRIES = 1000;

function recordTestAttempt(key: string, now: number): void {
  // Evict oldest entries if we're over the soft cap. Iteration order on Map
  // is insertion order, so deleting the first key removes the oldest entry.
  while (lastTestAt.size >= RATE_LIMIT_MAX_ENTRIES) {
    const oldest = lastTestAt.keys().next().value;
    if (oldest === undefined) break;
    lastTestAt.delete(oldest);
  }
  lastTestAt.set(key, now);
}

export const POST = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Connection id is required", 400, "ID_REQUIRED");

  const rateKey = `${userId}:${id}`;
  const now = Date.now();
  const last = lastTestAt.get(rateKey) ?? 0;
  if (now - last < RATE_LIMIT_MS) {
    return errorResponse(
      "Test rate limit exceeded; wait 5s between probes",
      429,
      "RATE_LIMITED"
    );
  }
  recordTestAttempt(rateKey, now);

  try {
    const conn = await SshConnectionService.get(id, userId);
    if (!conn) return errorResponse("Not found", 404, "NOT_FOUND");

    const baseArgs = buildSshArgs(conn);

    // Splice BatchMode + tighter ConnectTimeout in front of user@host so
    // the probe never blocks on a prompt. We replace the default
    // ConnectTimeout=10 with =5 by appending after; later -o overrides
    // earlier ones in OpenSSH.
    const probeArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      ...baseArgs,
      "true",
    ];

    let command = "ssh";
    let args = probeArgs;
    // Build a minimal env that only forwards what ssh/sshpass actually need.
    // Spreading process.env would leak server secrets (DB URLs, OAuth secrets,
    // API keys, etc.) into the ssh subprocess.
    const baseEnv = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      TERM: "xterm-256color",
    } as unknown as NodeJS.ProcessEnv;
    let env: NodeJS.ProcessEnv = baseEnv;

    if (conn.authType === "password") {
      const password = SshConnectionService.getDecryptedPassword(conn);
      if (!password) {
        return errorResponse(
          "Password is missing for this connection",
          400,
          "PASSWORD_MISSING"
        );
      }
      const sshpassOk = await SshConnectionService.isSshpassAvailable();
      if (!sshpassOk) {
        return errorResponse(
          "sshpass is not installed",
          400,
          "SSHPASS_MISSING"
        );
      }
      command = "sshpass";
      // BatchMode is incompatible with password auth — drop it for sshpass.
      args = ["-e", "ssh", "-o", "ConnectTimeout=5", ...baseArgs, "true"];
      env = { ...baseEnv, SSHPASS: password };
    }

    const result = await execFileNoThrow(command, args, { env, timeout: 15000 });

    return NextResponse.json({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    log.error("Error testing SSH connection", { error: String(error), id });
    return errorResponse("Failed to test SSH connection", 500);
  }
});
