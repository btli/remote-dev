/**
 * AgentResumeResolver — application-layer PORT for turning a stored/discovered
 * native agent session id into a launch instruction that resumes the agent's
 * conversation. The infra implementation (`AgentResumeResolverImpl`) reads the
 * declarative per-provider registry; the application layer owns only this
 * interface (Clean Architecture: domain → application → infrastructure).
 */

import type { Session } from "@/domain/entities/Session";
import type { ResumeResolution } from "@/types/agent-resume";

export interface AgentResumeResolver {
  /**
   * Resolve how to relaunch `session` so its conversation resumes.
   *
   * Returns `null` when the provider has no resume capability or no native id
   * is known (caller then relaunches fresh).
   *
   * @param session the session to resume (carries provider, projectPath,
   *   typeMetadata.agentSessionId / resumeBinding).
   * @param env optional resolved (profile-isolated) env for on-disk discovery
   *   of the newest native session id when none was captured to the DB.
   */
  resolveResume(
    session: Session,
    env?: Record<string, string>,
  ): Promise<ResumeResolution | null>;
}

/**
 * A no-op resolver that always relaunches fresh. Used as the safe default when
 * no resolver is injected (preserves legacy fresh-relaunch behavior).
 */
export class NoopAgentResumeResolver implements AgentResumeResolver {
  async resolveResume(): Promise<ResumeResolution | null> {
    return null;
  }
}
