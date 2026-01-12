#!/usr/bin/env node
/**
 * Session Start Hook for Claude Code
 *
 * This hook runs when a Claude Code session starts. It:
 * 1. Notifies the orchestrator of session start
 * 2. Injects context about available memory/insight tools
 * 3. Stores initial session context as short-term memory
 *
 * Environment:
 *   SOCKET_PATH - Unix socket path for rdv-server
 *   PROJECT_PATH - Current project path
 *   SESSION_ID - Session identifier (if available)
 */

import { execFileSync } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const SOCKET_PATH = process.env.SOCKET_PATH || path.join(
  process.env.HOME || '~',
  '.remote-dev/run/api.sock'
);
const PROJECT_PATH = process.cwd();
const AGENT = 'claude';

/**
 * Detect current tmux session name
 */
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

/**
 * Get current git branch using execFile
 */
function getGitBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
      timeout: 2000,
      cwd: PROJECT_PATH
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get recent git commits using execFile
 */
function getRecentCommits() {
  try {
    return execFileSync('git', ['log', '--oneline', '-5'], {
      encoding: 'utf-8',
      timeout: 2000,
      cwd: PROJECT_PATH
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Send notification to orchestrator via Unix socket
 */
function sendNotification(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);

    const req = http.request({
      socketPath: SOCKET_PATH,
      path: '/api/orchestrators/agent-event',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    }, (res) => {
      resolve(res.statusCode);
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Store memory via SDK MCP tool
 */
function storeMemory(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);

    const req = http.request({
      socketPath: SOCKET_PATH,
      path: '/api/memory',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    }, (res) => {
      resolve(res.statusCode);
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const tmuxSession = getTmuxSession();
  const gitBranch = getGitBranch();
  const recentCommits = getRecentCommits();

  // Notify orchestrator of session start
  try {
    await sendNotification({
      event: 'session_start',
      agent: AGENT,
      tmuxSessionName: tmuxSession,
      timestamp: new Date().toISOString(),
      reason: 'Claude Code session initialized',
      context: {
        cwd: PROJECT_PATH,
        projectPath: PROJECT_PATH,
        gitBranch,
      }
    });
  } catch (e) {
    // Non-fatal - orchestrator may not be running
    console.error('[hook] Failed to notify orchestrator:', e.message);
  }

  // Store initial session context as short-term memory
  try {
    await storeMemory({
      tier: 'short_term',
      content: `Session started at ${new Date().toISOString()}`,
      contentType: 'text/plain',
      metadata: {
        sessionStart: true,
        projectPath: PROJECT_PATH,
        gitBranch,
        recentCommits,
        tmuxSession,
      }
    });
  } catch (e) {
    // Non-fatal - memory service may not be running
    console.error('[hook] Failed to store memory:', e.message);
  }

  // Output context injection for Claude
  // This will be displayed to Claude at session start
  console.log(`
[Session Context Injected]
─────────────────────────────────────────────────
Project: ${PROJECT_PATH}
Branch: ${gitBranch || 'N/A'}
Session: ${tmuxSession || 'N/A'}

**Available Memory Tools (use these to persist context):**
- \`sdk:memory_store\` - Store important context, decisions, or observations
- \`sdk:note_capture\` - Quick capture of todos, reminders, or warnings
- \`sdk:insight_extract\` - Extract learnings from your work (patterns, gotchas)
- \`sdk:knowledge_add\` - Add to project knowledge base

**Memory Best Practices:**
- Store important decisions and their rationale
- Capture gotchas and anti-patterns you discover
- Note conventions and patterns you observe
- Save context before long operations

**Memory Tiers:**
- \`short_term\`: Ephemeral observations (auto-expires in 1 hour)
- \`working\`: Current task context (auto-expires in 24 hours)
- \`long_term\`: Permanent learnings (never expires)
─────────────────────────────────────────────────
`);
}

main().catch(console.error);
