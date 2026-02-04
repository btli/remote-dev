/**
 * Session Tools - Terminal Session Management
 *
 * Tools for creating, managing, and interacting with terminal sessions.
 * These are the core tools for agent workflows.
 */
import { z } from "zod";
import { createTool } from "../registry.js";
import { successResult } from "../utils/error-handler.js";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import { restartAgentUseCase } from "@/infrastructure/container";
import { RestartAgentError } from "@/application/use-cases/session/RestartAgentUseCase";
import type { RegisteredTool } from "../types.js";

/**
 * session_list - List all terminal sessions
 */
const sessionList = createTool({
  name: "session_list",
  description:
    "List all terminal sessions for the current user. Can filter by status (active, suspended, closed).",
  inputSchema: z.object({
    status: z
      .enum(["active", "suspended", "closed"])
      .optional()
      .describe("Filter sessions by status"),
    folderId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter sessions by folder ID"),
  }),
  handler: async (input, context) => {
    const sessions = await SessionService.listSessions(
      context.userId,
      input.status
    );

    // Filter by folder if specified
    const filtered = input.folderId
      ? sessions.filter((s) => s.folderId === input.folderId)
      : sessions;

    return successResult({
      success: true,
      count: filtered.length,
      sessions: filtered.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        tmuxSessionName: s.tmuxSessionName,
        projectPath: s.projectPath,
        folderId: s.folderId,
        worktreeBranch: s.worktreeBranch,
        terminalType: s.terminalType,
        agentProvider: s.agentProvider,
        agentExitState: s.agentExitState,
        profileId: s.profileId,
        lastActivityAt: s.lastActivityAt,
        createdAt: s.createdAt,
      })),
    });
  },
});

/**
 * session_create - Create a new terminal session
 */
