#!/usr/bin/env node
/**
 * Orchestrator Notification Script (Node.js)
 *
 * More elegant alternative to shell scripts:
 * - Native JSON handling (no escaping issues)
 * - Native HTTP (no curl dependency)
 * - Unix socket support for production
 * - Cross-platform compatible
 *
 * Usage: ./orchestrator-notify.mjs <event> <agent> [reason]
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
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:6001';
const PROJECT_PATH = '/Users/bryanli/Projects/btli/remote-dev';

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
 * Send notification to orchestrator
 * Supports both Unix socket (production) and HTTP (development)
 */
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

  // Fire and forget - don't block the agent
  const req = http.request(options);
  req.on('error', () => {}); // Silently ignore errors
  req.write(data);
  req.end();
}

// Build payload
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

// Send notification (non-blocking)
sendNotification(payload);

// Exit immediately - don't block the agent
process.exit(0);
