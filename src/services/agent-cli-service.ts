/**
 * AgentCLIService - Manages CLI verification and execution for AI coding agents
 *
 * Verifies CLI installation, retrieves versions, and provides utilities
 * for running agent CLIs with proper environment isolation.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentProvider } from "@/types/agent";
import { PROVIDER_CLI_COMMANDS } from "@/types/agent";

const execFileAsync = promisify(execFile);

/**
 * CLI installation status
 */
export interface CLIStatus {
  provider: AgentProvider;
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
export function getCLICommand(provider: AgentProvider): string | null {
  if (provider === "all") return null;
  return PROVIDER_CLI_COMMANDS[provider] || null;
}

/**
 * Check if a CLI is installed and get its version
 */
export async function checkCLIStatus(
  provider: Exclude<AgentProvider, "all">
): Promise<CLIStatus> {
  const command = PROVIDER_CLI_COMMANDS[provider];

  if (!command) {
    return {
      provider,
      installed: false,
      command: "",
      error: "No command defined for this provider",
    };
  }

  try {
    // Try to get the path using 'which'
    const { stdout: path } = await execFileAsync("which", [command]);
    const trimmedPath = path.trim();

    // Try to get version
    let version: string | undefined;
    try {
      // Most CLIs support --version
      const { stdout: versionOutput } = await execFileAsync(command, [
        "--version",
      ]);
      version = parseVersion(versionOutput);
    } catch {
      // Some CLIs might use -v or version subcommand
      try {
        const { stdout: versionOutput } = await execFileAsync(command, ["-v"]);
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
      path: trimmedPath,
    };
  } catch {
    return {
      provider,
      installed: false,
      command,
      error: `CLI '${command}' not found in PATH`,
    };
  }
}

/**
 * Check status of all CLIs
 */
export async function checkAllCLIStatus(): Promise<AllCLIStatus> {
  const providers: Exclude<AgentProvider, "all">[] = [
    "claude",
    "codex",
    "gemini",
    "opencode",
  ];

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
  provider: Exclude<AgentProvider, "all">
): string {
  const instructions: Record<Exclude<AgentProvider, "all">, string> = {
    claude: `# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code
# Or with bun
bun install -g @anthropic-ai/claude-code`,

    codex: `# Install OpenAI Codex CLI
npm install -g @openai/codex-cli
# Or with bun
bun install -g @openai/codex-cli`,

    gemini: `# Install Gemini CLI
npm install -g @google/gemini-cli
# Or with bun
bun install -g @google/gemini-cli`,

    opencode: `# Install OpenCode CLI
npm install -g opencode
# Or with bun
bun install -g opencode`,
  };

  return instructions[provider];
}

/**
 * Get provider documentation URL
 */
export function getProviderDocsUrl(
  provider: Exclude<AgentProvider, "all">
): string {
  const urls: Record<Exclude<AgentProvider, "all">, string> = {
    claude: "https://docs.anthropic.com/claude-code",
    codex: "https://platform.openai.com/docs/codex-cli",
    gemini: "https://geminicli.com/docs/",
    opencode: "https://opencode.ai/docs/",
  };

  return urls[provider];
}

/**
 * Verify that a CLI can be executed with the given environment
 */
export async function verifyCLIExecution(
  provider: Exclude<AgentProvider, "all">,
  env: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string }> {
  const command = PROVIDER_CLI_COMMANDS[provider];

  if (!command) {
    return {
      success: false,
      error: "No command defined for this provider",
    };
  }

  try {
    // Merge with current environment
    const fullEnv = { ...process.env, ...env };

    // Try a simple command that should work on all CLIs
    await execFileAsync(command, ["--version"], {
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
  provider: Exclude<AgentProvider, "all">
): string[] {
  const envVars: Record<Exclude<AgentProvider, "all">, string[]> = {
    claude: ["ANTHROPIC_API_KEY"],
    codex: ["OPENAI_API_KEY"],
    gemini: ["GOOGLE_API_KEY"],
    opencode: [], // OpenCode supports multiple providers, configured in its own config
  };

  return envVars[provider];
}

/**
 * Check if required environment variables are set
 */
export function checkRequiredEnvVars(
  provider: Exclude<AgentProvider, "all">,
  env: Record<string, string | undefined>
): { valid: boolean; missing: string[] } {
  const required = getRequiredEnvVars(provider);
  const missing = required.filter((key) => !env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}
