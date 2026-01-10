import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { orchestratorSessions, terminalSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { wakeOrchestrator, notifyOrchestrator } from "@/services/orchestrator-bootstrap-service";

/**
 * Agent Event Types
 *
 * These events are sent by agent hooks to notify the orchestrator
 * of agent lifecycle events.
 */
type AgentEventType =
  | "heartbeat"      // Agent is active (sent periodically or on tool use)
  | "session_start"  // Agent session started
  | "session_end"    // Agent session ended
  | "task_complete"  // Agent finished a task (waiting for input)
  | "error"          // Agent encountered an error
  | "stalled";       // Agent self-reported stall

/**
 * Agent Provider Types
 */
type AgentProvider = "claude" | "codex" | "gemini" | "opencode";

/**
 * Unified agent event payload
 * All agent hooks normalize to this format
 */
interface AgentEventPayload {
  event: AgentEventType;
  agent: AgentProvider;
  sessionId?: string;         // Terminal session ID (if known)
  tmuxSessionName?: string;   // Tmux session name (alternative identifier)
  folderId?: string;          // Folder ID for direct routing to folder orchestrator
  timestamp?: string;         // ISO-8601 timestamp
  reason?: string;            // For session_end: exit, logout, clear, etc.
  context?: {
    cwd?: string;
    filesModified?: number;
    lastMessage?: string;
    transcriptPath?: string;
  };
}

/**
 * Events that should be escalated to Master Control
 */
const ESCALATION_EVENTS: AgentEventType[] = ["error", "stalled"];

/**
 * POST /api/orchestrators/agent-event
 *
 * Receives lifecycle events from agent hooks.
 * This is the primary communication channel from agents to the orchestrator.
 *
 * No authentication required - hooks run in trusted local environment.
 * Security is provided by localhost-only access.
 */
export async function POST(request: Request) {
  try {
    const result = await parseJsonBody<AgentEventPayload>(request);
    if ("error" in result) {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    const payload = result.data;

    // Validate required fields
    if (!payload.event || !payload.agent) {
      return NextResponse.json(
        { error: "Missing required fields: event, agent" },
        { status: 400 }
      );
    }

    // Find the terminal session
    let session = null;

    if (payload.sessionId) {
      // Direct session ID lookup
      const sessions = await db
        .select()
        .from(terminalSessions)
        .where(eq(terminalSessions.id, payload.sessionId))
        .limit(1);
      session = sessions[0] || null;
    } else if (payload.tmuxSessionName) {
      // Lookup by tmux session name
      const sessions = await db
        .select()
        .from(terminalSessions)
        .where(eq(terminalSessions.tmuxSessionName, payload.tmuxSessionName))
        .limit(1);
      session = sessions[0] || null;
    }

    if (!session) {
      // Session not found - log but don't error (agent may be in unknown session)
      console.log(`[AgentEvent] Session not found for event: ${payload.event}`, {
        sessionId: payload.sessionId,
        tmuxSessionName: payload.tmuxSessionName,
      });
      return NextResponse.json({
        received: true,
        sessionFound: false,
      });
    }

    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();

    // Update session's last activity timestamp
    await db
      .update(terminalSessions)
      .set({
        lastActivityAt: timestamp,
        updatedAt: new Date(),
      })
      .where(eq(terminalSessions.id, session.id));

    // Routing hierarchy: Agent → Folder Orchestrator → Master Control
    //
    // 1. Find folder orchestrator for this session's folder
    // 2. Route event to folder orchestrator
    // 3. Escalate to Master Control for critical events (error, stalled)

    let folderOrchestrator = null;
    let masterOrchestrator = null;

    // Find folder orchestrator (if session is in a folder)
    if (session.folderId) {
      const folderOrcs = await db
        .select()
        .from(orchestratorSessions)
        .where(
          and(
            eq(orchestratorSessions.userId, session.userId),
            eq(orchestratorSessions.scopeType, "folder"),
            eq(orchestratorSessions.scopeId, session.folderId)
          )
        )
        .limit(1);
      folderOrchestrator = folderOrcs[0] || null;
    }

    // Find master orchestrator (for escalation)
    const masterOrcs = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, session.userId),
          eq(orchestratorSessions.type, "master")
        )
      )
      .limit(1);
    masterOrchestrator = masterOrcs[0] || null;

    // Update folder orchestrator activity (primary handler)
    // Wake and notify the orchestrator Claude Code session
    if (folderOrchestrator) {
      await db
        .update(orchestratorSessions)
        .set({
          lastActivityAt: timestamp,
          updatedAt: new Date(),
        })
        .where(eq(orchestratorSessions.id, folderOrchestrator.id));

      // Wake and notify the folder orchestrator (async, don't block response)
      wakeOrchestrator(folderOrchestrator.id).then(() =>
        notifyOrchestrator(folderOrchestrator.id, {
          type: payload.event,
          sessionId: session.id,
          sessionName: session.name ?? undefined,
          agent: payload.agent,
          context: payload.context,
        })
      ).catch((err) =>
        console.error(`[AgentEvent] Failed to notify folder orchestrator:`, err)
      );

      console.log(`[AgentEvent] Routed to folder orchestrator: ${folderOrchestrator.id}`);
    }

    // Escalate to Master Control for critical events
    const shouldEscalate = ESCALATION_EVENTS.includes(payload.event);
    if (shouldEscalate && masterOrchestrator) {
      await db
        .update(orchestratorSessions)
        .set({
          lastActivityAt: timestamp,
          updatedAt: new Date(),
        })
        .where(eq(orchestratorSessions.id, masterOrchestrator.id));

      // Wake and notify Master Control for escalation (async, don't block response)
      wakeOrchestrator(masterOrchestrator.id).then(() =>
        notifyOrchestrator(masterOrchestrator.id, {
          type: payload.event,
          sessionId: session.id,
          sessionName: session.name ?? undefined,
          agent: payload.agent,
          context: {
            ...payload.context,
            escalatedFrom: folderOrchestrator?.id,
          },
        })
      ).catch((err) =>
        console.error(`[AgentEvent] Failed to notify Master Control:`, err)
      );

      console.log(`[AgentEvent] Escalated to Master Control: ${payload.event}`);
    }

    // Log the event
    console.log(`[AgentEvent] ${payload.event} from ${payload.agent}`, {
      sessionId: session.id,
      sessionName: session.name,
      reason: payload.reason,
      timestamp: timestamp.toISOString(),
    });

    // Handle specific event types
    let intelligenceResult = null;

    switch (payload.event) {
      case "task_complete": {
        // Agent completed a task - analyze session and extract knowledge
        // This is the core intelligence feature
        if (session.tmuxSessionName && session.projectPath) {
          try {
            const { processTaskComplete } = await import("@/services/orchestrator-intelligence-service");

            const orchestratorType = folderOrchestrator ? "folder" : "master";

            intelligenceResult = await processTaskComplete(
              session.id,
              session.tmuxSessionName,
              session.projectPath,
              payload.agent,
              orchestratorType
            );

            console.log(`[AgentEvent] Intelligence analysis:`, intelligenceResult);
          } catch (error) {
            console.error(`[AgentEvent] Intelligence analysis failed:`, error);
          }
        }
        break;
      }

      case "session_end":
        // Agent session ended - could generate insight if unexpected
        console.log(`[AgentEvent] Agent ${payload.agent} session ended: ${payload.reason}`);
        break;

      case "error":
        // Agent error - could generate insight for user review
        console.log(`[AgentEvent] Agent ${payload.agent} error:`, payload.context?.lastMessage);
        break;

      case "stalled":
        // Agent self-reported stall - generate insight
        console.log(`[AgentEvent] Agent ${payload.agent} reported stall`);
        break;

      case "heartbeat":
      case "session_start":
      default:
        // Normal activity - just update timestamps (already done above)
        break;
    }

    return NextResponse.json({
      received: true,
      sessionFound: true,
      sessionId: session.id,
      event: payload.event,
      routing: {
        folderOrchestrator: folderOrchestrator?.id || null,
        masterOrchestrator: shouldEscalate ? masterOrchestrator?.id : null,
        escalated: shouldEscalate && !!masterOrchestrator,
      },
      intelligence: intelligenceResult,
    });

  } catch (error) {
    console.error("[AgentEvent] Error processing event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/orchestrators/agent-event
 *
 * Health check endpoint for hooks to verify connectivity
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "agent-event",
    supportedEvents: [
      "heartbeat",
      "session_start",
      "session_end",
      "task_complete",
      "error",
      "stalled",
    ],
    supportedAgents: ["claude", "codex", "gemini", "opencode"],
  });
}
