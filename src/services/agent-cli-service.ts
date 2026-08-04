/**
 * AgentCLIService - Manages CLI verification and execution for AI coding agents
 *
 * Verifies CLI installation, retrieves versions, and provides utilities
 * for running agent CLIs with proper environment isolation.
 */

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  AGENT_PROVIDERS,
  type AgentProviderConfig,
  type AgentProviderType,
} from "@/types/session";

const execFileAsync = promisify(execFile);

/** Runnable CLI providers (the `none` sentinel has no executable). */
export type AgentCLIProvider = Exclude<AgentProviderType, "none">;

const RUNNABLE_PROVIDERS = AGENT_PROVIDERS.filter(
  (provider): provider is AgentProviderConfig & { id: AgentCLIProvider } =>
    provider.id !== "none",
);

export const AGENT_CLI_PROVIDERS: readonly AgentCLIProvider[] =
  RUNNABLE_PROVIDERS.map((provider) => provider.id);

function providerCommand(provider: AgentCLIProvider): string | null {
  return RUNNABLE_PROVIDERS.find((config) => config.id === provider)?.command ?? null;
}

/**
 * Guard provider CLIs whose executable name is too generic to identify the
 * product on its own. Provider-specific command names do not need an extra
 * fingerprint.
 */
export function matchesProviderIdentity(
  provider: AgentCLIProvider,
  output: string,
): boolean {
  if (provider !== "cursor") return true;
  return /Cursor Agent/i.test(output);
}

function outputFromExecError(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof value.stdout === "string" || Buffer.isBuffer(value.stdout)
    ? String(value.stdout)
    : "";
  const stderr = typeof value.stderr === "string" || Buffer.isBuffer(value.stderr)
    ? String(value.stderr)
    : "";
  return `${stdout}\n${stderr}`;
}

async function resolveExecutablePath(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
  cwd: string,
): Promise<string | null> {
  const candidates = command.includes("/")
    ? [isAbsolute(command) ? command : resolve(cwd, command)]
    : (env?.PATH ?? process.env.PATH ?? "")
        .split(delimiter)
        .map((entry) => resolve(cwd, entry || ".", command));

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      const canonical = await realpath(candidate);
      if ((await stat(canonical)).isFile()) return canonical;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

/**
 * Well-known executable locations for CLIs whose native installer does not
 * put the binary on the server process's PATH. Kimi's installer
 * (`curl -LsSf https://code.kimi.com/install.sh | bash`) drops the binary at
 * `$KIMI_CODE_HOME/bin/kimi` (default `~/.kimi-code/bin/kimi`) and only adds
 * that dir to PATH via shell rc files — which a launchd-spawned server never
 * sources, so a PATH-only probe reports "Not installed" on a working install.
 */
function providerFallbackExecutables(
  provider: AgentCLIProvider,
  env: NodeJS.ProcessEnv,
): string[] {
  if (provider === "kimi") {
    const kimiHome = env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
    return [join(kimiHome, "bin", process.platform === "win32" ? "kimi.exe" : "kimi")];
  }
  return [];
}

/**
 * Resolve a provider's executable: PATH first (same as the user's shell),
 * then the provider's well-known installer locations. Returns the canonical
 * absolute path, or null when the CLI is genuinely absent.
 */
async function resolveInstalledExecutable(
  provider: AgentCLIProvider,
  command: string,
  env?: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): Promise<string | null> {
  const fromPath = await resolveExecutablePath(command, env, cwd);
  if (fromPath) return fromPath;

  const mergedEnv = { ...process.env, ...env };
  for (const candidate of providerFallbackExecutables(provider, mergedEnv)) {
    try {
      await access(candidate, fsConstants.X_OK);
      const canonical = await realpath(candidate);
      if ((await stat(canonical)).isFile()) return canonical;
    } catch {
      // Try the next fallback location.
    }
  }
  return null;
}

/**
 * Resolve and fingerprint the exact executable that a launch path must retain.
 * Provider-specific command names stay unchanged; Cursor's generic `agent`
 * name resolves to an absolute canonical path so shell aliases/functions and
 * startup PATH changes cannot swap the binary after verification.
 */
export async function resolveVerifiedProviderExecutable(
  provider: AgentCLIProvider,
  command: string,
  env?: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): Promise<string | null> {
  if (provider !== "cursor") return command;

  const executablePath = await resolveExecutablePath(command, env, cwd);
  if (!executablePath) return null;

  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ["--help"], {
      env,
      cwd,
      timeout: 5000,
    });
    return matchesProviderIdentity(provider, `${stdout}\n${stderr}`)
      ? executablePath
      : null;
  } catch (error) {
    // Some CLIs print valid help and exit non-zero. Identity is determined by
    // the output, while ENOENT/timeouts (which have no identifying output)
    // still fail closed.
    return matchesProviderIdentity(provider, outputFromExecError(error))
      ? executablePath
      : null;
  }
}

