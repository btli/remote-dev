/**
 * Agent Hooks Service
 *
 * Generates and manages hook configurations for different AI coding agents.
 * Each agent reports events to its folder orchestrator, which can escalate
 * to Master Control when needed.
 *
 * Hierarchy: Agent Hooks → Folder Orchestrator → Master Control
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";

const execFileAsync = promisify(execFile);

export type AgentProvider = "claude" | "codex" | "gemini" | "opencode";

interface HookConfig {
  provider: AgentProvider;
  configPath: string;
  hookScript?: string;
  pluginCode?: string;
}

/**
 * Get the base URL for the orchestrator API
 * In development, this is localhost. In production, could be configurable.
 */
function getOrchestratorBaseUrl(): string {
  return process.env.ORCHESTRATOR_URL || "http://localhost:3000";
}

/**
 * Generate Claude Code hook configuration
 *
 * Claude Code uses JSON hooks in ~/.claude/settings.json
 * Events: Stop, SessionEnd, PostToolUse
 */
export function generateClaudeCodeHooks(
  sessionId: string,
  folderId: string
): object {
  const baseUrl = getOrchestratorBaseUrl();

  return {
    hooks: {
      // Report when agent completes a response (task_complete)
      Stop: [
        {
          type: "command",
          command: [
            "curl",
            "-s",
            "-X", "POST",
            `${baseUrl}/api/orchestrators/agent-event`,
            "-H", "Content-Type: application/json",
            "-d", JSON.stringify({
              event: "task_complete",
              agent: "claude",
              sessionId,
              folderId,
            }),
          ],
        },
      ],
      // Report when session ends
      SessionEnd: [
        {
          type: "command",
          command: [
            "curl",
            "-s",
            "-X", "POST",
            `${baseUrl}/api/orchestrators/agent-event`,
            "-H", "Content-Type: application/json",
            "-d", JSON.stringify({
              event: "session_end",
              agent: "claude",
              sessionId,
              folderId,
            }),
          ],
        },
      ],
      // Heartbeat on tool use
      PostToolUse: [
        {
          type: "command",
          command: [
            "curl",
            "-s",
            "-X", "POST",
            `${baseUrl}/api/orchestrators/agent-event`,
            "-H", "Content-Type: application/json",
            "-d", JSON.stringify({
              event: "heartbeat",
              agent: "claude",
              sessionId,
              folderId,
            }),
          ],
        },
      ],
    },
  };
}

/**
 * Generate Gemini CLI hook configuration
 *
 * Gemini uses JSON hooks in ~/.gemini/settings.json (similar to Claude)
 * Events: SessionEnd, AfterAgent
 */
export function generateGeminiHooks(
  sessionId: string,
  folderId: string
): object {
  const baseUrl = getOrchestratorBaseUrl();

  return {
    hooks: {
      // Report when agent completes
      AfterAgent: [
        {
          type: "command",
          command: `curl -s -X POST ${baseUrl}/api/orchestrators/agent-event -H 'Content-Type: application/json' -d '${JSON.stringify({
            event: "task_complete",
            agent: "gemini",
            sessionId,
            folderId,
          })}'`,
        },
      ],
      // Report when session ends
      SessionEnd: [
        {
          type: "command",
          command: `curl -s -X POST ${baseUrl}/api/orchestrators/agent-event -H 'Content-Type: application/json' -d '${JSON.stringify({
            event: "session_end",
            agent: "gemini",
            sessionId,
            folderId,
          })}'`,
        },
      ],
    },
  };
}

/**
 * Generate Codex notify script
 *
 * Codex uses a notify script configured in ~/.codex/config.toml
 * The script receives JSON as an argument
 */
export function generateCodexNotifyScript(
  sessionId: string,
  folderId: string
): string {
  const baseUrl = getOrchestratorBaseUrl();

  return `#!/usr/bin/env python3
"""
Codex notification script for Remote Dev orchestrator.
Receives events from Codex CLI and forwards to folder orchestrator.
"""
import json
import sys
import urllib.request

def main():
    if len(sys.argv) < 2:
        return

    try:
        payload = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        return

    event_type = payload.get('type', '')

    # Map Codex events to orchestrator events
    event_map = {
        'agent-turn-complete': 'task_complete',
    }

    orchestrator_event = event_map.get(event_type)
    if not orchestrator_event:
        return

    notification = {
        'event': orchestrator_event,
        'agent': 'codex',
        'sessionId': '${sessionId}',
        'folderId': '${folderId}',
        'context': {
            'lastMessage': payload.get('last-assistant-message', '')[:500]
        }
    }

    try:
        req = urllib.request.Request(
            '${baseUrl}/api/orchestrators/agent-event',
            data=json.dumps(notification).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Don't block Codex on notification failure

if __name__ == '__main__':
    main()
`;
}

/**
 * Generate Codex config.toml snippet
 */
export function generateCodexConfig(notifyScriptPath: string): string {
  return `# Orchestrator notification hook
notify = ["python3", "${notifyScriptPath}"]
`;
}

/**
 * Generate OpenCode plugin
 *
 * OpenCode uses TypeScript plugins in .opencode/plugin/
 */
