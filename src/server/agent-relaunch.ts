/**
 * [hgwo] Relaunch an agent CLI (resumed if possible) inside an existing tmux
 * session. Single entry point called from every server-side recreate site
 * (WS `restart_agent` after kill+recreate, and the cold-attach branch when a
 * terminal-server / pod restart found the tmux session gone).
 *
 * It bridges the terminal server (which has no DI container) to the
 * AgentResumeResolver: load the DB row → map to a Session entity → resolve the
 * resume launch instruction → re-inject the durable binding's sanitized env
 * (so the profile-isolated CLI home dir that holds the resume files is present
 * after a pod restart) → `tmux send-keys` the command, submitting with `C-m`
 * (carriage return — the Claude TUI requires \r, not \n).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STABLE_SPAWN_CWD } from "@/lib/exec";
import { createLogger } from "@/lib/logger";
import { validatePath } from "@/server/validate-cwd";
import { buildAgentExitHookCommand } from "@/services/agent-exit-hook";
import { stopTmuxSessionAndConfirmAbsent } from "@/server/tmux-containment";

const execFileAsync = promisify(execFile);
const log = createLogger("AgentRelaunch");

/**
 * Per-session guard: a pod restart can fan out the cold-attach relaunch across
 * several reconnecting clients at once. Only the first wins; the rest no-op
 * until it clears, so the agent is launched exactly once.
 */
const inFlight = new Set<string>();

async function resolveAgentPaneId(tmuxName: string): Promise<string> {
  const { stdout } = await execFileAsync("tmux", [
    "list-panes",
    "-s",
    "-t",
    tmuxName,
    "-F",
    "#{pane_id}\t#{@rdv_agent_pane}",
  ], { cwd: STABLE_SPAWN_CWD });
  const panes = stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [paneId, marker] = line.split("\t");
      return { paneId: paneId.trim(), marked: marker?.trim() === "1" };
    })
    .filter(({ paneId }) => /^%\d+$/.test(paneId));
  const marked = panes.filter((pane) => pane.marked);
  const selected = marked.length === 1 ? marked[0] : panes.length === 1 ? panes[0] : null;
  if (!selected) throw new Error(`unable to resolve one agent pane in ${tmuxName}`);
  return selected.paneId;
}

export interface RelaunchResult {
  resumed: boolean;
}

