/**
 * Session - Domain entity representing a terminal session.
 *
 * This entity encapsulates the business logic for session lifecycle management.
 * It is immutable - state changes return a new Session instance.
 *
 * Invariants:
 * - A session must have a valid tmux session name
 * - A session must have a valid status
 * - State transitions must follow the state machine rules
 * - Active sessions must have a last activity timestamp
 */

import { SessionStatus } from "../value-objects/SessionStatus";
import { TmuxSessionName } from "../value-objects/TmuxSessionName";
import { InvalidValueError } from "../errors/DomainError";
import type { AgentProviderType } from "@/types/session";

export interface SessionProps {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: TmuxSessionName;
  status: SessionStatus;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  folderId: string | null;
  profileId: string | null;
  agentProvider: AgentProviderType | null;
  isOrchestratorSession: boolean;
  splitGroupId: string | null;
  splitOrder: number;
  splitSize: number;
  tabOrder: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionProps {
  id?: string;
  userId: string;
  name: string;
  projectPath?: string | null;
  githubRepoId?: string | null;
  worktreeBranch?: string | null;
  folderId?: string | null;
  profileId?: string | null;
  agentProvider?: AgentProviderType | null;
  isOrchestratorSession?: boolean;
  tabOrder?: number;
}

export class Session {
  private constructor(private readonly props: SessionProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Session.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.userId || typeof this.props.userId !== "string") {
      throw new InvalidValueError("Session.userId", this.props.userId, "Must be a non-empty string");
    }
    if (!this.props.name || typeof this.props.name !== "string") {
      throw new InvalidValueError("Session.name", this.props.name, "Must be a non-empty string");
    }
  }

