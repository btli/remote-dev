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

const execFileAsync = promisify(execFile);
const log = createLogger("AgentRelaunch");

/**
 * Per-session guard: a pod restart can fan out the cold-attach relaunch across
 * several reconnecting clients at once. Only the first wins; the rest no-op
 * until it clears, so the agent is launched exactly once.
 */
const inFlight = new Set<string>();

export interface RelaunchResult {
  resumed: boolean;
}

/** Relaunch the agent CLI (resumed if possible) inside an existing tmux session. */
export async function relaunchAgentInTmux(
  sessionId: string,
  tmuxName: string,
): Promise<RelaunchResult> {
  if (inFlight.has(sessionId)) {
    log.debug("Relaunch already in flight; skipping duplicate", { sessionId });
    return { resumed: false };
  }
  inFlight.add(sessionId);
  try {
    const [{ db }, { terminalSessions }, { eq }, { SessionMapper }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
      import("@/infrastructure/persistence/mappers/SessionMapper"),
    ]);

    const row = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
    });
    if (!row || row.terminalType !== "agent") {
      log.debug("No agent session row to relaunch", { sessionId });
      return { resumed: false };
    }

    const session = SessionMapper.toDomain(row as Parameters<typeof SessionMapper.toDomain>[0]);

    const [{ AgentResumeResolverImpl }, { AGENT_PROVIDERS }, { buildAgentCommand }] =
      await Promise.all([
        import("@/infrastructure/agent-resume/AgentResumeResolverImpl"),
        import("@/types/session"),
        import("@/lib/terminal-plugins/agent-utils"),
      ]);

    // Durable binding's sanitized env locates the profile-isolated resume files.
    const binding = session.typeMetadata?.resumeBinding as
      | { env?: Record<string, string> }
      | undefined;
    const env = binding?.env ?? {};

    const resolver = new AgentResumeResolverImpl();
    const resolution = await resolver.resolveResume(session, env);

    const provider =
      AGENT_PROVIDERS.find((p) => p.id === (session.agentProvider ?? "claude")) ??
      AGENT_PROVIDERS.find((p) => p.id === "claude")!;
    const cmd = resolution?.argvOverride
      ? resolution.argvOverride.join(" ")
      : buildAgentCommand(provider, resolution?.resumeFlags ?? [], false);

    // Re-inject the sanitized env into the tmux session BEFORE launching so the
    // agent process inherits it (crux for pod restart — the original initialEnv
    // and in-memory id map are gone). Secrets were stripped at bind time; the
    // agent re-resolves API keys from its own profile credential store.
    for (const [k, v] of Object.entries(env)) {
      try {
        await execFileAsync("tmux", ["set-environment", "-t", tmuxName, k, v], { cwd: STABLE_SPAWN_CWD });
      } catch (error) {
        log.warn("Failed to set tmux env on relaunch", { sessionId, key: k, error: String(error) });
      }
    }

    // Send the command literally (-l), then a separate Enter (C-m) to submit.
    // Mirrors TmuxService.sendKeys: literal text avoids tmux interpreting
    // special chars, and C-m is the canonical carriage-return keypress.
    await execFileAsync("tmux", ["send-keys", "-t", tmuxName, "-l", cmd], { cwd: STABLE_SPAWN_CWD });
    await execFileAsync("tmux", ["send-keys", "-t", tmuxName, "C-m"], { cwd: STABLE_SPAWN_CWD });

    log.info("Relaunched agent in tmux", {
      sessionId,
      provider: provider.id,
      resumed: Boolean(resolution),
    });
    return { resumed: Boolean(resolution) };
  } catch (error) {
    log.error("Agent relaunch failed", { sessionId, error: String(error) });
    return { resumed: false };
  } finally {
    inFlight.delete(sessionId);
  }
}