const sessionCreate = createTool({
  name: "session_create",
  description:
    "Create a new terminal session with optional working directory and startup command. " +
    "Returns the session ID which can be used with session_execute to run commands. " +
    "Supports agent sessions (AI coding agents) with profile-based environment isolation.",
  inputSchema: z.object({
    name: z.string().optional().describe("Display name for the session"),
    projectPath: z
      .string()
      .optional()
      .describe("Working directory for the terminal"),
    folderId: z.string().uuid().optional().describe("Folder to create session in"),
    startupCommand: z
      .string()
      .optional()
      .describe("Command to run on session start"),
    createWorktree: z
      .boolean()
      .optional()
      .describe("Create a git worktree for this session"),
    featureDescription: z
      .string()
      .optional()
      .describe("Feature description for auto-generated branch name"),
    baseBranch: z
      .string()
      .optional()
      .describe("Base branch for worktree creation"),
    terminalType: z
      .enum(["shell", "agent", "file"])
      .optional()
      .describe("Terminal type: shell (default), agent (AI agent), file (editor)"),
    agentProvider: z
      .enum(["claude", "codex", "gemini", "opencode", "none"])
      .optional()
      .describe("AI agent provider when terminalType is 'agent'"),
    autoLaunchAgent: z
      .boolean()
      .optional()
      .describe("Whether to auto-launch the agent CLI"),
    agentFlags: z
      .array(z.string())
      .optional()
      .describe("Additional flags for the agent CLI"),
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Agent profile ID for environment isolation"),
  }),
  handler: async (input, context) => {
    // Generate a default name if not provided
    const sessionName = input.name || `Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

    const session = await SessionService.createSession(context.userId, {
      name: sessionName,
      projectPath: input.projectPath,
      folderId: input.folderId,
      startupCommand: input.startupCommand,
      createWorktree: input.createWorktree,
      featureDescription: input.featureDescription,
      baseBranch: input.baseBranch,
      terminalType: input.terminalType,
      agentProvider: input.agentProvider === "none" ? undefined : input.agentProvider,
      autoLaunchAgent: input.autoLaunchAgent,
      agentFlags: input.agentFlags,
      profileId: input.profileId,
    });

    return successResult({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        tmuxSessionName: session.tmuxSessionName,
        status: session.status,
        projectPath: session.projectPath,
        worktreeBranch: session.worktreeBranch,
        terminalType: session.terminalType,
        agentProvider: session.agentProvider,
        agentExitState: session.agentExitState,
        profileId: session.profileId,
      },
      hint: input.terminalType === "agent"
        ? `Agent session created. Use session_restart_agent to restart if the agent exits.`
        : `Use session_execute with sessionId "${session.id}" to run commands.`,
    });
  },
});

/**
 * session_get - Get details of a specific session
 */
const sessionGet = createTool({
  name: "session_get",
  description: "Get detailed information about a specific terminal session.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to retrieve"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSessionWithMetadata(
      input.sessionId,
      context.userId
    );

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);

    return successResult({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        tmuxSessionName: session.tmuxSessionName,
        tmuxAlive: tmuxExists,
        projectPath: session.projectPath,
        folderId: session.folderId,
        worktreeBranch: session.worktreeBranch,
        repository: session.repository,
        terminalType: session.terminalType,
        agentProvider: session.agentProvider,
        agentExitState: session.agentExitState,
        agentExitCode: session.agentExitCode,
        agentRestartCount: session.agentRestartCount,
        profileId: session.profileId,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
      },
    });
  },
});

/**
 * session_execute - Execute a command in a session
 */
const sessionExecute = createTool({
  name: "session_execute",
  description:
    "Execute a command in a terminal session (fire-and-forget). " +
    "Use session_read_output to see the results after execution.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID"),
    command: z.string().describe("The command to execute"),
    pressEnter: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to press Enter after the command (default: true)"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSession(
      input.sessionId,
      context.userId
    );

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    if (session.status === "closed") {
      return successResult({
        success: false,
        error: "Session is closed",
        code: "SESSION_CLOSED",
      });
    }

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (!tmuxExists) {
      return successResult({
        success: false,
        error: "Terminal session no longer exists",
        code: "TMUX_SESSION_GONE",
      });
    }

    // Execute the command
    await TmuxService.sendKeys(
      session.tmuxSessionName,
      input.command,
      input.pressEnter
    );

    // Update last activity
    await SessionService.touchSession(input.sessionId, context.userId);

    return successResult({
      success: true,
      sessionId: input.sessionId,
      command: input.command,
      hint: "Command sent. Use session_read_output to see results.",
    });
  },
});

/**
 * session_read_output - Read terminal output from a session
 */
const sessionReadOutput = createTool({
  name: "session_read_output",
  description:
    "Read terminal output (scrollback buffer) from a session. " +
    "Useful for seeing command results after using session_execute.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID"),
    lines: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe("Number of lines to capture from scrollback (default: 100)"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSession(
      input.sessionId,
      context.userId
    );

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (!tmuxExists) {
      return successResult({
        success: false,
        error: "Terminal session no longer exists",
        code: "TMUX_SESSION_GONE",
      });
    }

    // Capture output from tmux
    const output = await TmuxService.captureOutput(
      session.tmuxSessionName,
      input.lines
    );

    return successResult({
      success: true,
      sessionId: input.sessionId,
      lines: input.lines,
      output,
    });
  },
});

/**
 * session_suspend - Suspend an active session
 */
const sessionSuspend = createTool({
  name: "session_suspend",
  description:
    "Suspend an active session. The tmux session stays alive but is marked as suspended.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to suspend"),
  }),
  handler: async (input, context) => {
    await SessionService.suspendSession(input.sessionId, context.userId);

    return successResult({
      success: true,
      sessionId: input.sessionId,
      status: "suspended",
    });
  },
});

/**
 * session_resume - Resume a suspended session
 */
const sessionResume = createTool({
  name: "session_resume",
  description: "Resume a previously suspended session.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to resume"),
  }),
  handler: async (input, context) => {
    await SessionService.resumeSession(input.sessionId, context.userId);

    return successResult({
      success: true,
      sessionId: input.sessionId,
      status: "active",
    });
  },
});

/**
 * session_close - Close and terminate a session
 */
const sessionClose = createTool({
  name: "session_close",
  description:
    "Close a session permanently. This kills the tmux session and marks it as closed.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to close"),
  }),
  handler: async (input, context) => {
    await SessionService.closeSession(input.sessionId, context.userId);

    return successResult({
      success: true,
      sessionId: input.sessionId,
      status: "closed",
    });
  },
});

/**
 * session_update - Update session metadata
 */
const sessionUpdate = createTool({
  name: "session_update",
  description: "Update session metadata like name or folder.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to update"),
    name: z.string().optional().describe("New display name"),
    folderId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("Move session to folder (null to remove from folder)"),
  }),
  handler: async (input, context) => {
    const updates: { name?: string; folderId?: string | null } = {};

    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.folderId !== undefined) {
      updates.folderId = input.folderId;
    }

    const session = await SessionService.updateSession(
      input.sessionId,
      context.userId,
      updates
    );

    return successResult({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        folderId: session.folderId,
        status: session.status,
      },
    });
  },
});

/**
 * session_restart_agent - Restart an exited agent in an agent-type session
 */
const sessionRestartAgent = createTool({
  name: "session_restart_agent",
  description:
    "Restart an exited agent in an agent-type session. " +
    "Only works for sessions with terminalType 'agent' that are in 'exited' state.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The agent session UUID"),
  }),
  handler: async (input, context) => {
    try {
      const result = await restartAgentUseCase.execute({
        sessionId: input.sessionId,
        userId: context.userId,
      });
      return successResult({
        success: true,
        sessionId: input.sessionId,
        agentExitState: result.session.agentExitState,
        restartCount: result.session.agentRestartCount,
      });
    } catch (error) {
      if (error instanceof RestartAgentError) {
        return successResult({
          success: false,
          error: error.message,
          code: error.code,
        });
      }
      throw error;
    }
  },
});

/**
 * session_close_agent - Mark an agent session as closed (won't be restarted)
 */
const sessionCloseAgent = createTool({
  name: "session_close_agent",
  description:
    "Mark an agent session as closed (won't be restarted). " +
    "Use this when you want to close an agent session without killing the terminal.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The agent session UUID"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.markAgentClosed(
      input.sessionId,
      context.userId
    );
    if (!session) {
      return successResult({
        success: false,
        error: "Session not found or not an agent session",
        code: "SESSION_NOT_FOUND",
      });
    }
    return successResult({
      success: true,
      sessionId: input.sessionId,
      agentExitState: "closed",
    });
  },
});

/**
 * Export all session tools
 */
export const sessionTools: RegisteredTool[] = [
  sessionList,
  sessionCreate,
  sessionGet,
  sessionExecute,
  sessionReadOutput,
  sessionSuspend,
  sessionResume,
  sessionClose,
  sessionUpdate,
  sessionRestartAgent,
  sessionCloseAgent,
];
