/**
 * Workflow Prompts - Templates for common agent workflows
 *
 * Prompts provide conversation templates that guide agents
 * through multi-step operations.
 */
import { createPrompt } from "../registry.js";
import type { RegisteredPrompt } from "../types.js";

/**
 * create_feature_session - Create a session for working on a feature
 */
const createFeatureSession = createPrompt({
  name: "create_feature_session",
  description:
    "Guide for creating a terminal session with git worktree for feature development. " +
    "Sets up an isolated branch for the feature.",
  arguments: [
    {
      name: "repoPath",
      description: "Path to the git repository",
      required: true,
    },
    {
      name: "featureName",
      description: "Name or description of the feature to work on",
      required: true,
    },
    {
      name: "baseBranch",
      description: "Base branch to create feature branch from (default: main)",
      required: false,
    },
  ],
  handler: async (args) => {
    const repoPath = args.repoPath || "[repository path]";
    const featureName = args.featureName || "[feature name]";
    const baseBranch = args.baseBranch || "main";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to work on a new feature: "${featureName}" in the repository at ${repoPath}`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll help you set up an isolated development environment for "${featureName}".

Here's the workflow I'll follow:

1. **Validate the repository** - Confirm ${repoPath} is a git repo
2. **Create a git worktree** - Branch off ${baseBranch} into a feature branch
3. **Start a terminal session** - Open a session in the worktree directory

Let me start by validating the repository and creating the worktree...

I'll use these tools:
- \`git_validate_repo\` to check the repository
- \`git_worktree_create\` to create the feature branch and worktree
- \`session_create\` to start a terminal session

This creates complete branch isolation - you can work on this feature without affecting ${baseBranch} or other work in progress.`,
          },
        },
      ],
    };
  },
});

/**
 * debug_session - Debug a terminal session
 */
const debugSession = createPrompt({
  name: "debug_session",
  description:
    "Guide for debugging issues in a terminal session by reviewing output and status.",
  arguments: [
    {
      name: "sessionId",
      description: "The session UUID to debug",
      required: true,
    },
  ],
  handler: async (args) => {
    const sessionId = args.sessionId || "[session-id]";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'm having issues with session ${sessionId}. Can you help me debug it?`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll help you debug the session. Let me gather information about its current state.

Here's my debugging approach:

1. **Check session status** - Verify the session exists and is active
2. **Review terminal output** - Look at recent commands and their output
3. **Analyze any errors** - Identify issues from the output

I'll use these tools:
- \`session_get\` to check session status and metadata
- \`session_read_output\` to capture recent terminal output

Let me start by checking the session status...`,
          },
        },
      ],
    };
  },
});

/**
 * run_and_check - Execute a command and verify its output
 */
const runAndCheck = createPrompt({
  name: "run_and_check",
  description:
    "Guide for running a command in a session and checking the results.",
  arguments: [
    {
      name: "sessionId",
      description: "The session UUID to run the command in",
      required: true,
    },
    {
      name: "command",
      description: "The command to execute",
      required: true,
    },
  ],
  handler: async (args) => {
    const sessionId = args.sessionId || "[session-id]";
    const command = args.command || "[command]";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run "${command}" in session ${sessionId} and tell me what happened.`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll execute the command and analyze the results.

Steps:
1. **Execute the command** using \`session_execute\`
2. **Wait briefly** for the command to complete
3. **Read the output** using \`session_read_output\`
4. **Analyze the results** and report any issues or success

Let me run the command now...`,
          },
        },
      ],
    };
  },
});

/**
 * setup_project - Set up a new project environment
 */
const setupProject = createPrompt({
  name: "setup_project",
  description:
    "Guide for setting up a complete project environment with folder, preferences, and session.",
  arguments: [
    {
      name: "projectName",
      description: "Name for the project folder",
      required: true,
    },
    {
      name: "projectPath",
      description: "Path to the project directory",
      required: true,
    },
    {
      name: "startupCommand",
      description: "Command to run when starting sessions (e.g., 'nvm use')",
      required: false,
    },
  ],
  handler: async (args) => {
    const projectName = args.projectName || "[project name]";
    const projectPath = args.projectPath || "[project path]";
    const startupCommand = args.startupCommand || "";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up a new project environment for "${projectName}" at ${projectPath}${startupCommand ? ` with startup command: ${startupCommand}` : ""}`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll set up a complete project environment for "${projectName}".

Here's what I'll configure:

1. **Create a folder** - Organize sessions under "${projectName}"
2. **Set folder preferences** - Configure working directory and startup command
3. **Start initial session** - Create a terminal ready to work

Steps:
- \`folder_create\` to create the project folder
- \`preferences_set\` to configure the folder preferences
- \`session_create\` to start a terminal in the project

This gives you an organized workspace where all new sessions inherit the project settings.`,
          },
        },
      ],
    };
  },
});

/**
 * cleanup_worktrees - Clean up old worktrees
 */
const cleanupWorktrees = createPrompt({
  name: "cleanup_worktrees",
  description:
    "Guide for reviewing and cleaning up old git worktrees from completed features.",
  arguments: [
    {
      name: "repoPath",
      description: "Path to the main git repository",
      required: true,
    },
  ],
  handler: async (args) => {
    const repoPath = args.repoPath || "[repository path]";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to clean up old worktrees in ${repoPath}`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll help you review and clean up worktrees safely.

Here's my approach:

1. **List all worktrees** - See what worktrees exist
2. **Check status of each** - Identify uncommitted changes or unpushed commits
3. **Safe cleanup** - Only remove worktrees that are safe to delete
4. **Report results** - Tell you what was cleaned and what was kept

Tools I'll use:
- \`git_worktree_list\` to see all worktrees
- \`git_worktree_status\` to check each for uncommitted work
- \`git_worktree_remove\` to clean up (with safety checks)

I'll be careful not to remove worktrees with uncommitted changes unless you explicitly ask.`,
          },
        },
      ],
    };
  },
});

/**
 * Export all workflow prompts
 */
export const workflowPrompts: RegisteredPrompt[] = [
  createFeatureSession,
  debugSession,
  runAndCheck,
  setupProject,
  cleanupWorktrees,
];
