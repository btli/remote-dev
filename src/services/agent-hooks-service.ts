/**
 * Agent Hooks Service
 *
 * Generates and manages hook configurations for different AI coding agents.
 * Each agent reports events to its folder orchestrator, which can escalate
 * to Master Control when needed.
 *
 * Hierarchy: Agent Hooks → Folder Orchestrator → Master Control
 *
 * IMPORTANT: Hooks are DYNAMIC - they detect the current tmux session at runtime
 * rather than using hardcoded session/folder IDs. This allows:
 * - Project-wide hook installation
 * - Session independence (same hooks work for any session in the project)
 * - Automatic routing based on tmux session name lookup
 */

import { writeFile, readFile, mkdir, chmod } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export type AgentProvider = "claude" | "codex" | "gemini" | "opencode";

/**
 * Get the base URL for the orchestrator API
 * In development, this is localhost. In production, could be configurable.
 */
function getOrchestratorBaseUrl(): string {
  return process.env.ORCHESTRATOR_URL || "http://localhost:6001";
}

/**
 * Generate the orchestrator notify script (Node.js)
 *
 * More elegant than shell scripts:
 * - Native JSON handling (no escaping issues)
 * - Native HTTP (no curl dependency)
 * - Unix socket support for production
 * - Cross-platform compatible
 */
function generateNotifyScript(projectPath: string): string {
  const baseUrl = getOrchestratorBaseUrl();

  return `#!/usr/bin/env node
/**
 * Orchestrator Notification Script (Node.js)
 *
 * Usage: node orchestrator-notify.mjs <event> <agent> [reason]
 * Events: heartbeat, task_complete, session_end, session_start, error, stalled
 * Agents: claude, codex, gemini, opencode
 *
 * Environment:
 *   SOCKET_PATH - Unix socket path (production, takes precedence)
 *   ORCHESTRATOR_URL - HTTP URL (development fallback)
 */

import { execFileSync } from 'child_process';
import http from 'http';

const [,, event = 'heartbeat', agent = 'claude', reason = ''] = process.argv;

// Configuration - socket takes precedence over URL
const SOCKET_PATH = process.env.SOCKET_PATH;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || '${baseUrl}';
const PROJECT_PATH = '${projectPath}';

function getTmuxSession() {
  if (!process.env.TMUX) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '#S'], {
      encoding: 'utf-8',
      timeout: 2000
    }).trim();
  } catch {
    return null;
  }
}

function sendNotification(payload) {
  const data = JSON.stringify(payload);
  const path = '/api/orchestrators/agent-event';

  let options;
  if (SOCKET_PATH) {
    // Unix socket mode (production)
    options = {
      socketPath: SOCKET_PATH,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    };
  } else {
    // HTTP mode (development)
    const url = new URL(path, ORCHESTRATOR_URL);
    options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    };
  }

  const req = http.request(options);
  req.on('error', () => {});
  req.write(data);
  req.end();
}

const payload = {
  event,
  agent,
  tmuxSessionName: getTmuxSession(),
  timestamp: new Date().toISOString(),
  reason,
  context: {
    cwd: process.cwd(),
    projectPath: PROJECT_PATH
  }
};

sendNotification(payload);
process.exit(0);
`;
}

/**
 * Generate Claude Code hook configuration
 *
 * Claude Code uses JSON hooks in .claude/settings.local.json (project-level)
 * Events: Stop, SessionEnd, PostToolUse
 *
 * Uses the new matcher-based format (Claude Code 2024+):
 * Each hook entry has a "matcher" (can be empty to match all) and "hooks" array
 *
 * Uses the notify script for dynamic tmux session detection
 */
export function generateClaudeCodeHooks(projectPath: string): object {
  const notifyScript = join(projectPath, ".claude", "orchestrator-notify.mjs");

  return {
    hooks: {
      // Report when agent completes a response (task_complete)
      Stop: [
        {
          matcher: {},
          hooks: [
            {
              type: "command",
              command: ["node", notifyScript, "task_complete", "claude"],
            },
          ],
        },
      ],
      // Report when session ends
      SessionEnd: [
        {
          matcher: {},
          hooks: [
            {
              type: "command",
              command: ["node", notifyScript, "session_end", "claude"],
            },
          ],
        },
      ],
      // Heartbeat on tool use (disabled by default - too noisy)
      // PostToolUse: [
      //   {
      //     matcher: {},
      //     hooks: [
      //       {
      //         type: "command",
      //         command: ["node", notifyScript, "heartbeat", "claude"],
      //       },
      //     ],
      //   },
      // ],
    },
  };
}

