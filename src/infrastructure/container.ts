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
import { DrizzleGitHubAccountRepository } from "./persistence/repositories/DrizzleGitHubAccountRepository";
import { DrizzleProjectGroupRepository } from "./persistence/repositories/DrizzleProjectGroupRepository";
import { DrizzleProjectRepository } from "./persistence/repositories/DrizzleProjectRepository";
import { DrizzleNodePreferencesRepository } from "./persistence/repositories/DrizzleNodePreferencesRepository";
import { TmuxGatewayImpl } from "./external/tmux/TmuxGatewayImpl";
import { WorktreeGatewayImpl } from "./external/worktree/WorktreeGatewayImpl";
import { GitHubIssueGatewayImpl } from "./external/github/GitHubIssueGatewayImpl";
import { GhCliConfigGatewayImpl } from "./external/github/GhCliConfigGatewayImpl";
import { SessionGitConfigGatewayImpl } from "./external/git/SessionGitConfigGatewayImpl";
import { SystemEnvironmentGateway } from "./external/environment/SystemEnvironmentGateway";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { SessionFolderQueryPort } from "@/application/ports/SessionFolderQueryPort";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { WorktreeGateway } from "@/application/ports/WorktreeGateway";
import type { EnvironmentGateway } from "@/application/ports/EnvironmentGateway";
import type { GitHubIssueRepository } from "@/application/ports/GitHubIssueRepository";
import type { GitHubIssueGateway } from "@/application/ports/GitHubIssueGateway";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import type { GhCliConfigGateway } from "@/application/ports/GhCliConfigGateway";
import type { SessionGitConfigGateway } from "@/application/ports/SessionGitConfigGateway";
import { GitCredentialManager } from "@/application/services/GitCredentialManager";

// Session Use Cases
import { CreateSessionUseCase } from "@/application/use-cases/session/CreateSessionUseCase";
import { SuspendSessionUseCase } from "@/application/use-cases/session/SuspendSessionUseCase";
import { ResumeSessionUseCase } from "@/application/use-cases/session/ResumeSessionUseCase";
import { CloseSessionUseCase } from "@/application/use-cases/session/CloseSessionUseCase";
import { ListSessionsUseCase } from "@/application/use-cases/session/ListSessionsUseCase";
import { GetSessionUseCase } from "@/application/use-cases/session/GetSessionUseCase";
import { UpdateSessionUseCase } from "@/application/use-cases/session/UpdateSessionUseCase";
import { MoveSessionToFolderUseCase } from "@/application/use-cases/session/MoveSessionToFolderUseCase";

// ProjectGroup Use Cases
import { CreateProjectGroup } from "@/application/use-cases/project-group/CreateProjectGroup";
import { UpdateProjectGroup } from "@/application/use-cases/project-group/UpdateProjectGroup";
import { MoveProjectGroup } from "@/application/use-cases/project-group/MoveProjectGroup";
import { DeleteProjectGroup } from "@/application/use-cases/project-group/DeleteProjectGroup";

// Project Use Cases
import { CreateProject } from "@/application/use-cases/project/CreateProject";
import { UpdateProject } from "@/application/use-cases/project/UpdateProject";
import { MoveProject } from "@/application/use-cases/project/MoveProject";
import { DeleteProject } from "@/application/use-cases/project/DeleteProject";
import { ResolveProjectScope } from "@/application/use-cases/project/ResolveProjectScope";

