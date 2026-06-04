/**
 * Startup diagnostics for non-Claude resume flags.
 *
 * Non-Claude resume tokens (codex `resume` subcommand, gemini `--resume`,
 * opencode `--session`) come from plan research, not from CLI verification, so
 * they can drift when a provider renames or removes the flag. `verifyResumeFlag`
 * probes the installed CLI's `--help` for the registry token and warns on drift,
 * but it lives off the hot path and was wired to nothing — this routine is the
 * single place that runs it at boot.
 *
 * It only probes providers that are BOTH installed on this host (per
 * `checkAllCLIStatus`) AND resume-capable in the registry. Probing an
 * uninstalled provider would just emit noise (the CLI isn't there to drift), and
 * Claude is the reference spelling we trust — but we still verify it so a Claude
 * CLI that ever renames `--resume` is caught too. Drift surfaces as
 * `verifyResumeFlag`'s own `log.warn`; this routine adds an `info` line per
 * provider whose token is confirmed.
 *
 * Resilience: this is best-effort observability. It never throws and is invoked
 * fire-and-forget after the terminal server is up, so a flaky `--help` probe can
 * never block or crash boot.
 */

import type { AgentProvider } from "@/types/agent";
import type { AgentProviderType } from "@/types/session";
import { checkAllCLIStatus, type AllCLIStatus } from "@/services/agent-cli-service";
import {
  AGENT_RESUME_REGISTRY,
  getResumeSpec,
  verifyResumeFlag,
} from "@/lib/agent-resume/agent-resume-registry";
import { createLogger } from "@/lib/logger";

const log = createLogger("ResumeFlagDiagnostics");

/**
 * The concrete agent providers shared by both `AgentProvider` (CLI-status, has
 * the UI-only `"all"`) and `AgentProviderType` (registry, has `"none"`):
 * claude/codex/gemini/antigravity/opencode. Assignable to `AgentProviderType`,
 * so a value of this type is a valid registry key + `verifyResumeFlag` arg.
 */
type ConcreteAgentProvider = Exclude<AgentProvider, "all">;

/**
 * Narrow the CLI-status provider union to the concrete providers.
 * `checkAllCLIStatus` only ever emits these five, but its element type is the
 * wider `AgentProvider`; gating on registry membership drops `"all"` safely
 * without a cast.
 */
function isResumeProvider(p: AgentProvider): p is ConcreteAgentProvider {
  return p !== "all" && p in AGENT_RESUME_REGISTRY;
}

/**
 * Seams for testing — both default to the real implementations so the
 * production call site is a bare `void runResumeFlagDiagnostics()`.
 */
export interface ResumeFlagDiagnosticsDeps {
  /** Reports which agent CLIs are installed on this host. */
  detectInstalled: () => Promise<AllCLIStatus>;
  /** Probes a provider's CLI `--help` for its registry resume token. */
  verify: (provider: AgentProviderType) => Promise<boolean>;
}

const defaultDeps: ResumeFlagDiagnosticsDeps = {
  detectInstalled: checkAllCLIStatus,
  verify: verifyResumeFlag,
};

/**
 * Verify that every installed, resume-capable agent CLI still advertises its
 * registry resume token. Logs an `info` per confirmed provider; drift is warned
 * by `verifyResumeFlag` itself (no double-logging here). Never throws.
 */
export async function runResumeFlagDiagnostics(
  deps: ResumeFlagDiagnosticsDeps = defaultDeps,
): Promise<void> {
  try {
    const { statuses } = await deps.detectInstalled();

    // Installed CLIs whose registry spec actually has a resume token to drift.
    // `none`/antigravity (no token) and uninstalled providers are skipped so we
    // never warn about a CLI that isn't on the host. The `isResumeProvider`
    // guard narrows the array element from `AgentProvider` to the registry's
    // `AgentProviderType` (drops the UI-only `"all"`).
    const probeable = statuses
      .filter((s) => s.installed)
      .map((s) => s.provider)
      .filter(isResumeProvider)
      .filter((provider) => {
        const spec = getResumeSpec(provider);
        return spec.supportsResume && Boolean(spec.resume.token);
      });

    if (probeable.length === 0) {
      log.info("No installed resume-capable agent CLIs to verify");
      return;
    }

    log.info("Verifying resume flags for installed agent CLIs", {
      providers: probeable,
    });

    for (const provider of probeable) {
      try {
        const ok = await deps.verify(provider);
        if (ok) {
          // verifyResumeFlag already warns on drift; only log the good path here.
          log.info("Resume token advertised by CLI --help", {
            provider,
            token: getResumeSpec(provider).resume.token,
          });
        }
      } catch (error) {
        // A single provider's probe failing must not abort the rest.
        log.warn("Resume flag verification threw; skipping provider", {
          provider,
          error: String(error),
        });
      }
    }
  } catch (error) {
    // Best-effort diagnostics — swallow everything so boot is never blocked.
    log.warn("Resume flag diagnostics failed", { error: String(error) });
  }
}