/**
 * Generate Gemini CLI hook configuration
 *
 * Gemini uses JSON hooks in .gemini/settings.json (project-level)
 * Events: SessionEnd, AfterAgent
 *
 * Uses the notify script for dynamic tmux session detection
 */
export function generateGeminiHooks(projectPath: string): object {
  const notifyScript = join(projectPath, ".claude", "orchestrator-notify.mjs");

  return {
    hooks: {
      // Report when agent completes
      AfterAgent: [
        {
          type: "command",
          command: `node ${notifyScript} task_complete gemini`,
        },
      ],
      // Report when session ends
      SessionEnd: [
        {
          type: "command",
          command: `node ${notifyScript} session_end gemini`,
        },
      ],
    },
  };
}

/**
 * Generate Codex notify script wrapper
 *
 * Codex uses a notify script configured in .codex/config.toml
 * The script receives JSON as an argument, which we forward to the orchestrator
 * Supports both Unix socket (production) and HTTP (development)
 */
export function generateCodexNotifyWrapper(projectPath: string): string {
  const baseUrl = getOrchestratorBaseUrl();

  return `#!/usr/bin/env python3
"""
Codex notification wrapper for Remote Dev orchestrator.
Receives events from Codex CLI and forwards to folder orchestrator.
Dynamically detects tmux session for proper routing.

Environment:
  SOCKET_PATH - Unix socket path (production, takes precedence)
  ORCHESTRATOR_URL - HTTP URL (development fallback)
"""
import json
import os
import socket
import subprocess
import sys
from datetime import datetime, timezone
from http.client import HTTPConnection


class UnixHTTPConnection(HTTPConnection):
    """HTTP connection over Unix socket."""
    def __init__(self, socket_path, timeout=5):
        super().__init__('localhost', timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def get_tmux_session():
    """Get current tmux session name if running in tmux."""
    if not os.environ.get('TMUX'):
        return None
    try:
        result = subprocess.run(
            ['tmux', 'display-message', '-p', '#S'],
            capture_output=True, text=True, timeout=2
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def send_notification(notification):
    """Send notification via Unix socket or HTTP."""
    socket_path = os.environ.get('SOCKET_PATH')
    data = json.dumps(notification).encode('utf-8')
    path = '/api/orchestrators/agent-event'

    try:
        if socket_path:
            # Unix socket mode (production)
            conn = UnixHTTPConnection(socket_path)
        else:
            # HTTP mode (development)
            url = os.environ.get('ORCHESTRATOR_URL', '${baseUrl}')
            host = url.replace('http://', '').replace('https://', '').split('/')[0]
            if ':' in host:
                host, port = host.split(':')
                conn = HTTPConnection(host, int(port), timeout=5)
            else:
                conn = HTTPConnection(host, 80, timeout=5)

        conn.request('POST', path, body=data, headers={
            'Content-Type': 'application/json',
            'Content-Length': str(len(data))
        })
        conn.getresponse()
        conn.close()
    except Exception:
        pass  # Don't block Codex on notification failure


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
        'tmuxSessionName': get_tmux_session(),
        'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'context': {
            'cwd': os.getcwd(),
            'projectPath': '${projectPath}',
            'lastMessage': payload.get('last-assistant-message', '')[:500]
        }
    }

    send_notification(notification)


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
 * Dynamically detects tmux session for proper routing
 * Supports both Unix socket (production) and HTTP (development)
 */
export function generateOpenCodePlugin(projectPath: string): string {
  const baseUrl = getOrchestratorBaseUrl();

  return `/**
 * OpenCode orchestrator notification plugin.
 * Reports session events to Remote Dev folder orchestrator.
 * Dynamically detects tmux session for proper routing.
 *
 * Environment:
 *   SOCKET_PATH - Unix socket path (production, takes precedence)
 *   ORCHESTRATOR_URL - HTTP URL (development fallback)
 */
import { execFileSync } from 'child_process';
import http from 'http';

const SOCKET_PATH = process.env.SOCKET_PATH;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || '${baseUrl}';
const PROJECT_PATH = '${projectPath}';

function getTmuxSession(): string | null {
  if (!process.env.TMUX) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '#S'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Send notification via Unix socket or HTTP
 */
function sendNotification(notification: object): void {
  const data = JSON.stringify(notification);
  const path = '/api/orchestrators/agent-event';

  let options: http.RequestOptions;
  if (SOCKET_PATH) {
    // Unix socket mode (production)
    options = {
      socketPath: SOCKET_PATH,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
  } else {
    // HTTP mode (development)
    const url = new URL(path, ORCHESTRATOR_URL);
    options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
  }

  const req = http.request(options);
  req.on('error', () => {}); // Silently ignore errors
  req.write(data);
  req.end();
}

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
        tmuxSessionName: getTmuxSession(),
        timestamp: new Date().toISOString(),
        context: {
          cwd: process.cwd(),
          projectPath: PROJECT_PATH,
          filesModified: event.properties?.filesModified || 0,
        },
      };

      sendNotification(notification);
    },
  };
};
`;
}

/**
 * Install the orchestrator notify script (Node.js version)
 * This is shared by all agent hooks - more elegant than shell scripts
 */
async function installNotifyScript(projectPath: string): Promise<string> {
  const claudeDir = join(projectPath, ".claude");
  const scriptPath = join(claudeDir, "orchestrator-notify.mjs");

  await mkdir(claudeDir, { recursive: true });

  const script = generateNotifyScript(projectPath);
  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);

  return scriptPath;
}

/**
 * Install hooks for a specific agent in a project directory
 *
 * Hooks are DYNAMIC - they detect the current tmux session at runtime
 * and report to the orchestrator via the shared notify script.
 */
export async function installAgentHooks(
  provider: AgentProvider,
  projectPath: string
): Promise<{ success: boolean; message: string; configPath?: string }> {
  try {
    // First, ensure the notify script is installed (shared by all agents)
    const notifyScriptPath = await installNotifyScript(projectPath);

    switch (provider) {
      case "claude": {
        // Install project-level hooks in .claude/settings.local.json
        const claudeDir = join(projectPath, ".claude");
        const configPath = join(claudeDir, "settings.local.json");

        await mkdir(claudeDir, { recursive: true });

        const hooks = generateClaudeCodeHooks(projectPath);

        // Merge with existing config if present
        let existingConfig: Record<string, unknown> = {};
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
          message: `Claude Code hooks installed (notify script: ${notifyScriptPath})`,
          configPath,
        };
      }

      case "gemini": {
        // Install project-level hooks in .gemini/settings.json
        const geminiDir = join(projectPath, ".gemini");
        const configPath = join(geminiDir, "settings.json");

        await mkdir(geminiDir, { recursive: true });

        const hooks = generateGeminiHooks(projectPath);

        let existingConfig: Record<string, unknown> = {};
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
        const script = generateCodexNotifyWrapper(projectPath);
        await writeFile(scriptPath, script);
        await chmod(scriptPath, 0o755);

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

        const plugin = generateOpenCodePlugin(projectPath);
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
 * Install hooks for all supported agents in a project
 */
export async function installAllAgentHooks(
  projectPath: string
): Promise<{ success: boolean; results: Record<AgentProvider, { success: boolean; message: string }> }> {
  const providers: AgentProvider[] = ["claude", "codex", "gemini", "opencode"];
  const results: Record<AgentProvider, { success: boolean; message: string }> = {} as Record<AgentProvider, { success: boolean; message: string }>;

  let allSuccess = true;
  for (const provider of providers) {
    const result = await installAgentHooks(provider, projectPath);
    results[provider] = { success: result.success, message: result.message };
    if (!result.success) allSuccess = false;
  }

  return { success: allSuccess, results };
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
