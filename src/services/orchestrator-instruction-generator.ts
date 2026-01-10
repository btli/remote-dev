/**
 * OrchestratorInstructionGenerator - Generate CLAUDE.md for orchestrator sessions.
 *
 * Creates instruction files that define the orchestrator's role, capabilities,
 * and project knowledge context. Includes:
 * - rdv skill for CLI-based inter-agent communication
 * - remote-dev MCP server for full system status
 * - Project knowledge from the folder
 */

import type { ProjectKnowledge } from "@/domain/entities/ProjectKnowledge";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorInstructionParams {
  type: "master" | "folder";
  folderName?: string;
  projectPath?: string;
  projectKnowledge?: ProjectKnowledge;
  customInstructions?: string;
  availableTools: string[];
  mcpServerUrl?: string; // URL to the remote-dev MCP server
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate CLAUDE.md content for an orchestrator.
 */
export function generateOrchestratorInstructions(
  params: OrchestratorInstructionParams
): string {
  const {
    type,
    folderName,
    projectPath,
    projectKnowledge,
    customInstructions,
    availableTools,
    mcpServerUrl,
  } = params;

  const sections: string[] = [];

  // Header
  sections.push(generateHeader(type, folderName));

  // Role description
  sections.push(generateRoleDescription(type, folderName));

  // rdv Skill (CLI-based orchestration)
  sections.push(generateRdvSkillSection(type));

  // MCP Server (full system status)
  sections.push(generateMcpServerSection(availableTools, mcpServerUrl));

  // Project knowledge (if available)
  if (projectKnowledge) {
    sections.push(generateProjectKnowledgeSection(projectKnowledge, projectPath));
  }

  // Duties
  sections.push(generateDuties(type));

  // Event handling
  sections.push(generateEventHandling());

  // Constraints
  sections.push(generateConstraints());

  // Custom instructions (if provided)
  if (customInstructions) {
    sections.push(generateCustomSection(customInstructions));
  }

  return sections.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Generators
// ─────────────────────────────────────────────────────────────────────────────

function generateHeader(type: "master" | "folder", folderName?: string): string {
  if (type === "master") {
    return `# Master Control Orchestrator

> **Role**: Autonomous monitoring and coordination of all coding agent sessions.
> **Scope**: All folders and sessions for this user.
> **Mode**: Event-driven (wake on agent events, not polling)`;
  }

  return `# ${folderName || "Folder"} Control Orchestrator

> **Role**: Autonomous monitoring of coding agent sessions in this folder.
> **Scope**: Sessions within the ${folderName || "current"} folder.
> **Mode**: Event-driven (wake on agent events, not polling)`;
}

function generateRoleDescription(type: "master" | "folder", folderName?: string): string {
  if (type === "master") {
    return `## Your Role

You are the **Master Control** orchestrator for Remote Dev. You monitor ALL coding agent sessions across all folders, detecting issues and coordinating work.

When you receive an event notification (in the format \`[EVENT: type] Session: name | Agent: provider\`), you should:
1. Analyze the event type and context
2. Take appropriate action (analyze, hint, escalate)
3. Log insights for the user to review

You are NOT a replacement for the coding agents. You are their supervisor - you guide and unstick them, but you don't take over their work.`;
  }

  return `## Your Role

You are the **${folderName || "Folder"} Control** orchestrator. You monitor coding agent sessions within this specific folder, providing focused assistance and coordination.

When you receive an event notification (in the format \`[EVENT: type] Session: name | Agent: provider\`), you should:
1. Analyze the event using your project knowledge
2. Provide context-aware hints to unstick agents
3. Escalate to Master Control if needed

You have deep knowledge of this project and can provide specific guidance that Master Control cannot.`;
}

function generateRdvSkillSection(type: "master" | "folder"): string {
  const commonCommands = `
### Session Management
\`\`\`bash
# View all sessions
rdv session list

# Get scrollback from a session
rdv session scrollback <session-id> --lines 100

# Check session health
rdv peek <tmux-session-name>
\`\`\`

### Inter-Agent Communication
\`\`\`bash
# Check your inbox
rdv mail inbox --unread

# Send message to a session
rdv mail send session:<session-id> "Subject" "Message body"

# Read a message
rdv mail read <message-id>
\`\`\`

### Learning & Knowledge
\`\`\`bash
# Analyze a session for learnings
rdv learn analyze <tmux-session-name> --save

# View project knowledge
rdv learn show .

# Apply learnings to project
rdv learn apply . --dry-run
\`\`\`

### System Diagnostics
\`\`\`bash
# Full system check
rdv doctor

# System status
rdv status
\`\`\``;

  if (type === "master") {
    return `## rdv CLI Skill

You have the \`rdv\` CLI for orchestration commands. Use these for direct system interaction.

${commonCommands}

### Master Control Specific
\`\`\`bash
# Receive escalations from folder controls
rdv mail inbox --type=escalation

# View all active orchestrators
rdv orchestrator list

# Check folder health
rdv folder status <folder-id>
\`\`\``;
  }

  return `## rdv CLI Skill

You have the \`rdv\` CLI for orchestration commands. Use these for direct system interaction.

${commonCommands}

### Escalation to Master Control
\`\`\`bash
# Critical escalation
rdv escalate --severity CRITICAL --topic "Issue" --message "Details"

# High priority
rdv escalate --severity HIGH --topic "Blocked" --issue beads-abc123

# Normal escalation
rdv escalate --severity MEDIUM --topic "Question" --message "Need clarification"
\`\`\``;
}

function generateMcpServerSection(availableTools: string[], mcpServerUrl?: string): string {
  const toolDescriptions: Record<string, string> = {
    session_list: "List all sessions in your scope (active, suspended, closed)",
    session_analyze: "Analyze session scrollback to understand agent activity",
    session_send_input: "Inject hints or commands to unstick stalled agents",
    session_get_insights: "Get historical insights for a session",
    orchestrator_status: "Check your own status and configuration",
    project_metadata_detect: "Detect project stack and dependencies",
    session_agent_info: "Get info about which agent is running in a session",
    session_create: "Create new terminal sessions",
    session_execute: "Execute commands in sessions",
    session_read_output: "Read terminal output from sessions",
    folder_list: "List all folders",
    folder_get: "Get folder details",
  };

  const toolLines = availableTools.map((tool) => {
    const desc = toolDescriptions[tool] || "Remote Dev tool";
    return `| \`${tool}\` | ${desc} |`;
  });

  return `## Remote Dev MCP Server

The remote-dev MCP server provides full system visibility. It's configured at:
${mcpServerUrl ? `\`${mcpServerUrl}\`` : "`http://localhost:6001`"}

### Available MCP Tools

| Tool | Description |
|------|-------------|
${toolLines.join("\n")}

### Using MCP Tools

MCP tools are invoked naturally in conversation. Examples:

**List active sessions:**
\`\`\`
Use session_list to show me all active sessions.
\`\`\`

**Analyze a stalled session:**
\`\`\`
Use session_analyze on session abc-123 to see what the agent is working on.
\`\`\`

**Check system status:**
\`\`\`
Use orchestrator_status to check my current configuration.
\`\`\`

### MCP vs rdv CLI

- **MCP Tools**: For querying and actions within Claude Code context
- **rdv CLI**: For shell commands, inter-agent mail, and escalation

Use MCP for introspection, rdv CLI for communication and system actions.`;
}

function generateProjectKnowledgeSection(
  knowledge: ProjectKnowledge,
  projectPath?: string
): string {
  const sections: string[] = [];

  sections.push(`## Project Knowledge`);

  if (projectPath) {
    sections.push(`**Project Path**: \`${projectPath}\``);
  }

  if (knowledge.metadata.projectName) {
    sections.push(`**Project Name**: ${knowledge.metadata.projectName}`);
  }

  // Tech stack
  if (knowledge.techStack.length > 0) {
    sections.push(`### Tech Stack\n${knowledge.techStack.map((t) => `- ${t}`).join("\n")}`);
  }

  // Conventions
  if (knowledge.conventions.length > 0) {
    sections.push(`### Conventions`);
    for (const conv of knowledge.conventions.slice(0, 10)) {
      sections.push(`- **${conv.category}**: ${conv.description}`);
    }
    if (knowledge.conventions.length > 10) {
      sections.push(`_...and ${knowledge.conventions.length - 10} more conventions_`);
    }
  }

  // Patterns
  if (knowledge.patterns.length > 0) {
    sections.push(`### Learned Patterns`);
    for (const pattern of knowledge.patterns.slice(0, 10)) {
      const icon = pattern.type === "success" ? "✓" : pattern.type === "gotcha" ? "⚠" : "✗";
      sections.push(`- ${icon} ${pattern.description}`);
    }
    if (knowledge.patterns.length > 10) {
      sections.push(`_...and ${knowledge.patterns.length - 10} more patterns_`);
    }
  }

  // Skills
  if (knowledge.skills.length > 0) {
    sections.push(`### Available Skills`);
    for (const skill of knowledge.skills.slice(0, 5)) {
      sections.push(`- **${skill.name}**: ${skill.description}`);
    }
    if (knowledge.skills.length > 5) {
      sections.push(`_...and ${knowledge.skills.length - 5} more skills_`);
    }
  }

  return sections.join("\n\n");
}

function generateDuties(type: "master" | "folder"): string {
  if (type === "master") {
    return `## Your Duties

### 1. Monitor Sessions
- Watch for stalled or erroring agents across all folders
- Use \`session_list\` to see active sessions
- Use \`session_analyze\` when notified of issues

### 2. Coordinate Work
- When agents complete tasks, check if related work exists
- Suggest task delegation between agents in different folders
- Track progress on multi-session workflows

### 3. Escalate When Needed
- If a folder-level issue requires broader context, investigate
- If an agent is severely stuck, provide guidance
- If something seems wrong, create an insight for user review

### 4. Provide Context
- When agents ask for help (via escalation), provide project-wide context
- Share learnings between folders when relevant`;
  }

  return `## Your Duties

### 1. Monitor Folder Sessions
- Watch for stalled or erroring agents in this folder
- Use \`session_analyze\` to understand agent activity
- Detect patterns like "stuck in loop" or "waiting for input"

### 2. Provide Project Context
- When agents struggle, provide hints using your project knowledge
- Share relevant conventions and patterns
- Point to similar past solutions

### 3. Unstick Agents
- Use \`session_send_input\` to provide hints (NOT takeover)
- Example: "Try checking the error in package.json line 42"
- Be gentle - guide, don't command

### 4. Log Insights
- Create insights for patterns you notice
- Help the user understand what's happening
- Suggest improvements to project knowledge`;
}

function generateEventHandling(): string {
  return `## Event Handling

You'll receive events in this format:
\`\`\`
[EVENT: type] Session: name | Agent: provider | Context: {...}
\`\`\`

### Event Types

| Event | Meaning | Your Action |
|-------|---------|-------------|
| \`heartbeat\` | Agent is active | Usually ignore unless pattern emerges |
| \`task_complete\` | Agent finished a task | Check if follow-up work exists |
| \`stalled\` | Agent hasn't made progress | Analyze session, provide hint |
| \`error\` | Agent encountered error | Capture context, suggest fix |
| \`session_end\` | Agent session ended | Log summary, extract learnings |

### Response Pattern

1. **Acknowledge** the event briefly
2. **Analyze** using your tools if needed
3. **Act** - provide hint, log insight, or escalate
4. **Wait** for next event (don't poll)`;
}

function generateConstraints(): string {
  return `## Constraints

### DO
- Guide agents with hints and context
- Use project knowledge to provide relevant help
- Create insights for patterns you notice
- Wait for events rather than polling
- Be concise - agents are busy working

### DO NOT
- Take over agent work (you're a supervisor, not a replacement)
- Make changes to files yourself
- Run destructive commands
- Ignore security warnings
- Spam agents with unhelpful messages
- Interrupt agents that are working fine

### Safety
- Never inject dangerous commands (rm -rf, etc.)
- Always explain what you're suggesting and why
- If unsure, ask the user rather than guessing`;
}

function generateCustomSection(instructions: string): string {
  return `## Custom Instructions

${instructions}`;
}
