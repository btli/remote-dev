/**
 * Delegation - Domain entity representing the execution of a task by an agent.
 *
 * A Delegation links a Task to a Session and optionally a Worktree.
 * It tracks the execution lifecycle including context injection, logs, and results.
 *
 * This entity is immutable - state changes return a new Delegation instance.
 *
 * Invariants:
 * - A delegation must be linked to a task
 * - A delegation must be linked to a session
 * - A delegation must have a valid agent provider
 */

import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";
import type { AgentProviderType } from "@/types/session";

const VALID_STATUSES = [
  "spawning",
  "injecting_context",
  "running",
  "monitoring",
  "completed",
  "failed",
] as const;
type DelegationStatusValue = (typeof VALID_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<DelegationStatusValue, DelegationStatusValue[]> = {
  spawning: ["injecting_context", "failed"],
  injecting_context: ["running", "failed"],
  running: ["monitoring", "completed", "failed"],
  monitoring: ["completed", "failed"],
  completed: [],
  failed: [],
};

export interface DelegationProps {
  id: string;
  taskId: string;
  sessionId: string;
  worktreeId: string | null;
  agentProvider: AgentProviderType;
  status: DelegationStatusValue;
  contextInjected: string | null;
  executionLogs: LogEntry[];
  result: DelegationResult | null;
  error: DelegationError | null;
  transcriptPath: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface LogEntry {
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface DelegationResult {
  success: boolean;
  summary: string;
  exitCode: number | null;
  filesModified: string[];
  duration: number; // seconds
  tokenUsage: number | null;
}

export interface DelegationError {
  code: string;
  message: string;
  exitCode: number | null;
  recoverable: boolean;
}

export interface CreateDelegationProps {
  id?: string;
  taskId: string;
  sessionId: string;
  worktreeId?: string | null;
  agentProvider: AgentProviderType;
}

export class Delegation {
  private constructor(private readonly props: DelegationProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Delegation.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.taskId || typeof this.props.taskId !== "string") {
      throw new InvalidValueError(
        "Delegation.taskId",
        this.props.taskId,
        "Must be a non-empty string"
      );
    }
    if (!this.props.sessionId || typeof this.props.sessionId !== "string") {
      throw new InvalidValueError(
        "Delegation.sessionId",
        this.props.sessionId,
        "Must be a non-empty string"
      );
    }
    if (!this.props.agentProvider) {
      throw new InvalidValueError(
        "Delegation.agentProvider",
        this.props.agentProvider,
        "Must be a valid agent provider"
      );
    }
  }

  /**
   * Create a new Delegation with initial spawning status.
   */
  static create(props: CreateDelegationProps): Delegation {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new Delegation({
      id,
      taskId: props.taskId,
      sessionId: props.sessionId,
      worktreeId: props.worktreeId ?? null,
      agentProvider: props.agentProvider,
      status: "spawning",
      contextInjected: null,
      executionLogs: [],
      result: null,
      error: null,
      transcriptPath: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  }

  /**
   * Reconstitute a Delegation from persisted data.
   */
  static reconstitute(props: DelegationProps): Delegation {
    return new Delegation(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get taskId(): string {
    return this.props.taskId;
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get worktreeId(): string | null {
    return this.props.worktreeId;
  }

  get agentProvider(): AgentProviderType {
    return this.props.agentProvider;
  }

  get status(): DelegationStatusValue {
    return this.props.status;
  }

  get contextInjected(): string | null {
    return this.props.contextInjected;
  }

  get executionLogs(): LogEntry[] {
    return [...this.props.executionLogs];
  }

  get result(): DelegationResult | null {
    return this.props.result;
  }

  get error(): DelegationError | null {
    return this.props.error;
  }

  get transcriptPath(): string | null {
    return this.props.transcriptPath;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get completedAt(): Date | null {
    return this.props.completedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods (state transitions)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start context injection.
   */
  startContextInjection(context: string): Delegation {
    this.validateTransition("injecting_context", "startContextInjection");
    return this.withUpdates({
      status: "injecting_context",
      contextInjected: context,
    });
  }

  /**
   * Mark as running (agent is executing).
   */
  startRunning(): Delegation {
    this.validateTransition("running", "startRunning");
    return this.withUpdates({
      status: "running",
    });
  }

  /**
   * Start monitoring phase.
   */
  startMonitoring(): Delegation {
    this.validateTransition("monitoring", "startMonitoring");
    return this.withUpdates({
      status: "monitoring",
    });
  }

  /**
   * Mark as completed successfully.
   */
  complete(result: DelegationResult): Delegation {
    this.validateTransition("completed", "complete");
    return this.withUpdates({
      status: "completed",
      result,
      completedAt: new Date(),
    });
  }

  /**
   * Mark as failed.
   */
  fail(error: DelegationError): Delegation {
    this.validateTransition("failed", "fail");
    return this.withUpdates({
      status: "failed",
      error,
      completedAt: new Date(),
    });
  }

  /**
   * Add a log entry.
   */
  addLog(entry: Omit<LogEntry, "timestamp">): Delegation {
    const newLog: LogEntry = {
      ...entry,
      timestamp: new Date(),
    };
    return this.withUpdates({
      executionLogs: [...this.props.executionLogs, newLog],
    });
  }

  /**
   * Set the transcript path after session ends.
   */
  setTranscriptPath(path: string): Delegation {
    return this.withUpdates({
      transcriptPath: path,
    });
  }

  /**
   * Attach a worktree.
   */
  attachWorktree(worktreeId: string): Delegation {
    return this.withUpdates({
      worktreeId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if delegation is in a terminal state */
  isTerminal(): boolean {
    return this.props.status === "completed" || this.props.status === "failed";
  }

  /** Check if delegation is actively running */
  isRunning(): boolean {
    return this.props.status === "running" || this.props.status === "monitoring";
  }

  /** Check if delegation has a worktree */
  hasWorktree(): boolean {
    return this.props.worktreeId !== null;
  }

  /** Check if delegation has a transcript */
  hasTranscript(): boolean {
    return this.props.transcriptPath !== null;
  }

  /** Check if delegation completed successfully */
  isSuccessful(): boolean {
    return this.props.status === "completed" && this.props.result?.success === true;
  }

  /** Get duration in seconds (if completed) */
  getDuration(): number | null {
    if (!this.props.completedAt) return null;
    return Math.floor((this.props.completedAt.getTime() - this.props.createdAt.getTime()) / 1000);
  }

  /** Get log entries by level */
  getLogsByLevel(level: LogEntry["level"]): LogEntry[] {
    return this.props.executionLogs.filter((log) => log.level === level);
  }

  /** Get error logs */
  getErrors(): LogEntry[] {
    return this.getLogsByLevel("error");
  }

  /** Check if this delegation equals another */
  equals(other: Delegation): boolean {
    return (
      this.id === other.id &&
      this.taskId === other.taskId &&
      this.sessionId === other.sessionId &&
      this.status === other.status
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private validateTransition(target: DelegationStatusValue, action: string): void {
    if (!ALLOWED_TRANSITIONS[this.props.status].includes(target)) {
      throw new InvalidStateTransitionError(
        action,
        this.props.status,
        ALLOWED_TRANSITIONS[this.props.status]
      );
    }
  }

  private withUpdates(updates: Partial<DelegationProps>): Delegation {
    return new Delegation({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): DelegationProps {
    return { ...this.props };
  }
}
