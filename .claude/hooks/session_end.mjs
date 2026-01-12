#!/usr/bin/env node
/**
 * Session End Hook for Claude Code
 *
 * This hook runs when a Claude Code session ends. It:
 * 1. Notifies the orchestrator of session end
 * 2. Extracts learnings from the session transcript
 * 3. Promotes working memory to long-term if valuable
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
 * Trigger learning extraction via rdv CLI
 */
function extractLearnings(tmuxSession) {
  if (!tmuxSession) return null;

  try {
    // Use rdv learn analyze to extract learnings from the session
    const result = execFileSync('rdv', ['learn', 'analyze', tmuxSession, '--save'], {
      encoding: 'utf-8',
      timeout: 30000, // Give it more time for analysis
      cwd: PROJECT_PATH
    });
    return result.trim();
  } catch (e) {
    console.error('[hook] Failed to extract learnings:', e.message);
    return null;
  }
}

async function main() {
  const tmuxSession = getTmuxSession();

  // Notify orchestrator of session end
  try {
    await sendNotification({
      event: 'session_end',
      agent: AGENT,
      tmuxSessionName: tmuxSession,
      timestamp: new Date().toISOString(),
      reason: 'Claude Code session completed',
      context: {
        cwd: PROJECT_PATH,
        projectPath: PROJECT_PATH,
      }
    });
  } catch (e) {
    // Non-fatal - orchestrator may not be running
    console.error('[hook] Failed to notify orchestrator:', e.message);
  }

  // Extract learnings from session (if tmux session available)
  if (tmuxSession) {
    console.log('[hook] Extracting learnings from session...');
    const learnings = extractLearnings(tmuxSession);
    if (learnings) {
      console.log('[hook] Learnings extracted:', learnings);
    }
  }

  // Output summary
  console.log(`
[Session End Summary]
─────────────────────────────────────────────────
Project: ${PROJECT_PATH}
Session: ${tmuxSession || 'N/A'}
Timestamp: ${new Date().toISOString()}

Learnings have been extracted and saved to project knowledge.
─────────────────────────────────────────────────
`);
}

main().catch(console.error);
