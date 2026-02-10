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
import { generateUUID } from "../utils/uuid";
import type { AgentProviderType, TerminalType, AgentExitState } from "../types";

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
  terminalType: TerminalType;
  agentProvider: AgentProviderType | null;
  agentExitState: AgentExitState | null;
  agentExitCode: number | null;
  agentExitedAt: Date | null;
  agentRestartCount: number;
  typeMetadata: Record<string, unknown> | null;
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
  terminalType?: TerminalType;
  agentProvider?: AgentProviderType | null;
  typeMetadata?: Record<string, unknown> | null;
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
    const id = props.id ?? generateUUID();
    const now = new Date();
    const terminalType = props.terminalType ?? "shell";

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
      terminalType,
      agentProvider: props.agentProvider ?? null,
      agentExitState: terminalType === "agent" ? "running" : null,
      agentExitCode: null,
      agentExitedAt: null,
      agentRestartCount: 0,
      typeMetadata: props.typeMetadata ?? null,
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
   */
  static reconstitute(props: SessionProps): Session {
    return new Session(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
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

  get terminalType(): TerminalType {
    return this.props.terminalType;
  }

  get agentProvider(): AgentProviderType | null {
    return this.props.agentProvider;
  }

  get agentExitState(): AgentExitState | null {
    return this.props.agentExitState;
  }

  get agentExitCode(): number | null {
    return this.props.agentExitCode;
  }

  get agentExitedAt(): Date | null {
    return this.props.agentExitedAt;
  }

  get agentRestartCount(): number {
    return this.props.agentRestartCount;
  }

  get typeMetadata(): Record<string, unknown> | null {
    return this.props.typeMetadata;
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
  // Domain Methods
  // ─────────────────────────────────────────────────────────────────────────────

  suspend(): Session {
    this.props.status.validateTransitionTo(SessionStatus.suspended(), "suspend");
    return this.withUpdates({ status: SessionStatus.suspended() });
  }

  resume(): Session {
    this.props.status.validateTransitionTo(SessionStatus.active(), "resume");
    return this.withUpdates({
      status: SessionStatus.active(),
      lastActivityAt: new Date(),
    });
  }

  close(): Session {
    this.props.status.validateTransitionTo(SessionStatus.closed(), "close");
    return this.withUpdates({ status: SessionStatus.closed() });
  }

  trash(): Session {
    this.props.status.validateTransitionTo(SessionStatus.trashed(), "trash");
    return this.withUpdates({ status: SessionStatus.trashed() });
  }

  rename(newName: string): Session {
    if (!newName || typeof newName !== "string" || !newName.trim()) {
      throw new InvalidValueError("name", newName, "Must be a non-empty string");
    }
    return this.withUpdates({ name: newName.trim() });
  }

  moveToFolder(folderId: string | null): Session {
    return this.withUpdates({ folderId });
  }

  removeFromFolder(): Session {
    return this.withUpdates({ folderId: null });
  }

  setTabOrder(tabOrder: number): Session {
    return this.withUpdates({ tabOrder });
  }

  setProjectPath(projectPath: string | null): Session {
    return this.withUpdates({ projectPath });
  }

  recordActivity(): Session {
    return this.withUpdates({ lastActivityAt: new Date() });
  }

  addToSplit(splitGroupId: string, order: number, size: number): Session {
    return this.withUpdates({ splitGroupId, splitOrder: order, splitSize: size });
  }

  removeFromSplit(): Session {
    return this.withUpdates({ splitGroupId: null, splitOrder: 0, splitSize: 100 });
  }

  setSplitSize(size: number): Session {
    return this.withUpdates({ splitSize: size });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent State Methods
  // ─────────────────────────────────────────────────────────────────────────────

  markAgentExited(exitCode: number | null): Session {
    if (this.props.terminalType !== "agent") {
      throw new InvalidValueError("terminalType", this.props.terminalType, "Must be 'agent' to mark as exited");
    }
    return this.withUpdates({
      agentExitState: "exited",
      agentExitCode: exitCode,
      agentExitedAt: new Date(),
    });
  }

  markAgentRestarting(): Session {
    if (this.props.terminalType !== "agent") {
      throw new InvalidValueError("terminalType", this.props.terminalType, "Must be 'agent' to mark as restarting");
    }
    return this.withUpdates({
      agentExitState: "restarting",
      agentRestartCount: this.props.agentRestartCount + 1,
    });
  }

  markAgentRunning(): Session {
    if (this.props.terminalType !== "agent") {
      throw new InvalidValueError("terminalType", this.props.terminalType, "Must be 'agent' to mark as running");
    }
    return this.withUpdates({
      agentExitState: "running",
      agentExitCode: null,
      agentExitedAt: null,
    });
  }

  markAgentClosed(): Session {
    if (this.props.terminalType !== "agent") {
      throw new InvalidValueError("terminalType", this.props.terminalType, "Must be 'agent' to mark as closed");
    }
    return this.withUpdates({ agentExitState: "closed" });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  isActive(): boolean {
    return this.props.status.isActive();
  }

  isSuspended(): boolean {
    return this.props.status.isSuspended();
  }

  isClosed(): boolean {
    return this.props.status.isClosed();
  }

  hasWorktree(): boolean {
    return this.props.worktreeBranch !== null;
  }

  isInSplit(): boolean {
    return this.props.splitGroupId !== null;
  }

  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

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
      this.terminalType === other.terminalType &&
      this.agentProvider === other.agentProvider &&
      this.agentExitState === other.agentExitState &&
      this.agentExitCode === other.agentExitCode &&
      this.agentRestartCount === other.agentRestartCount &&
      this.splitGroupId === other.splitGroupId &&
      this.splitOrder === other.splitOrder &&
      this.splitSize === other.splitSize &&
      this.tabOrder === other.tabOrder
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<SessionProps>): Session {
    return new Session({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

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
