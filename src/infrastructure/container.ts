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
import { DrizzleGitHubIssueRepository } from "./persistence/repositories/DrizzleGitHubIssueRepository";
import { DrizzleOrchestratorRepository } from "./persistence/repositories/DrizzleOrchestratorRepository";
import { DrizzleInsightRepository } from "./persistence/repositories/DrizzleInsightRepository";
import { DrizzleAuditLogRepository } from "./persistence/repositories/DrizzleAuditLogRepository";
import { DrizzleProjectMetadataRepository } from "./persistence/repositories/DrizzleProjectMetadataRepository";
import { transactionManager } from "./persistence/TransactionManager";
import { TmuxGatewayImpl } from "./external/tmux/TmuxGatewayImpl";
import { WorktreeGatewayImpl } from "./external/worktree/WorktreeGatewayImpl";
import { GitHubIssueGatewayImpl } from "./external/github/GitHubIssueGatewayImpl";
import { TmuxScrollbackMonitor } from "./external/tmux/TmuxScrollbackMonitor";
import { TmuxCommandInjector } from "./external/tmux/TmuxCommandInjector";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { WorktreeGateway } from "@/application/ports/WorktreeGateway";
import type { GitHubIssueRepository } from "@/application/ports/GitHubIssueRepository";
import type { GitHubIssueGateway } from "@/application/ports/GitHubIssueGateway";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IInsightRepository } from "@/application/ports/IInsightRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import type { IScrollbackMonitor } from "@/application/ports/IScrollbackMonitor";
import type { ICommandInjector } from "@/application/ports/ICommandInjector";
import type { IProjectMetadataRepository } from "@/application/ports/IProjectMetadataRepository";

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

// GitHub Use Cases
import {
  FetchIssuesForRepositoryUseCase,
  MarkIssuesSeenUseCase,
} from "@/application/use-cases/github";

// Orchestrator Use Cases
import { CreateMasterOrchestratorUseCase } from "@/application/use-cases/orchestrator/CreateMasterOrchestratorUseCase";
import { CreateSubOrchestratorUseCase } from "@/application/use-cases/orchestrator/CreateSubOrchestratorUseCase";
import { DetectStalledSessionsUseCase } from "@/application/use-cases/orchestrator/DetectStalledSessionsUseCase";
import { InjectCommandUseCase } from "@/application/use-cases/orchestrator/InjectCommandUseCase";
import { PauseOrchestratorUseCase } from "@/application/use-cases/orchestrator/PauseOrchestratorUseCase";
import { ResumeOrchestratorUseCase } from "@/application/use-cases/orchestrator/ResumeOrchestratorUseCase";

// Metadata Use Cases
import { EnrichProjectMetadataUseCase } from "@/application/use-cases/metadata/EnrichProjectMetadataUseCase";
import { GetProjectMetadataUseCase } from "@/application/use-cases/metadata/GetProjectMetadataUseCase";
import { ProjectMetadataService } from "@/services/project-metadata-service";

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

/**
 * GitHub issue repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const githubIssueRepository: GitHubIssueRepository = new DrizzleGitHubIssueRepository();

/**
 * Orchestrator repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const orchestratorRepository: IOrchestratorRepository = new DrizzleOrchestratorRepository();

/**
 * Insight repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const insightRepository: IInsightRepository = new DrizzleInsightRepository();

/**
 * Audit log repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const auditLogRepository: IAuditLogRepository = new DrizzleAuditLogRepository();

/**
 * Project metadata repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const projectMetadataRepository: IProjectMetadataRepository = new DrizzleProjectMetadataRepository();

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

/**
 * GitHub issue gateway instance.
 * Wraps the existing GitHubService issue functions.
 */
export const githubIssueGateway: GitHubIssueGateway = new GitHubIssueGatewayImpl();

/**
 * Scrollback monitor gateway instance.
 * Monitors terminal scrollback buffers for stall detection.
 */
export const scrollbackMonitor: IScrollbackMonitor = new TmuxScrollbackMonitor();

/**
 * Command injector gateway instance.
 * Injects commands into running terminal sessions.
 */
export const commandInjector: ICommandInjector = new TmuxCommandInjector();

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
// GitHub Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch issues for repository use case.
 */
export const fetchIssuesForRepositoryUseCase = new FetchIssuesForRepositoryUseCase(
  githubIssueRepository,
  githubIssueGateway
);

/**
 * Mark issues as seen use case.
 */
export const markIssuesSeenUseCase = new MarkIssuesSeenUseCase(
  githubIssueRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create master orchestrator use case.
 */
export const createMasterOrchestratorUseCase = new CreateMasterOrchestratorUseCase(
  orchestratorRepository,
  auditLogRepository,
  sessionRepository,
  transactionManager
);

/**
 * Create sub-orchestrator use case.
 */
export const createSubOrchestratorUseCase = new CreateSubOrchestratorUseCase(
  orchestratorRepository,
  auditLogRepository,
  sessionRepository,
  folderRepository,
  transactionManager
);

/**
 * Detect stalled sessions use case.
 */
export const detectStalledSessionsUseCase = new DetectStalledSessionsUseCase(
  orchestratorRepository,
  insightRepository,
  auditLogRepository,
  scrollbackMonitor,
  transactionManager
);

/**
 * Inject command use case.
 */
export const injectCommandUseCase = new InjectCommandUseCase(
  orchestratorRepository,
  auditLogRepository,
  commandInjector,
  transactionManager
);

/**
 * Pause orchestrator use case.
 */
export const pauseOrchestratorUseCase = new PauseOrchestratorUseCase(
  orchestratorRepository,
  auditLogRepository,
  transactionManager
);

/**
 * Resume orchestrator use case.
 */
export const resumeOrchestratorUseCase = new ResumeOrchestratorUseCase(
  orchestratorRepository,
  auditLogRepository,
  transactionManager
);

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project metadata detection service.
 */
const projectMetadataService = new ProjectMetadataService();

/**
 * Enrich project metadata use case.
 */
export const enrichProjectMetadataUseCase = new EnrichProjectMetadataUseCase(
  projectMetadataRepository,
  projectMetadataService
);

/**
 * Get project metadata use case.
 */
export const getProjectMetadataUseCase = new GetProjectMetadataUseCase(
  projectMetadataRepository,
  enrichProjectMetadataUseCase
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
  githubIssueRepository: GitHubIssueRepository;
  orchestratorRepository: IOrchestratorRepository;
  insightRepository: IInsightRepository;
  auditLogRepository: IAuditLogRepository;
  projectMetadataRepository: IProjectMetadataRepository;
  tmuxGateway: TmuxGateway;
  worktreeGateway: WorktreeGateway;
  githubIssueGateway: GitHubIssueGateway;
  scrollbackMonitor: IScrollbackMonitor;
  commandInjector: ICommandInjector;
  // Use cases for external access
  enrichProjectMetadataUseCase: EnrichProjectMetadataUseCase;
  getProjectMetadataUseCase: GetProjectMetadataUseCase;
}

/**
 * Default container with production implementations.
 */
export const container: Container = {
  sessionRepository,
  folderRepository,
  githubIssueRepository,
  orchestratorRepository,
  insightRepository,
  auditLogRepository,
  projectMetadataRepository,
  tmuxGateway,
  worktreeGateway,
  githubIssueGateway,
  scrollbackMonitor,
  commandInjector,
  enrichProjectMetadataUseCase,
  getProjectMetadataUseCase,
};

/**
 * @deprecated Use `container` instead
 */
export const defaultContainer = container;

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
