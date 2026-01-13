#!/usr/bin/env node
/**
 * Session Start Hook for Claude Code
 *
 * This hook runs when a Claude Code session starts. It:
 * 1. Notifies the orchestrator of session start via rdv CLI
 * 2. Stores initial session context as short-term memory via rdv CLI
 * 3. Retrieves relevant memories and knowledge from previous sessions
 * 4. Outputs context injection for Claude with memory system awareness
 *
 * Uses rdv CLI for all API interactions (handles auth automatically)
 */

import { execFileSync, execSync } from 'child_process';
import path from 'path';

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
 * Get current git branch
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
 * Get folder name from project path
 */
function getFolderName() {
  return path.basename(PROJECT_PATH);
}

/**
 * Store memory via rdv CLI
 */
function storeMemory(content, tier = 'short', tags = []) {
  try {
    const args = ['memory', 'remember', '-t', tier, '-c', 'observation', '-f', '.'];
    for (const tag of tags) {
      args.push('-T', tag);
    }
    args.push(content);

    execFileSync('rdv', args, {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return true;
  } catch (e) {
    console.error('[hook] Failed to store memory:', e.message);
    return false;
  }
}

/**
 * Notify orchestrator via rdv CLI (using nudge command)
 */
function notifyOrchestrator(tmuxSession, event) {
  if (!tmuxSession) return;

  try {
    // Use rdv status to notify - this logs activity
    execFileSync('rdv', ['status'], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: PROJECT_PATH
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Recall memories from previous sessions
 * @param {string} tier - Memory tier (short, working, long)
 * @param {number} limit - Maximum results
 * @returns {Array} Array of memory objects
 */
function recallMemories(tier = 'long', limit = 10) {
  try {
    const result = execFileSync('rdv', [
      'memory', 'recall',
      '-t', tier,
      '-r', '0.4', // min relevance
      '-l', String(limit),
      '--json'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return JSON.parse(result) || [];
  } catch (e) {
    // Non-fatal - may not have any memories yet
    return [];
  }
}

/**
 * Get project knowledge (insights)
 * @param {number} limit - Maximum results
 * @returns {Array} Array of knowledge objects
 */
function getKnowledge(limit = 10) {
  try {
    const result = execFileSync('rdv', [
      'knowledge', 'list',
      '-l', String(limit),
      '--json'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return JSON.parse(result) || [];
  } catch (e) {
    // Non-fatal - may not have any knowledge yet
    return [];
  }
}

/**
 * Format memories for context injection
 * @param {Array} memories - Array of memory objects
 * @param {string} tier - Tier name for display
 * @returns {string} Formatted markdown
 */
function formatMemories(memories, tier) {
  if (!memories || memories.length === 0) return '';

  const tierLabel = {
    'long': 'Long-term Memories',
    'working': 'Working Memory',
    'short': 'Recent Observations'
  }[tier] || 'Memories';

  let output = `\n### ${tierLabel}\n`;
  for (const mem of memories) {
    const name = mem.name ? `**${mem.name}**: ` : '';
    const type = mem.content_type ? `[${mem.content_type}] ` : '';
    output += `- ${type}${name}${mem.content}\n`;
  }
  return output;
}

/**
 * Format knowledge for context injection
 * @param {Array} knowledge - Array of knowledge objects
 * @returns {string} Formatted markdown
 */
function formatKnowledge(knowledge) {
  if (!knowledge || knowledge.length === 0) return '';

  let output = '\n### Project Knowledge\n';
  for (const k of knowledge) {
    const typeIcon = {
      'convention': '📐',
      'pattern': '🔄',
      'skill': '🛠️',
      'gotcha': '⚠️',
      'best_practice': '✨',
      'anti_pattern': '🚫'
    }[k.type] || '💡';
    output += `- ${typeIcon} **${k.name}**: ${k.description}\n`;
  }
  return output;
}

async function main() {
  const tmuxSession = getTmuxSession();
  const gitBranch = getGitBranch();
  const folderName = getFolderName();

  // Notify orchestrator of session start
  notifyOrchestrator(tmuxSession, 'session_start');

  // Store initial session context as short-term memory
  const sessionInfo = `Session started in ${folderName} on branch ${gitBranch || 'unknown'}`;
  storeMemory(sessionInfo, 'short', ['session-start', folderName]);

  // Retrieve memories and knowledge from previous sessions
  const longTermMemories = recallMemories('long', 10);
  const workingMemories = recallMemories('working', 5);
  const knowledge = getKnowledge(10);

  // Format retrieved context
  const longTermSection = formatMemories(longTermMemories, 'long');
  const workingSection = formatMemories(workingMemories, 'working');
  const knowledgeSection = formatKnowledge(knowledge);

  const hasRetrievedContext = longTermMemories.length > 0 || workingMemories.length > 0 || knowledge.length > 0;

  // Output context injection for Claude
  console.log(`
[Session Context Injected]
─────────────────────────────────────────────────
Project: ${PROJECT_PATH}
Branch: ${gitBranch || 'N/A'}
Session: ${tmuxSession || 'N/A'}
${hasRetrievedContext ? `
## Retrieved Context from Previous Sessions
${knowledgeSection}${longTermSection}${workingSection}` : ''}
## Memory System

You have access to a hierarchical memory system. Use it to:
- Store important discoveries, patterns, and gotchas
- Remember decisions and their rationale
- Build up project knowledge over time

**Available Memory Commands (use rdv CLI):**
- \`rdv memory remember "content"\` - Store observation (short-term, 1hr)
- \`rdv memory remember -t working "content"\` - Store working context (24hr)
- \`rdv memory remember -t long "content"\` - Store permanent learning
- \`rdv note add "content"\` - Quick note capture
- \`rdv knowledge add "title" "description"\` - Add project knowledge

**Memory Tiers:**
- \`short\`: Ephemeral observations (auto-expires in 1 hour)
- \`working\`: Current task context (auto-expires in 24 hours)
- \`long\`: Permanent learnings (never expires)

**rdv Commands:**
- \`rdv insights list\` - View orchestrator insights
- \`rdv learn analyze <session>\` - Extract learnings from session
- \`rdv memory recall\` - Search memories
- \`rdv knowledge list\` - View project knowledge base
─────────────────────────────────────────────────
`);
}

main().catch(console.error);