export async function verifyProviderIdentity(
  provider: AgentCLIProvider,
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  return (await resolveVerifiedProviderExecutable(provider, command, env)) !== null;
}

/**
 * CLI installation status
 */
export interface CLIStatus {
  provider: AgentCLIProvider;
  installed: boolean;
  version?: string;
  command: string;
  path?: string;
  error?: string;
}

/**
 * All CLIs status
 */
export interface AllCLIStatus {
  statuses: CLIStatus[];
  installedCount: number;
  totalCount: number;
}

/**
 * Get the CLI command for a provider
 */
export function getCLICommand(provider: AgentCLIProvider | "all"): string | null {
  if (provider === "all") return null;
  return providerCommand(provider);
}

/**
 * Check if a CLI is installed and get its version
 */
export async function checkCLIStatus(
  provider: AgentCLIProvider
): Promise<CLIStatus> {
  const command = providerCommand(provider);

  if (!command) {
    return {
      provider,
      installed: false,
      command: "",
      error: "No command defined for this provider",
    };
  }

  try {
    // Resolve the executable: PATH first, then well-known installer
    // locations (e.g. Kimi's native installer drops the binary at
    // ~/.kimi-code/bin/kimi, which launchd-spawned servers don't have on
    // PATH — see providerFallbackExecutables).
    const resolvedPath = await resolveInstalledExecutable(provider, command);
    if (!resolvedPath) {
      return {
        provider,
        installed: false,
        command,
        error: `CLI '${command}' not found in PATH or well-known install locations`,
      };
    }

    const verifiedExecutable = await resolveVerifiedProviderExecutable(
      provider,
      resolvedPath,
    );

    if (!verifiedExecutable) {
      return {
        provider,
        installed: false,
        command,
        path: resolvedPath,
        error: `Executable '${command}' is not the Cursor Agent CLI`,
      };
    }

    // Try to get version
    let version: string | undefined;
    try {
      // Most CLIs support --version
      const { stdout: versionOutput } = await execFileAsync(verifiedExecutable, [
        "--version",
      ]);
      version = parseVersion(versionOutput);
    } catch {
      // Some CLIs might use -v or version subcommand
      try {
        const { stdout: versionOutput } = await execFileAsync(verifiedExecutable, ["-v"]);
        version = parseVersion(versionOutput);
      } catch {
        // Version check failed, but CLI is installed
        version = "unknown";
      }
    }

    return {
      provider,
      installed: true,
      version,
      command,
      path: verifiedExecutable,
    };
  } catch {
    return {
      provider,
      installed: false,
      command,
      error: `CLI '${command}' not found in PATH or well-known install locations`,
    };
  }
}

/**
 * Check status of all CLIs
 */
export async function checkAllCLIStatus(): Promise<AllCLIStatus> {
  const providers = AGENT_CLI_PROVIDERS;

  const statuses = await Promise.all(
    providers.map((provider) => checkCLIStatus(provider))
  );

  const installedCount = statuses.filter((s) => s.installed).length;

  return {
    statuses,
    installedCount,
    totalCount: providers.length,
  };
}

/**
 * Parse version string from CLI output
 */
function parseVersion(output: string): string {
  // Common version patterns
  const patterns = [
    /v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i, // semver: 1.2.3 or v1.2.3
    /version\s+v?(\d+\.\d+\.\d+)/i, // "version 1.2.3"
    /(\d+\.\d+\.\d+)/i, // any semver-like pattern
  ];

  const trimmed = output.trim();

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // If no pattern matches, return first line (truncated)
  const firstLine = trimmed.split("\n")[0];
  return firstLine.slice(0, 50);
}