  /**
   * Create a new Session with initial active status.
   */
  static create(props: CreateSessionProps): Session {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new Session({
      id,
      userId: props.userId,
      name: props.name,
      tmuxSessionName: TmuxSessionName.fromSessionId(id),
      status: SessionStatus.active(),
      projectPath: props.projectPath ?? null,
      githubRepoId: props.githubRepoId ?? null,
      worktreeBranch: props.worktreeBranch ?? null,
      folderId: props.folderId ?? null,
      profileId: props.profileId ?? null,
      agentProvider: props.agentProvider ?? null,
      isOrchestratorSession: props.isOrchestratorSession ?? false,
      splitGroupId: null,
      splitOrder: 0,
      splitSize: 100,
      tabOrder: props.tabOrder ?? 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute a Session from persisted data.
   * Used by repositories when loading from database.
   */
  static reconstitute(props: SessionProps): Session {
    return new Session(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters (expose read-only access to properties)
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get name(): string {
    return this.props.name;
  }

  get tmuxSessionName(): TmuxSessionName {
    return this.props.tmuxSessionName;
  }

  get status(): SessionStatus {
    return this.props.status;
  }

  get projectPath(): string | null {
    return this.props.projectPath;
  }

  get githubRepoId(): string | null {
    return this.props.githubRepoId;
  }

  get worktreeBranch(): string | null {
    return this.props.worktreeBranch;
  }

  get folderId(): string | null {
    return this.props.folderId;
  }

  get profileId(): string | null {
    return this.props.profileId;
  }

  get agentProvider(): AgentProviderType | null {
    return this.props.agentProvider;
  }

  get isOrchestratorSession(): boolean {
    return this.props.isOrchestratorSession;
  }

  get splitGroupId(): string | null {
    return this.props.splitGroupId;
  }

  get splitOrder(): number {
    return this.props.splitOrder;
  }

  get splitSize(): number {
    return this.props.splitSize;
  }

  get tabOrder(): number {
    return this.props.tabOrder;
  }

  get lastActivityAt(): Date {
    return this.props.lastActivityAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods (state transitions and business logic)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Suspend this session.
   * @throws InvalidStateTransitionError if not in active state
   */
  suspend(): Session {
    this.props.status.validateTransitionTo(SessionStatus.suspended(), "suspend");
    return this.withUpdates({
      status: SessionStatus.suspended(),
    });
  }

  /**
   * Resume this session from suspended state.
   * @throws InvalidStateTransitionError if not in suspended state
   */
  resume(): Session {
    this.props.status.validateTransitionTo(SessionStatus.active(), "resume");
    return this.withUpdates({
      status: SessionStatus.active(),
      lastActivityAt: new Date(),
    });
  }

  /**
   * Close this session permanently.
   * @throws InvalidStateTransitionError if already closed or trashed
   */
  close(): Session {
    this.props.status.validateTransitionTo(SessionStatus.closed(), "close");
    return this.withUpdates({
      status: SessionStatus.closed(),
    });
  }

  /**
   * Move this session to trash.
   * @throws InvalidStateTransitionError if already trashed
   */
  trash(): Session {
    this.props.status.validateTransitionTo(SessionStatus.trashed(), "trash");
    return this.withUpdates({
      status: SessionStatus.trashed(),
    });
  }

  /**
   * Update the session name.
   */
  rename(newName: string): Session {
    if (!newName || typeof newName !== "string" || !newName.trim()) {
      throw new InvalidValueError("name", newName, "Must be a non-empty string");
    }
    return this.withUpdates({ name: newName.trim() });
  }

  /**
   * Move session to a folder.
   */
  moveToFolder(folderId: string | null): Session {
    return this.withUpdates({ folderId });
  }

  /**
   * Remove session from its current folder.
   */
  removeFromFolder(): Session {
    return this.withUpdates({ folderId: null });
  }

  /**
   * Update tab order.
   */
  setTabOrder(tabOrder: number): Session {
    return this.withUpdates({ tabOrder });
  }

  /**
   * Update project path.
   */
  setProjectPath(projectPath: string | null): Session {
    return this.withUpdates({ projectPath });
  }

  /**
   * Record activity (updates lastActivityAt).
   */
  recordActivity(): Session {
    return this.withUpdates({ lastActivityAt: new Date() });
  }

  /**
   * Add to a split group.
   */
  addToSplit(splitGroupId: string, order: number, size: number): Session {
    return this.withUpdates({ splitGroupId, splitOrder: order, splitSize: size });
  }

  /**
   * Remove from split group.
   */
  removeFromSplit(): Session {
    return this.withUpdates({ splitGroupId: null, splitOrder: 0, splitSize: 100 });
  }

  /**
   * Update split size.
   */
  setSplitSize(size: number): Session {
    return this.withUpdates({ splitSize: size });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if session is currently active (running) */
  isActive(): boolean {
    return this.props.status.isActive();
  }

  /** Check if session is suspended */
  isSuspended(): boolean {
    return this.props.status.isSuspended();
  }

  /** Check if session is closed */
  isClosed(): boolean {
    return this.props.status.isClosed();
  }

  /** Check if session has a worktree */
  hasWorktree(): boolean {
    return this.props.worktreeBranch !== null;
  }

  /** Check if session is in a split group */
  isInSplit(): boolean {
    return this.props.splitGroupId !== null;
  }

  /** Check if session belongs to specified user */
  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  /**
   * Check if this session equals another by comparing all meaningful fields.
   * Ignores updatedAt for comparison since it changes on every modification.
   * Useful for testing.
   */
  equals(other: Session): boolean {
    return (
      this.id === other.id &&
      this.userId === other.userId &&
      this.name === other.name &&
      this.tmuxSessionName.toString() === other.tmuxSessionName.toString() &&
      this.status.toString() === other.status.toString() &&
      this.projectPath === other.projectPath &&
      this.githubRepoId === other.githubRepoId &&
      this.worktreeBranch === other.worktreeBranch &&
      this.folderId === other.folderId &&
      this.profileId === other.profileId &&
      this.agentProvider === other.agentProvider &&
      this.splitGroupId === other.splitGroupId &&
      this.splitOrder === other.splitOrder &&
      this.splitSize === other.splitSize &&
      this.tabOrder === other.tabOrder
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new Session with updates applied.
   * Note: updatedAt is automatically set to now. For testing, compare sessions
   * using the equals() method which ignores timestamps.
   */
  private withUpdates(updates: Partial<SessionProps>): Session {
    return new Session({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   * Used by mappers when persisting to database.
   */
  toPlainObject(): Omit<SessionProps, "tmuxSessionName" | "status"> & {
    tmuxSessionName: string;
    status: string;
  } {
    const { tmuxSessionName, status, ...rest } = this.props;
    return {
      ...rest,
      tmuxSessionName: tmuxSessionName.toString(),
      status: status.toString(),
    };
  }
}
