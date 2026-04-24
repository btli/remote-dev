/**
 * ResumeSessionUseCase - Resumes a suspended terminal session.
 *
 * Resuming reactivates a suspended session, making it ready for reconnection.
 *
 * Two code paths, selected by the terminal type:
 *
 *   1. **Tmux-backed types (`shell`, `agent`, `loop`)** — verify the tmux
 *      session still exists and reattach. If the tmux session is gone,
 *      throw `ResumeSessionError("TMUX_SESSION_GONE")` so the API layer can
 *      return 410 and the client can auto-close the orphaned tab.
 *
 *   2. **Non-tmux types (everything else — `settings`, `recordings`,
 *      `profiles`, `project-prefs`, `secrets`, `trash`, `port-manager`,
 *      `issues`, `prs`, `file`, `browser`, …)** — there is no PTY, so
 *      resume is a trivial state transition: flip `status` back to active
 *      and persist. Never return 410 for these — doing so causes the
 *      client to delete the singleton tab (see SessionContext.tsx
 *      `resumeSession`) and breaks the UX of clicking a Settings row
 *      after navigating away.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type { TerminalType } from "@/types/terminal-type";

export interface ResumeSessionInput {
  sessionId: string;
  userId: string;
}

/**
 * Policy predicate: does the given terminal type use a tmux-backed PTY?
 *
 * Injected so the use case stays pure — `container.ts` wires this to the
 * server plugin registry; tests can pass a deterministic stub.
 */
export type UsesTmuxPolicy = (terminalType: TerminalType) => boolean;

export class ResumeSessionUseCase {
  private readonly usesTmux: UsesTmuxPolicy;

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway,
    /**
     * Optional policy predicate. Defaults to `() => true` for back-compat —
     * so existing call sites (and any third parties that construct this use
     * case directly) keep the pre-fix behavior of always checking tmux.
     * Production wiring (`container.ts`) injects the real registry lookup.
     */
    usesTmux?: UsesTmuxPolicy
  ) {
    this.usesTmux = usesTmux ?? (() => true);
  }

  async execute(input: ResumeSessionInput): Promise<Session> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    const isTmuxBacked = this.usesTmux(session.terminalType);

    // Non-tmux sessions (settings/recordings/profiles/prefs/secrets/…) have
    // no PTY to reattach — resume is a pure state transition. Skip the
    // tmuxGateway.sessionExists() probe so we never falsely return 410 for
    // sessions that never had a tmux session to begin with.
    if (!isTmuxBacked) {
      const resumedSession = session.resume();
      return this.sessionRepository.save(resumedSession);
    }

    // Tmux-backed: verify the tmux session still exists before we claim
    // success. If it's gone, fail with TMUX_SESSION_GONE so the API
    // returns 410 and the client knows it's safe to auto-close the tab.
    const tmuxExists = await this.tmuxGateway.sessionExists(
      session.tmuxSessionName.toString()
    );

    if (!tmuxExists) {
      throw new ResumeSessionError(
        "Tmux session no longer exists",
        "TMUX_SESSION_GONE"
      );
    }

    // Transition to active state (validates current state)
    const resumedSession = session.resume();

    // Persist state change
    return this.sessionRepository.save(resumedSession);
  }
}

export class ResumeSessionError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "ResumeSessionError";
  }
}