/**
 * Get recommended installation instructions for a provider
 */
export function getInstallInstructions(
  provider: AgentCLIProvider
): string {
  const instructions: Record<AgentCLIProvider, string> = {
    claude: `# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code
# Or with bun
bun install -g @anthropic-ai/claude-code`,

    codex: `# Install OpenAI Codex CLI
npm install -g @openai/codex
# Or with bun
bun install -g @openai/codex`,

    gemini: `# Install Gemini CLI
npm install -g @google/gemini-cli
# Or with bun
bun install -g @google/gemini-cli`,

    antigravity: `# Install Antigravity CLI (command: agy)
# NOTE: the documented installer URL is currently unavailable (404); CLI install is TBD.
# Track https://antigravity.google/docs/cli-overview for an updated method.
curl -fsSL https://google.dev/antigravity/install | sh`,

    opencode: `# Install OpenCode CLI
npm install -g opencode-ai
# Or with bun
bun install -g opencode-ai`,

    cursor: `# Install Cursor CLI
curl https://cursor.com/install -fsS | bash`,

    kimi: `# Install Kimi Code CLI (native installer, recommended)
curl -LsSf https://code.kimi.com/install.sh | bash
# Or with npm
npm install -g @moonshot-ai/kimi-code`,
  };

  return instructions[provider];
}

/**
 * Get provider documentation URL
 */
export function getProviderDocsUrl(
  provider: AgentCLIProvider
): string {
  const urls: Record<AgentCLIProvider, string> = {
    claude: "https://docs.anthropic.com/claude-code",
    codex: "https://platform.openai.com/docs/codex-cli",
    gemini: "https://geminicli.com/docs/",
    antigravity: "https://antigravity.google/docs/cli-overview",
    opencode: "https://opencode.ai/docs/",
    cursor: "https://cursor.com/docs/cli/overview",
    kimi: "https://www.kimi.com/code/docs/en/",
  };

  return urls[provider];
}

/**
 * Verify that a CLI can be executed with the given environment
 */
export async function verifyCLIExecution(
  provider: AgentCLIProvider,
  env: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string }> {
  const command = providerCommand(provider);

  if (!command) {
    return {
      success: false,
      error: "No command defined for this provider",
    };
  }

  try {
    // Merge with current environment
    const fullEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;

    // Cursor needs its identity fingerprint; other providers resolve via
    // PATH plus well-known installer locations (e.g. ~/.kimi-code/bin).
    const verifiedExecutable =
      provider === "cursor"
        ? await resolveVerifiedProviderExecutable(provider, command, fullEnv)
        : await resolveInstalledExecutable(provider, command, fullEnv);
    if (!verifiedExecutable) {
      return {
        success: false,
        error:
          provider === "cursor"
            ? `Executable '${command}' is not the Cursor Agent CLI`
            : `CLI '${command}' not found in PATH or well-known install locations`,
      };
    }

    // Try a simple command that should work on all CLIs
    await execFileAsync(verifiedExecutable, ["--version"], {
      env: fullEnv as NodeJS.ProcessEnv,
      timeout: 5000,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `CLI execution failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Get required environment variables for a provider
 */
export function getRequiredEnvVars(
  provider: AgentCLIProvider
): string[] {
  const envVars: Record<AgentCLIProvider, string[]> = {
    claude: ["ANTHROPIC_API_KEY"],
    codex: ["OPENAI_API_KEY"],
    gemini: ["GOOGLE_API_KEY"],
    antigravity: ["GOOGLE_API_KEY"],
    opencode: [], // OpenCode supports multiple providers, configured in its own config
    cursor: [], // Browser login is supported; CURSOR_API_KEY is optional
    kimi: [], // OAuth (`kimi login`) or API key in config.toml; no env var required
  };

  return envVars[provider];
}

/**
 * Check if required environment variables are set
 */
export function checkRequiredEnvVars(
  provider: AgentCLIProvider,
  env: Record<string, string | undefined>
): { valid: boolean; missing: string[] } {
  const required = getRequiredEnvVars(provider);
  const missing = required.filter((key) => !env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}