export function generateOpenCodePlugin(
  sessionId: string,
  folderId: string
): string {
  const baseUrl = getOrchestratorBaseUrl();

  return `/**
 * OpenCode orchestrator notification plugin.
 * Reports session events to Remote Dev folder orchestrator.
 */
export const OrchestratorNotifier = async (context) => {
  return {
    event: async ({ event }) => {
      // Map OpenCode events to orchestrator events
      const eventMap = {
        'session.idle': 'task_complete',
        'session.created': 'session_start',
        'session.deleted': 'session_end',
      };

      const orchestratorEvent = eventMap[event.type];
      if (!orchestratorEvent) return;

      const notification = {
        event: orchestratorEvent,
        agent: 'opencode',
        sessionId: '${sessionId}',
        folderId: '${folderId}',
        timestamp: new Date().toISOString(),
        context: {
          filesModified: event.properties?.filesModified || 0,
        },
      };

      try {
        await fetch('${baseUrl}/api/orchestrators/agent-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notification),
        });
      } catch (e) {
        // Don't block OpenCode on notification failure
      }
    },
  };
};
`;
}

/**
 * Install hooks for a specific agent in a project directory
 */
export async function installAgentHooks(
  provider: AgentProvider,
  projectPath: string,
  sessionId: string,
  folderId: string
): Promise<{ success: boolean; message: string; configPath?: string }> {
  try {
    switch (provider) {
      case "claude": {
        // Install project-level hooks in .claude/settings.local.json
        const claudeDir = join(projectPath, ".claude");
        const configPath = join(claudeDir, "settings.local.json");

        await mkdir(claudeDir, { recursive: true });

        const hooks = generateClaudeCodeHooks(sessionId, folderId);

        // Merge with existing config if present
        let existingConfig = {};
        if (existsSync(configPath)) {
          try {
            const content = await readFile(configPath, "utf-8");
            existingConfig = JSON.parse(content);
          } catch {
            // Ignore parse errors
          }
        }

        const mergedConfig = {
          ...existingConfig,
          ...hooks,
        };

        await writeFile(configPath, JSON.stringify(mergedConfig, null, 2));

        return {
          success: true,
          message: "Claude Code hooks installed",
          configPath,
        };
      }

      case "gemini": {
        // Install project-level hooks in .gemini/settings.json
        const geminiDir = join(projectPath, ".gemini");
        const configPath = join(geminiDir, "settings.json");

        await mkdir(geminiDir, { recursive: true });

        const hooks = generateGeminiHooks(sessionId, folderId);

        let existingConfig = {};
        if (existsSync(configPath)) {
          try {
            const content = await readFile(configPath, "utf-8");
            existingConfig = JSON.parse(content);
          } catch {
            // Ignore parse errors
          }
        }

        const mergedConfig = {
          ...existingConfig,
          ...hooks,
        };

        await writeFile(configPath, JSON.stringify(mergedConfig, null, 2));

        return {
          success: true,
          message: "Gemini CLI hooks installed",
          configPath,
        };
      }

      case "codex": {
        // Install notify script and update config.toml
        const codexDir = join(projectPath, ".codex");
        const scriptPath = join(codexDir, "orchestrator-notify.py");
        const configPath = join(codexDir, "config.toml");

        await mkdir(codexDir, { recursive: true });

        // Write notify script
        const script = generateCodexNotifyScript(sessionId, folderId);
        await writeFile(scriptPath, script, { mode: 0o755 });

        // Append to config.toml (or create)
        const configSnippet = generateCodexConfig(scriptPath);
        let existingConfig = "";
        if (existsSync(configPath)) {
          existingConfig = await readFile(configPath, "utf-8");
        }

        if (!existingConfig.includes("notify =")) {
          await writeFile(configPath, existingConfig + "\n" + configSnippet);
        }

        return {
          success: true,
          message: "Codex notify script installed",
          configPath: scriptPath,
        };
      }

      case "opencode": {
        // Install plugin in .opencode/plugin/
        const pluginDir = join(projectPath, ".opencode", "plugin");
        const pluginPath = join(pluginDir, "orchestrator-notifier.ts");

        await mkdir(pluginDir, { recursive: true });

        const plugin = generateOpenCodePlugin(sessionId, folderId);
        await writeFile(pluginPath, plugin);

        return {
          success: true,
          message: "OpenCode plugin installed",
          configPath: pluginPath,
        };
      }

      default:
        return {
          success: false,
          message: `Unknown agent provider: ${provider}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to install hooks: ${message}`,
    };
  }
}

/**
 * Check if hooks are installed for an agent
 */
export async function checkHooksInstalled(
  provider: AgentProvider,
  projectPath: string
): Promise<boolean> {
  try {
    switch (provider) {
      case "claude": {
        const configPath = join(projectPath, ".claude", "settings.local.json");
        if (!existsSync(configPath)) return false;
        const content = await readFile(configPath, "utf-8");
        return content.includes("orchestrators/agent-event");
      }

      case "gemini": {
        const configPath = join(projectPath, ".gemini", "settings.json");
        if (!existsSync(configPath)) return false;
        const content = await readFile(configPath, "utf-8");
        return content.includes("orchestrators/agent-event");
      }

      case "codex": {
        const scriptPath = join(projectPath, ".codex", "orchestrator-notify.py");
        return existsSync(scriptPath);
      }

      case "opencode": {
        const pluginPath = join(projectPath, ".opencode", "plugin", "orchestrator-notifier.ts");
        return existsSync(pluginPath);
      }

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Remove hooks for an agent
 */
export async function removeAgentHooks(
  provider: AgentProvider,
  projectPath: string
): Promise<{ success: boolean; message: string }> {
  // Implementation would remove the hook configurations
  // For now, return a placeholder
  return {
    success: true,
    message: `Hooks removal for ${provider} not yet implemented`,
  };
}
