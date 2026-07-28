/**
 * SessionLauncherPort - Thin port for launching a replacement session.
 *
 * Used by `RelaunchOnLimitUseCase` in `auto` mode: when a running session's
 * Claude account taps out, spawn a NEW parallel session under an available
 * account and LEAVE THE OLD SESSION RUNNING (never force-kill). Keeping this
 * behind a port keeps the use-case unit-testable without the session-service.
 *
 * The Wave C adapter maps `launch` onto `session-service.createSession*`
 * (same path `POST /api/sessions` uses), deriving name/working-dir from the
 * originating session + project.
 */

export interface LaunchReplacementInput {
  userId: string;
  /** The project the replacement session belongs to. */
  projectId: string;
  /** The available Claude account to launch under (selection policy's choice). */
  accountId: string;
  /** The account's origin profile, when it has one (config dir / env overlay). */
  profileId: string | null;
  /** Agent provider for the new session (mirrors the limited session). */
  agentProvider: string;
  /** The session that tapped out, for naming/context (never killed). */
  originatingSessionId: string;
}

export interface LaunchReplacementResult {
  /** Id of the newly launched session. */
  sessionId: string;
}

export interface SessionLauncherPort {
  /**
   * Launch a new session under `accountId`. Best-effort; implementations
   * should surface failures by throwing so the use-case can log + fall back to
   * a notification.
   */
  launch(input: LaunchReplacementInput): Promise<LaunchReplacementResult>;
}