import type { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import type { ProjectRepository as ProjectRepositoryPort } from "@/application/ports/ProjectRepository";
import type { NodePreferencesRepository } from "@/application/ports/NodePreferencesRepository";

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

// GitHub Account Use Cases
import {
  LinkGitHubAccountUseCase,
  UnlinkGitHubAccountUseCase,
  SetDefaultGitHubAccountUseCase,
  BindFolderToGitHubAccountUseCase,
  UnbindFolderFromGitHubAccountUseCase,
  ListGitHubAccountsUseCase,
} from "@/application/use-cases/github-accounts";

// Agent Use Cases
import { RestartAgentUseCase } from "@/application/use-cases/session/RestartAgentUseCase";

// Update System
import { DrizzleReleaseRepository } from "./persistence/repositories/DrizzleReleaseRepository";
import { DrizzleDeploymentRepository } from "./persistence/repositories/DrizzleDeploymentRepository";
import { GitHubReleaseGatewayImpl } from "./external/update/GitHubReleaseGateway";
import { TerminalServerDrainGateway } from "./external/update/TerminalServerDrainGateway";
import { ProcessServiceRestarter } from "./external/update/ProcessServiceRestarter";
import { TarballInstallerImpl } from "./external/update/TarballInstallerImpl";
import type { ReleaseRepository } from "@/application/ports/ReleaseRepository";
import type { ReleaseGateway } from "@/application/ports/ReleaseGateway";
import type { ServiceRestarter } from "@/application/ports/ServiceRestarter";
import type { TarballInstaller } from "@/application/ports/TarballInstaller";
import type { DeploymentRepository } from "@/application/ports/DeploymentRepository";
import type { SessionDrainGateway } from "@/application/ports/SessionDrainGateway";
import {
  CheckForUpdatesUseCase,
  ApplyUpdateUseCase,
  GetUpdateStatusUseCase,
  ScheduleAutoUpdateUseCase,
  DrainSessionsUseCase,
} from "@/application/use-cases/update";
import { AutoUpdateOrchestrator } from "@/services/auto-update-orchestrator";
import { AppVersion } from "@/domain/value-objects/AppVersion";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Logs
import { getLogRepositoryInstance } from "./persistence/repositories/BetterSqliteLogRepository";
import { QueryLogsUseCase, PruneLogsUseCase } from "@/application/use-cases/logs";
import type { LogRepository } from "@/application/ports/LogRepository";

// Push Notifications
import { DrizzlePushTokenRepository } from "./persistence/repositories/DrizzlePushTokenRepository";
import { FcmPushGateway, NullPushGateway } from "./external/fcm/FcmPushGateway";
import type { PushNotificationGateway } from "@/application/ports/PushNotificationGateway";
import type { PushTokenRepository } from "@/application/ports/PushTokenRepository";
import {
  setPushGateway,
  setPushTokenRepository,
} from "@/services/notification-service";

// ─────────────────────────────────────────────────────────────────────────────
// Repository Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 * DrizzleSessionRepository implements both SessionRepository and SessionFolderQueryPort.
 */
const drizzleSessionRepository = new DrizzleSessionRepository();
export const sessionRepository: SessionRepository = drizzleSessionRepository;
export const sessionFolderQueryPort: SessionFolderQueryPort = drizzleSessionRepository;

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

export const githubAccountRepository: GitHubAccountRepository = new DrizzleGitHubAccountRepository();

/**
 * Project / ProjectGroup / NodePreferences repositories.
 * Phase 3 additions for the project-folder refactor.
 */
export const projectGroupRepository: ProjectGroupRepository = new DrizzleProjectGroupRepository();
export const projectRepository: ProjectRepositoryPort = new DrizzleProjectRepository();
export const nodePreferencesRepository: NodePreferencesRepository = new DrizzleNodePreferencesRepository();

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
 * Environment gateway instance.
 * Provides access to system environment variables.
 */
export const environmentGateway: EnvironmentGateway = new SystemEnvironmentGateway();

export const ghCliConfigGateway: GhCliConfigGateway = new GhCliConfigGatewayImpl();

export const sessionGitConfigGateway: SessionGitConfigGateway = new SessionGitConfigGatewayImpl();

export const gitCredentialManager = new GitCredentialManager(sessionGitConfigGateway);

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

/**
 * Restart agent use case.
 * Handles restarting agent CLI processes with environment preservation.
 */
export const restartAgentUseCase = new RestartAgentUseCase(
  sessionRepository,
  tmuxGateway
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
  sessionFolderQueryPort
);

// ─────────────────────────────────────────────────────────────────────────────
// Project / ProjectGroup Use Cases (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export const createProjectGroupUseCase = new CreateProjectGroup(projectGroupRepository);
export const updateProjectGroupUseCase = new UpdateProjectGroup(projectGroupRepository);
export const moveProjectGroupUseCase = new MoveProjectGroup(projectGroupRepository);
export const deleteProjectGroupUseCase = new DeleteProjectGroup(
  projectGroupRepository,
  projectRepository
);

export const createProjectUseCase = new CreateProject(
  projectRepository,
  projectGroupRepository
);
export const updateProjectUseCase = new UpdateProject(projectRepository);
export const moveProjectUseCase = new MoveProject(
  projectRepository,
  projectGroupRepository
);
export const deleteProjectUseCase = new DeleteProject(projectRepository);
export const resolveProjectScopeUseCase = new ResolveProjectScope(
  projectGroupRepository,
  projectRepository
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
// GitHub Account Use Case Instances
// ─────────────────────────────────────────────────────────────────────────────

export const linkGitHubAccountUseCase = new LinkGitHubAccountUseCase(
  githubAccountRepository,
  ghCliConfigGateway
);

export const unlinkGitHubAccountUseCase = new UnlinkGitHubAccountUseCase(
  githubAccountRepository,
  ghCliConfigGateway
);

export const setDefaultGitHubAccountUseCase = new SetDefaultGitHubAccountUseCase(
  githubAccountRepository
);

export const bindFolderToGitHubAccountUseCase = new BindFolderToGitHubAccountUseCase(
  githubAccountRepository,
  folderRepository
);

export const unbindFolderFromGitHubAccountUseCase = new UnbindFolderFromGitHubAccountUseCase(
  githubAccountRepository,
  folderRepository
);

export const listGitHubAccountsUseCase = new ListGitHubAccountsUseCase(
  githubAccountRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Log System
// ─────────────────────────────────────────────────────────────────────────────

export const logRepository: LogRepository = getLogRepositoryInstance();

export const queryLogsUseCase = new QueryLogsUseCase(logRepository);

export const pruneLogsUseCase = new PruneLogsUseCase(logRepository);

// ─────────────────────────────────────────────────────────────────────────────
// Push Notification System
// ─────────────────────────────────────────────────────────────────────────────

export const pushTokenRepository: PushTokenRepository =
  new DrizzlePushTokenRepository();

const fcmServiceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH;
const fcmProjectId = process.env.FCM_PROJECT_ID;

export const pushNotificationGateway: PushNotificationGateway =
  fcmServiceAccountPath && fcmProjectId
    ? new FcmPushGateway(fcmProjectId, fcmServiceAccountPath)
    : new NullPushGateway();

// Wire push notification dependencies into NotificationService
setPushGateway(pushNotificationGateway);
setPushTokenRepository(pushTokenRepository);

// ─────────────────────────────────────────────────────────────────────────────
// Update System
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the application version from package.json.
 * Tries the working directory first, then relative to this file's location.
 * Falls back to 0.0.0 if neither path resolves.
 */
function readAppVersion(): AppVersion {
  try {
    const pkgPath = resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.version) {
      return AppVersion.fromString(pkg.version);
    }
  } catch {
    // fall through
  }
  return AppVersion.fromString("0.0.0");
}

export const currentAppVersion: AppVersion = readAppVersion();

export const releaseRepository: ReleaseRepository = new DrizzleReleaseRepository();

export const releaseGateway: ReleaseGateway = new GitHubReleaseGatewayImpl();

export const serviceRestarter: ServiceRestarter = new ProcessServiceRestarter();

export const tarballInstaller: TarballInstaller = new TarballInstallerImpl();

export const checkForUpdatesUseCase = new CheckForUpdatesUseCase(
  releaseGateway,
  releaseRepository,
  currentAppVersion
);

export const applyUpdateUseCase = new ApplyUpdateUseCase(
  releaseGateway,
  releaseRepository,
  tarballInstaller,
  serviceRestarter
);

export const getUpdateStatusUseCase = new GetUpdateStatusUseCase(
  releaseRepository,
  currentAppVersion
);

// Auto-Update System
export const deploymentRepository: DeploymentRepository = new DrizzleDeploymentRepository();

export const sessionDrainGateway: SessionDrainGateway = new TerminalServerDrainGateway();

export const scheduleAutoUpdateUseCase = new ScheduleAutoUpdateUseCase(
  deploymentRepository
);

export const drainSessionsUseCase = new DrainSessionsUseCase(
  sessionDrainGateway,
  deploymentRepository
);

export const autoUpdateOrchestrator = new AutoUpdateOrchestrator(
  scheduleAutoUpdateUseCase,
  drainSessionsUseCase,
  applyUpdateUseCase,
  deploymentRepository
);

// ─────────────────────────────────────────────────────────────────────────────
// Grouped container access (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grouped container access for Phase 3+ service facades. Existing code that uses
 * the named exports (e.g. `import { createSessionUseCase } from ...`) continues
 * to work; new code may reach for `container.projectRepository` etc.
 */
export const container = {
  projectGroupRepository,
  projectRepository,
  nodePreferencesRepository,
  useCases: {
    createProjectGroup: createProjectGroupUseCase,
    updateProjectGroup: updateProjectGroupUseCase,
    moveProjectGroup: moveProjectGroupUseCase,
    deleteProjectGroup: deleteProjectGroupUseCase,
    createProject: createProjectUseCase,
    updateProject: updateProjectUseCase,
    moveProject: moveProjectUseCase,
    deleteProject: deleteProjectUseCase,
    resolveProjectScope: resolveProjectScopeUseCase,
  },
};

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
  githubAccountRepository: GitHubAccountRepository;
  tmuxGateway: TmuxGateway;
  worktreeGateway: WorktreeGateway;
  githubIssueGateway: GitHubIssueGateway;
  ghCliConfigGateway: GhCliConfigGateway;
  sessionGitConfigGateway: SessionGitConfigGateway;
  environmentGateway: EnvironmentGateway;
  logRepository: LogRepository;
  releaseRepository: ReleaseRepository;
  releaseGateway: ReleaseGateway;
  serviceRestarter: ServiceRestarter;
  tarballInstaller: TarballInstaller;
  deploymentRepository: DeploymentRepository;
  sessionDrainGateway: SessionDrainGateway;
  pushTokenRepository: PushTokenRepository;
  pushNotificationGateway: PushNotificationGateway;
}

/**
 * Default container with production implementations.
 */
export const defaultContainer: Container = {
  sessionRepository,
  folderRepository,
  githubIssueRepository,
  githubAccountRepository,
  tmuxGateway,
  worktreeGateway,
  githubIssueGateway,
  ghCliConfigGateway,
  sessionGitConfigGateway,
  environmentGateway,
  logRepository,
  releaseRepository,
  releaseGateway,
  serviceRestarter,
  tarballInstaller,
  deploymentRepository,
  sessionDrainGateway,
  pushTokenRepository,
  pushNotificationGateway,
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
