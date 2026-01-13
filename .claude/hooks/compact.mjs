#!/usr/bin/env node
/**
 * Compaction Hook for Claude Code
 *
 * This hook runs when Claude's context is about to be compacted. It:
 * 1. Retrieves preserved working context from memory system
 * 2. Gets current task goals and open TODOs from beads
 * 3. Searches for relevant long-term memories
 * 4. Outputs context reconstitution for Claude
 *
 * Uses rdv CLI for memory operations (handles auth automatically)
 */

import { execFileSync } from 'child_process';
import path from 'path';

const PROJECT_PATH = process.cwd();

/**
 * Retrieve working memories from rdv
 * @returns {Array} Array of memory objects
 */
function getWorkingMemories() {
  try {
    const result = execFileSync('rdv', [
      'memory', 'recall',
      '-t', 'working',
      '-l', '10',
      '--json'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return JSON.parse(result) || [];
  } catch {
    return [];
  }
}

/**
 * Retrieve short-term memories (recent observations)
 * @returns {Array} Array of memory objects
 */
function getShortTermMemories() {
  try {
    const result = execFileSync('rdv', [
      'memory', 'recall',
      '-t', 'short',
      '-l', '5',
      '--json'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return JSON.parse(result) || [];
  } catch {
    return [];
  }
}

/**
 * Retrieve long-term knowledge relevant to current work
 * @returns {Array} Array of knowledge objects
 */
function getLongTermKnowledge() {
  try {
    const result = execFileSync('rdv', [
      'knowledge', 'list',
      '-l', '10',
      '--json'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: PROJECT_PATH
    });
    return JSON.parse(result) || [];
  } catch {
    return [];
  }
}

/**
 * Get active tasks from beads (if available)
 * @returns {Object} Task context with open and in-progress items
 */
function getTaskContext() {
  try {
    // Get in-progress issues
    const inProgressResult = execFileSync('bd', [
      'list', '--status=in_progress', '--json'
    ], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: PROJECT_PATH
    });
    const inProgress = JSON.parse(inProgressResult || '[]');

    // Get open issues (limited)
    const openResult = execFileSync('bd', [
      'list', '--status=open', '-l', '5', '--json'
    ], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: PROJECT_PATH
    });
    const open = JSON.parse(openResult || '[]');

    return { inProgress, open };
  } catch {
    return { inProgress: [], open: [] };
  }
}

/**
 * Get recent notes (if available)
 * @returns {Array} Array of notes
 */
function getRecentNotes() {
  try {
    const result = execFileSync('rdv', [
      'notes', 'list',
      '-l', '5'
    ], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: PROJECT_PATH
    });
    // Parse the text output (notes don't have --json yet)
    return result.trim();
  } catch {
    return '';
  }
}

/**
 * Format memory entries for display
 * @param {Array} memories - Memory objects
 * @param {string} label - Section label
 * @returns {string} Formatted markdown
 */
function formatMemories(memories, label) {
  if (!memories || memories.length === 0) return '';

  let output = `\n### ${label}\n`;
  for (const mem of memories) {
    const name = mem.name ? `**${mem.name}**: ` : '';
    const type = mem.content_type ? `[${mem.content_type}] ` : '';
    output += `- ${type}${name}${mem.content}\n`;
  }
  return output;
}

/**
 * Format knowledge entries for display
 * @param {Array} knowledge - Knowledge objects
 * @returns {string} Formatted markdown
 */
function formatKnowledge(knowledge) {
  if (!knowledge || knowledge.length === 0) return '';

  let output = '\n### Relevant Knowledge\n';
  for (const k of knowledge) {
    const typeIcon = {
      'convention': '📐',
      'pattern': '🔄',
      'skill': '🛠️',
      'gotcha': '⚠️',
      'tool': '🔧'
    }[k.type] || '💡';
    const name = k.name || 'Untitled';
    const desc = k.description || k.content;
    output += `- ${typeIcon} **${name}**: ${desc}\n`;
  }
  return output;
}

/**
 * Format task context for display
 * @param {Object} taskContext - Task context with in_progress and open arrays
 * @returns {string} Formatted markdown
 */
function formatTaskContext(taskContext) {
  const { inProgress, open } = taskContext;
  if (inProgress.length === 0 && open.length === 0) return '';

  let output = '\n### Current Tasks\n';

  if (inProgress.length > 0) {
    output += '\n**In Progress:**\n';
    for (const task of inProgress) {
      const id = task.id ? task.id.slice(0, 13) : 'unknown';
      output += `- \`${id}\`: ${task.title}\n`;
    }
  }

  if (open.length > 0) {
    output += '\n**Open (Next Up):**\n';
    for (const task of open.slice(0, 3)) {
      const id = task.id ? task.id.slice(0, 13) : 'unknown';
      output += `- \`${id}\`: ${task.title}\n`;
    }
  }

  return output;
}

async function main() {
  const folderName = path.basename(PROJECT_PATH);

  // Retrieve context from various sources
  const workingMemories = getWorkingMemories();
  const shortTermMemories = getShortTermMemories();
  const longTermKnowledge = getLongTermKnowledge();
  const taskContext = getTaskContext();

  // Format sections
  const workingSection = formatMemories(workingMemories, 'Working Context (Preserved)');
  const recentSection = formatMemories(shortTermMemories, 'Recent Observations');
  const knowledgeSection = formatKnowledge(longTermKnowledge);
  const taskSection = formatTaskContext(taskContext);

  const hasContext = workingMemories.length > 0 ||
                     shortTermMemories.length > 0 ||
                     longTermKnowledge.length > 0 ||
                     taskContext.inProgress.length > 0 ||
                     taskContext.open.length > 0;

  // Output context reconstitution
  console.log(`
[Context Reconstitution - Post Compaction]
═════════════════════════════════════════════════
Project: ${folderName}
Path: ${PROJECT_PATH}

${hasContext ? `## Preserved Context
${taskSection}${workingSection}${recentSection}${knowledgeSection}` : '## No preserved context found'}

## Memory Commands
- \`rdv memory recall -t working\` - Get all working context
- \`rdv memory recall -t long\` - Search long-term memories
- \`rdv knowledge list\` - View project knowledge
- \`bd list --status=in_progress\` - View current tasks

## Quick Recovery
If you need more context about what you were working on:
1. Check \`bd show <task-id>\` for task details
2. Use \`rdv notes list\` to see recent notes
3. Use \`rdv memory recall -q "keyword"\` to search memories

═════════════════════════════════════════════════
`);
}

main().catch(console.error);
