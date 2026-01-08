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
import type { AgentProviderType } from "@/types/session";

/**
 * Raw database record type from Drizzle query.
 * This matches the terminalSessions schema.
 */
export interface SessionDbRecord {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  folderId: string | null;
  profileId: string | null;
  agentProvider: string | null;
  isOrchestratorSession: boolean;
  splitGroupId: string | null;
  splitOrder: number | null;
  splitSize: number | null;
  status: string;
  tabOrder: number;
  lastActivityAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Format for database insert/update operations.
 * Uses the exact types expected by Drizzle schema.
 */
export interface SessionDbInsert {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
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
  status: "active" | "suspended" | "closed" | "trashed";
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
      folderId: record.folderId,
      profileId: record.profileId,
      agentProvider: (record.agentProvider as AgentProviderType) ?? null,
      isOrchestratorSession: record.isOrchestratorSession,
      splitGroupId: record.splitGroupId,
      splitOrder: record.splitOrder ?? 0,
      splitSize: record.splitSize ?? 100,
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
      folderId: session.folderId,
      profileId: session.profileId,
      agentProvider: session.agentProvider,
      isOrchestratorSession: session.isOrchestratorSession,
      splitGroupId: session.splitGroupId,
      splitOrder: session.splitOrder,
      splitSize: session.splitSize,
      // Cast is safe because SessionStatus.toString() only returns valid status values
      status: session.status.toString() as SessionDbInsert["status"],
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
    folderId: string | null;
    profileId: string | null;
    agentProvider: AgentProviderType | null;
    isOrchestratorSession: boolean;
    splitGroupId: string | null;
    splitOrder: number;
    splitSize: number;
    status: string;
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
      folderId: session.folderId,
      profileId: session.profileId,
      agentProvider: session.agentProvider,
      isOrchestratorSession: session.isOrchestratorSession,
      splitGroupId: session.splitGroupId,
      splitOrder: session.splitOrder,
      splitSize: session.splitSize,
      status: session.status.toString(),
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