/** Relaunch the agent CLI (resumed if possible) inside an existing tmux session. */
export async function relaunchAgentInTmux(
  sessionId: string,
  tmuxName: string,
  recreatedCwdOrGeneration?: string | number,
  explicitClaimedGeneration?: number,
): Promise<RelaunchResult> {
  const recreatedCwd = typeof recreatedCwdOrGeneration === "string"
    ? recreatedCwdOrGeneration
    : undefined;
  const claimedGeneration = typeof recreatedCwdOrGeneration === "number"
    ? recreatedCwdOrGeneration
    : explicitClaimedGeneration;
  if (inFlight.has(sessionId)) {
    log.debug("Relaunch already in flight; skipping duplicate", { sessionId });
    return { resumed: false };
  }
  inFlight.add(sessionId);
  let lifecycleClaim: { userId: string; generation: number } | null = null;
  try {
    const [{ db }, { terminalSessions, apiKeys }, { eq, and }, { SessionMapper }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
      import("@/infrastructure/persistence/mappers/SessionMapper"),
    ]);

    const row = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
    });
    if (
      !row ||
      (row.terminalType !== "agent" && row.terminalType !== "loop")
    ) {
      log.debug("No agent session row to relaunch", { sessionId });
      return { resumed: false };
    }

    let generation: number;
    if (claimedGeneration !== undefined) {
      const currentGeneration = row.agentRestartCount ?? 0;
      if (
        row.agentExitState !== "restarting" ||
        currentGeneration !== claimedGeneration
      ) {
        throw new Error(
          `restart generation ${claimedGeneration} is no longer the active claim`,
        );
      }
      generation = claimedGeneration;
    } else {
      // A restarting row is owned by the process that won the DB claim. Never
      // infer ownership by reading it: another terminal process could otherwise
      // rotate that owner's key and respawn its pane under the same generation.
      if (row.agentExitState === "restarting") {
        throw new Error("agent restart generation is already claimed");
      }
      const { markAgentRestarting } = await import("@/services/session-service");
      const claimed = await markAgentRestarting(sessionId, row.userId);
      if (!claimed) {
        throw new Error("another restart or lifecycle transition already claimed the agent");
      }
      generation = claimed.agentRestartCount ?? (row.agentRestartCount ?? 0) + 1;
    }
    lifecycleClaim = { userId: row.userId, generation };

    const session = SessionMapper.toDomain(row as Parameters<typeof SessionMapper.toDomain>[0]);

    const [
      { AgentResumeResolverImpl },
      { AGENT_PROVIDERS },
      { buildAgentCommand },
      { resolveVerifiedProviderExecutable },
      { stripSensitiveEnv },
    ] =
      await Promise.all([
        import("@/infrastructure/agent-resume/AgentResumeResolverImpl"),
        import("@/types/session"),
        import("@/lib/terminal-plugins/agent-utils"),
        import("@/services/agent-cli-service"),
        import("@/lib/agent-resume/resume-binding"),
      ]);

    // Durable binding locates resume files and, for Cursor, retains the exact
    // executable that passed product-identity verification at create time.
    const binding = session.typeMetadata?.resumeBinding as
      | { env?: Record<string, string>; executablePath?: string }
      | undefined;
    const env = binding?.env ?? {};

    const launchEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    const discoveryEnv = Object.fromEntries(
      Object.entries(launchEnv).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );

    // A recreated tmux server has lost the one-time key from its environment.
    // Revoke the prior generation's named key and mint a fresh exact-session
    // callback credential before installing hooks or launching the process.
    const keyName = `agent-session-${sessionId}`;
    await db.delete(apiKeys).where(
      and(eq(apiKeys.userId, row.userId), eq(apiKeys.name, keyName)),
    );
    const { createApiKey } = await import("@/services/api-key-service");
    const { key: agentApiKey } = await createApiKey(row.userId, keyName);

    const terminalSocket = process.env.TERMINAL_SOCKET;
    const rdvEnv: Record<string, string> = {
      RDV_SESSION_ID: sessionId,
      RDV_USER_ID: row.userId,
      RDV_AGENT_PROVIDER: session.agentProvider ?? "claude",
      RDV_AGENT_GENERATION: String(generation),
      RDV_API_KEY: agentApiKey,
      DISABLE_AUTO_UPDATE: "true",
      DISABLE_UPDATE_PROMPT: "true",
      ...(terminalSocket
        ? { RDV_TERMINAL_SOCKET: terminalSocket }
        : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "6002" }),
      ...(process.env.SOCKET_PATH
        ? { RDV_API_SOCKET: process.env.SOCKET_PATH }
        : { RDV_API_PORT: process.env.PORT ?? "6001" }),
      ...(row.profileId ? { RDV_PROFILE_ID: row.profileId } : {}),
    };
    const resolver = new AgentResumeResolverImpl();
    const resolution = await resolver.resolveResume(session, discoveryEnv);

    const provider =
      AGENT_PROVIDERS.find((p) => p.id === (session.agentProvider ?? "claude")) ??
      AGENT_PROVIDERS.find((p) => p.id === "claude")!;
    if (provider.id === "none") {
      throw new Error("Agent session has no runnable provider");
    }
    const verificationCommand =
      provider.id === "cursor" && binding?.executablePath
        ? binding.executablePath
        : provider.command;
    const verificationCwd =
      validatePath(recreatedCwd) ??
      validatePath(session.projectPath ?? undefined) ??
      STABLE_SPAWN_CWD;
    const executable = await resolveVerifiedProviderExecutable(
      provider.id,
      verificationCommand,
      launchEnv,
      verificationCwd,
    );
    if (!executable) {
      throw new Error(`Executable '${provider.command}' is not the Cursor Agent CLI`);
    }
    const cmd = resolution?.argvOverride
      ? resolution.argvOverride.join(" ")
      : buildAgentCommand(
          provider,
          resolution?.resumeFlags ?? [],
          false,
          provider.id === "cursor" ? executable : undefined,
        );

    // Re-inject the sanitized env into the tmux session BEFORE launching so the
    // agent process inherits it (crux for pod restart — the original initialEnv
    // and in-memory id map are gone). Secrets were stripped at bind time; the
    // agent re-resolves API keys from its own profile credential store.
    const relaunchEnv = { ...env };
    if (
      provider.id === "cursor" &&
      discoveryEnv.CURSOR_DATA_DIR &&
      !relaunchEnv.CURSOR_DATA_DIR
    ) {
      relaunchEnv.CURSOR_DATA_DIR = discoveryEnv.CURSOR_DATA_DIR;
    }
    const safeRelaunchEnv = stripSensitiveEnv(relaunchEnv);
    const injectedEnv = { ...safeRelaunchEnv, ...rdvEnv };
    for (const [k, v] of Object.entries(injectedEnv)) {
      // Environment injection is part of the lifecycle boundary. Continuing
      // after a partial write can launch an unauthenticated or wrong-generation
      // process, so fail the claim and surface the error instead.
      await execFileAsync("tmux", ["set-environment", "-t", tmuxName, k, v], {
        cwd: STABLE_SPAWN_CWD,
      });
    }

    const { prepareAgentLaunch } = await import("@/services/agent-launch-preparation");
    await prepareAgentLaunch(injectedEnv);

    // set-environment updates the tmux session, not the already-running
    // bootstrap shell. Respawn it now so the process that receives `exec`
    // inherits the exact generation, callback key, provider, and config home.
    const paneId = await resolveAgentPaneId(tmuxName);
    await execFileAsync("tmux", ["respawn-pane", "-k", "-t", paneId], {
      cwd: STABLE_SPAWN_CWD,
    });

    await execFileAsync("tmux", [
      "set-option",
      "-p",
      "-t",
      paneId,
      "@rdv_agent_pane",
      "1",
    ], { cwd: STABLE_SPAWN_CWD });
    await execFileAsync("tmux", [
      "set-option",
      "-p",
      "-t",
      paneId,
      "remain-on-exit",
      "on",
    ], { cwd: STABLE_SPAWN_CWD });
    await execFileAsync("tmux", [
      "set-hook",
      "-p",
      "-t",
      paneId,
      "pane-died",
      buildAgentExitHookCommand({
        sessionId,
        tmuxSessionName: tmuxName,
        generation,
        terminalSocket,
        terminalPort: rdvEnv.RDV_TERMINAL_PORT,
      }),
    ], { cwd: STABLE_SPAWN_CWD });

    // Send the command literally (-l), then a separate Enter (C-m) to submit.
    // Mirrors TmuxService.sendKeys: literal text avoids tmux interpreting
    // special chars, and C-m is the canonical carriage-return keypress.
    await execFileAsync("tmux", ["send-keys", "-t", paneId, "-l", `exec ${cmd}`], { cwd: STABLE_SPAWN_CWD });
    await execFileAsync("tmux", ["send-keys", "-t", paneId, "C-m"], { cwd: STABLE_SPAWN_CWD });

    // Complete only this generation's restart. If the replacement exited
    // immediately, its callback already changed the row to exited and this CAS
    // intentionally matches zero rather than resurrecting it as running.
    const { markAgentRunning } = await import("@/services/session-service");
    const running = await markAgentRunning(sessionId, row.userId, generation);
    if (!running) {
      throw new Error(`restart generation ${generation} could not be completed`);
    }

    log.info("Relaunched agent in tmux", {
      sessionId,
      provider: provider.id,
      resumed: Boolean(resolution),
    });
    return { resumed: Boolean(resolution) };
  } catch (error) {
    log.error("Agent relaunch failed", { sessionId, error: String(error) });
    if (lifecycleClaim) {
      const processStopped = await stopTmuxSessionAndConfirmAbsent(tmuxName);
      if (processStopped) {
        try {
          const { markAgentExited } = await import("@/services/session-service");
          await markAgentExited(
            sessionId,
            lifecycleClaim.userId,
            1,
            lifecycleClaim.generation,
          );
        } catch (stateError) {
          log.error("Failed to mark relaunch failure", {
            sessionId,
            generation: lifecycleClaim.generation,
            error: String(stateError),
          });
        }
      } else {
        log.error("Retaining restart claim after uncertain relaunch containment", {
          sessionId,
          generation: lifecycleClaim.generation,
        });
      }
    }
    throw error;
  } finally {
    inFlight.delete(sessionId);
  }
}
