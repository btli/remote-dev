/**
 * SessionMapper - Maps between database records and Session domain entity.
 *
 * This mapper handles the conversion of:
 * - Database records (from Drizzle queries) → Session domain entities
 * - Session domain entities → Database record format (for inserts/updates)
 */

import { Session, type SessionProps } from "@/domain/entities/Session";
import { SessionStatus } from "@/domain/value-objects/SessionStatus";
import { TmuxSessionName } from "@/domain/value-objects/TmuxSessionName";
import type { AgentProviderType, WorktreeType } from "@/types/session";
import type { TerminalType, AgentExitState } from "@/types/terminal-type";

/**
 * Raw database record type from Drizzle query results.
 * Fields use loose types (string | null) because SQLite returns raw strings
 * that must be cast to domain types in the mapper.
 */
export interface SessionDbRecord {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  worktreeType: string | null;
  projectId: string | null;
  profileId: string | null;
  terminalType: string | null;
  agentProvider: string | null;
  agentExitState: string | null;
  agentExitCode: number | null;
  agentExitedAt: Date | string | null;
  agentRestartCount: number | null;
  agentActivityStatus: string | null;
  typeMetadata: string | null;
  parentSessionId: string | null;
  status: string;
  pinned: boolean | number | null;
  tabOrder: number;
  lastActivityAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Format for database insert/update operations.
 * Uses typed unions (WorktreeType, TerminalType, etc.) matching the Drizzle schema,
 * unlike SessionDbRecord which returns raw strings from SQLite.
 */
export interface SessionDbInsert {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  worktreeType: WorktreeType | null;
  projectId: string | null;
  profileId: string | null;
  terminalType: TerminalType;
  agentProvider: AgentProviderType | null;
  agentExitState: AgentExitState | null;
  agentExitCode: number | null;
  agentExitedAt: Date | null;
  agentRestartCount: number;
  agentActivityStatus: string | null;
  typeMetadata: string | null;
  parentSessionId: string | null;
  status: "active" | "suspended" | "closed" | "trashed";
  pinned: boolean;
  tabOrder: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionMapper {
  /**
   * Convert a database record to a Session domain entity.
   */
  static toDomain(record: SessionDbRecord): Session {
    const props: SessionProps = {
      id: record.id,
      userId: record.userId,
      name: record.name,
      tmuxSessionName: TmuxSessionName.fromString(record.tmuxSessionName),
      status: SessionStatus.fromString(record.status),
      projectPath: record.projectPath,
      githubRepoId: record.githubRepoId,
      worktreeBranch: record.worktreeBranch,
      worktreeType: record.worktreeType ?? null,
      projectId: record.projectId,
      profileId: record.profileId,
      terminalType: (record.terminalType as TerminalType) ?? "shell",
      agentProvider: (record.agentProvider as AgentProviderType) ?? null,
      agentExitState: (record.agentExitState as AgentExitState) ?? null,
      agentExitCode: record.agentExitCode ?? null,
      agentExitedAt: record.agentExitedAt ? toDate(record.agentExitedAt) : null,
      agentRestartCount: record.agentRestartCount ?? 0,
      agentActivityStatus: record.agentActivityStatus ?? null,
      typeMetadata: record.typeMetadata ? JSON.parse(record.typeMetadata) : null,
      parentSessionId: record.parentSessionId ?? null,
      pinned: !!record.pinned,
      tabOrder: record.tabOrder,
      lastActivityAt: toDate(record.lastActivityAt),
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
    };

    return Session.reconstitute(props);
  }

  /**
   * Convert multiple database records to Session domain entities.
   */
  static toDomainMany(records: SessionDbRecord[]): Session[] {
    return records.map((r) => SessionMapper.toDomain(r));
  }

  /**
   * Convert a Session domain entity to database insert format.
   */
  static toPersistence(session: Session): SessionDbInsert {
    return {
      id: session.id,
      userId: session.userId,
      name: session.name,
      tmuxSessionName: session.tmuxSessionName.toString(),
      projectPath: session.projectPath,
      githubRepoId: session.githubRepoId,
      worktreeBranch: session.worktreeBranch,
      // Cast is safe because Session.worktreeType only holds values set via WorktreeType-typed inputs
      worktreeType: (session.worktreeType as WorktreeType) ?? null,
      projectId: session.projectId,
      profileId: session.profileId,
      terminalType: session.terminalType,
      agentProvider: session.agentProvider,
      agentExitState: session.agentExitState,
      agentExitCode: session.agentExitCode,
      agentExitedAt: session.agentExitedAt,
      agentRestartCount: session.agentRestartCount,
      agentActivityStatus: session.agentActivityStatus,
      typeMetadata: session.typeMetadata ? JSON.stringify(session.typeMetadata) : null,
      parentSessionId: session.parentSessionId,
      // Cast is safe because SessionStatus.toString() only returns valid status values
      status: session.status.toString() as SessionDbInsert["status"],
      pinned: session.pinned,
      tabOrder: session.tabOrder,
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Convert a Session to the TerminalSession API type.
   * Used for backward compatibility with existing API responses.
   */
  static toApiResponse(session: Session): {
    id: string;
    userId: string;
    name: string;
    tmuxSessionName: string;
    projectPath: string | null;
    githubRepoId: string | null;
    worktreeBranch: string | null;
    worktreeType: string | null;
    projectId: string | null;
    profileId: string | null;
    terminalType: TerminalType;
    agentProvider: AgentProviderType | null;
    agentExitState: AgentExitState | null;
    agentExitCode: number | null;
    agentExitedAt: Date | null;
    agentRestartCount: number;
    agentActivityStatus: string | null;
    typeMetadata: Record<string, unknown> | null;
    parentSessionId: string | null;
    status: string;
    pinned: boolean;
    tabOrder: number;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: session.id,
      userId: session.userId,
      name: session.name,
      tmuxSessionName: session.tmuxSessionName.toString(),
      projectPath: session.projectPath,
      githubRepoId: session.githubRepoId,
      worktreeBranch: session.worktreeBranch,
      worktreeType: session.worktreeType ?? null,
      projectId: session.projectId,
      profileId: session.profileId,
      terminalType: session.terminalType,
      agentProvider: session.agentProvider,
      agentExitState: session.agentExitState,
      agentExitCode: session.agentExitCode,
      agentExitedAt: session.agentExitedAt,
      agentRestartCount: session.agentRestartCount,
      agentActivityStatus: session.agentActivityStatus,
      typeMetadata: session.typeMetadata,
      parentSessionId: session.parentSessionId,
      status: session.status.toString(),
      pinned: session.pinned,
      tabOrder: session.tabOrder,
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}

/**
 * Helper to convert string or Date to Date.
 * Drizzle may return dates as strings depending on driver.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}
