/**
 * Episode Recorder Service - Record task executions as episodes
 *
 * Tracks actions, decisions, and outcomes during task execution
 * to create episodic memories for future learning.
 */

import {
  Episode,
  EpisodeBuilder,
  type EpisodeType,
  type EpisodeOutcome,
  type EpisodeReflection,
  type TrajectoryStep,
  type Decision,
  type Pivot,
} from "@/domain/entities/Episode";
import { getEpisodeStore, type EpisodeStore } from "@/infrastructure/vector/episode-store";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordingSession {
  id: string;
  taskId: string;
  folderId: string;
  builder: EpisodeBuilder;
  isActive: boolean;
  startedAt: Date;
}

export interface ActionRecord {
  action: string;
  tool?: string;
  input?: string;
  output?: string;
  duration: number;
  success: boolean;
}

export interface DecisionRecord {
  context: string;
  options: string[];
  chosen: string;
  reasoning: string;
}

export interface PivotRecord {
  fromApproach: string;
  toApproach: string;
  reason: string;
  triggered_by: "error" | "feedback" | "discovery" | "timeout";
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class EpisodeRecorderService {
  private sessions: Map<string, RecordingSession> = new Map();
  private episodeStore: EpisodeStore;

  constructor(folderId?: string) {
    this.episodeStore = getEpisodeStore(folderId);
  }

  /**
   * Start recording a new episode.
   */
  startRecording(
    taskId: string,
    folderId: string,
    type: EpisodeType = "task_execution"
  ): string {
    const sessionId = crypto.randomUUID();
    const builder = new EpisodeBuilder(taskId, folderId, type);

    this.sessions.set(sessionId, {
      id: sessionId,
      taskId,
      folderId,
      builder,
      isActive: true,
      startedAt: new Date(),
    });

    return sessionId;
  }

  /**
   * Set context for the recording.
   */
  setContext(
    sessionId: string,
    context: {
      taskDescription: string;
      projectPath?: string;
      initialState?: string;
      agentProvider?: string;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    session.builder.setContext(context);
  }

  /**
   * Record an action taken during task execution.
   */
  recordAction(sessionId: string, action: ActionRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    session.builder.addAction({
      action: action.action,
      tool: action.tool,
      input: action.input,
      output: action.output,
      duration: action.duration,
      success: action.success,
    });
  }

  /**
   * Record an observation made during task execution.
   */
  recordObservation(sessionId: string, observation: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    session.builder.addObservation(observation);
  }

  /**
   * Record a decision made during task execution.
   */
  recordDecision(sessionId: string, decision: DecisionRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    session.builder.addDecision(decision);
  }

  /**
   * Record a pivot/approach change.
   */
  recordPivot(sessionId: string, pivot: PivotRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    session.builder.addPivot(pivot);
  }

  /**
   * Complete the recording and store the episode.
   */
  async completeRecording(
    sessionId: string,
    outcome: EpisodeOutcome,
    result: string,
    reflection: EpisodeReflection,
    tags: string[] = []
  ): Promise<Episode> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Recording session ${sessionId} not found or inactive`);
    }

    // Build the episode
    const episode = session.builder.build(outcome, result, reflection, tags);

    // Store in vector database
    await this.episodeStore.store(episode);

    // Mark session as inactive
    session.isActive = false;

    return episode;
  }

  /**
   * Cancel a recording session.
   */
  cancelRecording(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get active recording sessions.
   */
  getActiveSessions(): RecordingSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.isActive);
  }

  /**
   * Check if a session is active.
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.isActive ?? false;
  }

  /**
   * Get session by ID.
   */
  getSession(sessionId: string): RecordingSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Clean up inactive sessions.
   */
  cleanupInactiveSessions(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (!session.isActive && session.startedAt.getTime() < cutoff) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Generate reflection from trajectory analysis.
   */
  analyzeForReflection(sessionId: string): Partial<EpisodeReflection> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {};
    }

    // Access builder's internal state (would need to expose in EpisodeBuilder)
    // For now, return empty - this would analyze the trajectory
    return {
      whatWorked: [],
      whatFailed: [],
      keyInsights: [],
    };
  }

  /**
   * Record a quick episode without detailed tracking.
   */
  async recordQuickEpisode(params: {
    taskId: string;
    folderId: string;
    type: EpisodeType;
    taskDescription: string;
    outcome: EpisodeOutcome;
    result: string;
    reflection: EpisodeReflection;
    tags?: string[];
    duration?: number;
    agentProvider?: string;
  }): Promise<Episode> {
    const sessionId = this.startRecording(params.taskId, params.folderId, params.type);

    this.setContext(sessionId, {
      taskDescription: params.taskDescription,
      agentProvider: params.agentProvider,
    });

    return this.completeRecording(
      sessionId,
      params.outcome,
      params.result,
      params.reflection,
      params.tags
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const recorderCache = new Map<string, EpisodeRecorderService>();

export function getEpisodeRecorder(folderId?: string): EpisodeRecorderService {
  const key = folderId || "global";

  if (!recorderCache.has(key)) {
    recorderCache.set(key, new EpisodeRecorderService(folderId));
  }

  return recorderCache.get(key)!;
}

export { EpisodeRecorderService };
