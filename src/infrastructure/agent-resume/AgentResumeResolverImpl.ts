/**
 * AgentResumeResolverImpl — infra implementation of the AgentResumeResolver
 * port. Turns a session's provider + native id (stored in typeMetadata, or
 * discovered on disk) into a resume launch instruction using the declarative
 * resume registry. No inline provider `switch` — the registry is the single
 * source of truth.
 */

import type { AgentResumeResolver } from "@/application/ports/AgentResumeResolver";
import type { Session } from "@/domain/entities/Session";
import type { ResumeResolution, AgentSessionIdMap } from "@/types/agent-resume";
import type { AgentProviderType } from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";
import { getResumeSpec } from "@/lib/agent-resume/agent-resume-registry";
import { discoverLatestSessionId } from "@/lib/agent-resume/session-id-discovery";
import { createLogger } from "@/lib/logger";

const log = createLogger("AgentResume");

/** Resolve a provider's launch command from the single AGENT_PROVIDERS source. */
function providerCommand(p: AgentProviderType): string {
  return AGENT_PROVIDERS.find((x) => x.id === p)?.command ?? p;
}

export class AgentResumeResolverImpl implements AgentResumeResolver {
  async resolveResume(
    session: Session,
    env: Record<string, string> = {},
  ): Promise<ResumeResolution | null> {
    const provider = (session.agentProvider ?? "none") as AgentProviderType;
    const spec = getResumeSpec(provider);
    if (!spec.supportsResume) {
      log.debug("Provider has no resume capability; will relaunch fresh", { provider });
      return null;
    }

    // 1) Prefer the durably stored native id (hgwo.1 capture).
    const stored = (session.typeMetadata?.agentSessionId as AgentSessionIdMap | undefined)?.[
      provider
    ];
    // 2) Fall back to the newest on-disk session for this cwd.
    const cwd = session.projectPath ?? env.HOME ?? "";
    const nativeSessionId =
      stored ?? (cwd ? await discoverLatestSessionId(provider, cwd, env) : null);

    if (!nativeSessionId) {
      log.info("No resumable session id found; will relaunch fresh", {
        provider,
        sessionId: session.id,
      });
      return null;
    }

    if (spec.resume.kind === "subcommand") {
      // e.g. `codex resume <id>` → full argv override
      const command = providerCommand(provider);
      return {
        provider,
        nativeSessionId,
        resumeFlags: [],
        argvOverride: [command, spec.resume.token!, nativeSessionId],
      };
    }

    // flag kind: ["--resume", "<id>"] fed to buildAgentCommand
    return {
      provider,
      nativeSessionId,
      resumeFlags: [spec.resume.token!, nativeSessionId],
      argvOverride: null,
    };
  }
}
