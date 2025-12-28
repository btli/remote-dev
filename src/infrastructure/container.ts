/**
 * Dependency Injection Container
 *
 * This module provides singleton instances of repositories, gateways, and use cases.
 * In a larger application, you might use a proper DI container like tsyringe or inversify.
 *
 * For Next.js, we use simple module-level singletons since the module system
 * ensures only one instance is created per server process.
 */

import { DrizzleSessionRepository } from "./persistence/repositories/DrizzleSessionRepository";
import { DrizzleFolderRepository } from "./persistence/repositories/DrizzleFolderRepository";
import { TmuxGatewayImpl } from "./external/tmux/TmuxGatewayImpl";
import { WorktreeGatewayImpl } from "./external/worktree/WorktreeGatewayImpl";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { WorktreeGateway } from "@/application/ports/WorktreeGateway";

// Session Use Cases
import { CreateSessionUseCase } from "@/application/use-cases/session/CreateSessionUseCase";
import { SuspendSessionUseCase } from "@/application/use-cases/session/SuspendSessionUseCase";
import { ResumeSessionUseCase } from "@/application/use-cases/session/ResumeSessionUseCase";
import { CloseSessionUseCase } from "@/application/use-cases/session/CloseSessionUseCase";
import { ListSessionsUseCase } from "@/application/use-cases/session/ListSessionsUseCase";
import { GetSessionUseCase } from "@/application/use-cases/session/GetSessionUseCase";
import { UpdateSessionUseCase } from "@/application/use-cases/session/UpdateSessionUseCase";
import { MoveSessionToFolderUseCase } from "@/application/use-cases/session/MoveSessionToFolderUseCase";

// Folder Use Cases
import { CreateFolderUseCase } from "@/application/use-cases/folder/CreateFolderUseCase";
import { UpdateFolderUseCase } from "@/application/use-cases/folder/UpdateFolderUseCase";
import { MoveFolderUseCase } from "@/application/use-cases/folder/MoveFolderUseCase";
import { DeleteFolderUseCase } from "@/application/use-cases/folder/DeleteFolderUseCase";
import { ReorderFoldersUseCase } from "@/application/use-cases/folder/ReorderFoldersUseCase";
import { ListFoldersUseCase } from "@/application/use-cases/folder/ListFoldersUseCase";

// Tmux Use Cases
import {
  ListTmuxSystemSessionsUseCase,
  KillTmuxSessionUseCase,
  KillOrphanedSessionsUseCase,
} from "@/application/use-cases/tmux";

// ─────────────────────────────────────────────────────────────────────────────
// Repository Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const sessionRepository: SessionRepository = new DrizzleSessionRepository();

/**
 * Folder repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const folderRepository: FolderRepository = new DrizzleFolderRepository();

// ─────────────────────────────────────────────────────────────────────────────
// Gateway Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tmux gateway instance.
 * Wraps the existing TmuxService.
 */
export const tmuxGateway: TmuxGateway = new TmuxGatewayImpl();

/**
 * Worktree gateway instance.
 * Wraps the existing WorktreeService.
 */
export const worktreeGateway: WorktreeGateway = new WorktreeGatewayImpl();

// ─────────────────────────────────────────────────────────────────────────────
// Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create session use case.
 */
export const createSessionUseCase = new CreateSessionUseCase(
  sessionRepository,
  tmuxGateway,
  worktreeGateway
);

/**
 * Suspend session use case.
 */
export const suspendSessionUseCase = new SuspendSessionUseCase(
  sessionRepository,
  tmuxGateway
);

/**
 * Resume session use case.
 */
export const resumeSessionUseCase = new ResumeSessionUseCase(
  sessionRepository,
  tmuxGateway
);

/**
 * Close session use case.
 */
export const closeSessionUseCase = new CloseSessionUseCase(
  sessionRepository,
  tmuxGateway
);

/**
 * List sessions use case.
 */
export const listSessionsUseCase = new ListSessionsUseCase(sessionRepository);

/**
 * Get session use case.
 */
export const getSessionUseCase = new GetSessionUseCase(sessionRepository);

/**
 * Update session use case.
 */
export const updateSessionUseCase = new UpdateSessionUseCase(sessionRepository);

/**
 * Move session to folder use case.
 */
export const moveSessionToFolderUseCase = new MoveSessionToFolderUseCase(
  sessionRepository,
  folderRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Folder Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create folder use case.
 */
export const createFolderUseCase = new CreateFolderUseCase(folderRepository);

/**
 * Update folder use case.
 */
export const updateFolderUseCase = new UpdateFolderUseCase(folderRepository);

/**
 * Move folder use case.
 */
export const moveFolderUseCase = new MoveFolderUseCase(folderRepository);

/**
 * Delete folder use case.
 */
export const deleteFolderUseCase = new DeleteFolderUseCase(
  folderRepository,
  sessionRepository
);

/**
 * Reorder folders use case.
 */
export const reorderFoldersUseCase = new ReorderFoldersUseCase(folderRepository);

/**
 * List folders use case.
 */
export const listFoldersUseCase = new ListFoldersUseCase(
  folderRepository,
  sessionRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Tmux Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List tmux system sessions use case.
 */
export const listTmuxSystemSessionsUseCase = new ListTmuxSystemSessionsUseCase(
  tmuxGateway,
  sessionRepository
);

/**
 * Kill tmux session use case.
 */
export const killTmuxSessionUseCase = new KillTmuxSessionUseCase(tmuxGateway);

/**
 * Kill orphaned sessions use case.
 */
export const killOrphanedSessionsUseCase = new KillOrphanedSessionsUseCase(
  tmuxGateway,
  sessionRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Container type for dependency injection.
 * Useful for creating test doubles.
 */
export interface Container {
  sessionRepository: SessionRepository;
  folderRepository: FolderRepository;
  tmuxGateway: TmuxGateway;
  worktreeGateway: WorktreeGateway;
}

/**
 * Default container with production implementations.
 */
export const defaultContainer: Container = {
  sessionRepository,
  folderRepository,
  tmuxGateway,
  worktreeGateway,
};

/**
 * Create a container with overrides for testing.
 *
 * @example
 * ```typescript
 * const mockSessionRepo = { findById: vi.fn() };
 * const testContainer = createTestContainer({ sessionRepository: mockSessionRepo });
 * ```
 */
export function createTestContainer(
  overrides: Partial<Container> = {}
): Container {
  return {
    ...defaultContainer,
    ...overrides,
  };
}
