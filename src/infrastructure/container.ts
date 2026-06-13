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
import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
import "@/lib/terminal-plugins/init-server";
import { CloseSessionUseCase } from "@/application/use-cases/session/CloseSessionUseCase";
import { ListSessionsUseCase } from "@/application/use-cases/session/ListSessionsUseCase";
import { GetSessionUseCase } from "@/application/use-cases/session/GetSessionUseCase";
import { UpdateSessionUseCase } from "@/application/use-cases/session/UpdateSessionUseCase";

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
  ListGitHubAccountsUseCase,
  BindProjectToGitHubAccountUseCase,
  UnbindProjectFromGitHubAccountUseCase,
} from "@/application/use-cases/github-accounts";

// Agent Use Cases
import { RestartAgentUseCase } from "@/application/use-cases/session/RestartAgentUseCase";
// [hgwo] Resume resolver for agent session durability (Vault).
import { AgentResumeResolverImpl } from "@/infrastructure/agent-resume/AgentResumeResolverImpl";

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
import { runtimeResolve as resolve } from "@/lib/dynamic-fs";

// Logs
import { getLogStore } from "./persistence/sidecar-factory";
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

// Port Monitoring
import { PortMonitor } from "@/application/services/PortMonitor";
import { PortRegistryAdapterImpl } from "./adapters/PortRegistryAdapterImpl";
import { SessionAdapterImpl } from "./adapters/SessionAdapterImpl";
import { TmuxAdapterImpl } from "./adapters/TmuxAdapterImpl";
import { pruneExpiredClaims } from "@/services/port-claims-service";
import { pruneStaleMigrations } from "@/services/migration-service";
import { pruneStaleImports } from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

// Claude Usage Limits + Profile Pools [remote-dev-3b3l]
import { DrizzleUsageLimitStateRepository } from "./usage-limit/DrizzleUsageLimitStateRepository";
import { DrizzleProfilePoolRepository } from "./usage-limit/DrizzleProfilePoolRepository";
import { PriorityProfileSelectionPolicy } from "./usage-limit/PriorityProfileSelectionPolicy";
import type { ProjectProfileLink } from "./usage-limit/PriorityProfileSelectionPolicy";
import { ReactiveOutputDetector } from "./usage-limit/ReactiveOutputDetector";
import { UsageEndpointPoller } from "./usage-limit/UsageEndpointPoller";
import { CompositeUsageLimitGateway } from "./usage-limit/CompositeUsageLimitGateway";
import {
  TrackUsageLimitUseCase,
  SelectProfileUseCase,
} from "@/application/use-cases/profile";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type { ProfilePoolRepository } from "@/application/ports/ProfilePoolRepository";
import type { ProfileSelectionPolicy } from "@/application/ports/ProfileSelectionPolicy";
import type { UsageLimitGateway } from "@/application/ports/UsageLimitGateway";
import { db as appDb } from "@/db";
import { projectProfileLinks } from "@/db/schema";
import { eq as drizzleEq } from "drizzle-orm";

const log = createLogger("Container");

// ─────────────────────────────────────────────────────────────────────────────
// Repository Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session repository instance.
 * Uses Drizzle ORM for SQLite persistence.
 */
export const sessionRepository: SessionRepository = new DrizzleSessionRepository();

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
 *
 * Injects a `usesTmux` policy backed by the server plugin registry so
 * non-tmux terminal types (settings, recordings, profiles, prefs, secrets,
 * trash, port-manager, issues, prs, file, browser, …) skip the
 * `tmuxGateway.sessionExists()` probe. Without this, resuming a non-tmux
 * singleton tab returns 410 and the client auto-deletes it (see
 * SessionContext.tsx `resumeSession`).
 *
 * Falls back to `true` for unknown terminal types (same conservative
 * default as `sessionUsesTmux` in `session-service.ts`).
 */
export const resumeSessionUseCase = new ResumeSessionUseCase(
  sessionRepository,
  tmuxGateway,
  (terminalType) =>
    TerminalTypeServerRegistry.get(terminalType)?.useTmux ?? true
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
 * Restart agent use case.
 * Handles restarting agent CLI processes with environment preservation.
 */
// [hgwo] Shared resume resolver instance (stateless; reads the declarative
// per-provider registry + on-disk discovery).
export const agentResumeResolver = new AgentResumeResolverImpl();

export const restartAgentUseCase = new RestartAgentUseCase(
  sessionRepository,
  tmuxGateway,
  agentResumeResolver
);

// ─────────────────────────────────────────────────────────────────────────────
// Project / ProjectGroup Use Cases (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export const createProjectGroupUseCase = new CreateProjectGroup(projectGroupRepository);
export const updateProjectGroupUseCase = new UpdateProjectGroup(projectGroupRepository);
export const moveProjectGroupUseCase = new MoveProjectGroup(projectGroupRepository);

export const createProjectUseCase = new CreateProject(
  projectRepository,
  projectGroupRepository
);
export const updateProjectUseCase = new UpdateProject(projectRepository);
export const moveProjectUseCase = new MoveProject(
  projectRepository,
  projectGroupRepository
);
export const deleteProjectUseCase = new DeleteProject(
  projectRepository,
  sessionRepository,
  tmuxGateway
);

// DeleteProjectGroup depends on DeleteProject to cascade descendant projects
// (remote-dev-nmw4). Must be wired AFTER deleteProjectUseCase.
export const deleteProjectGroupUseCase = new DeleteProjectGroup(
  projectGroupRepository,
  projectRepository,
  deleteProjectUseCase
);
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

export const listGitHubAccountsUseCase = new ListGitHubAccountsUseCase(
  githubAccountRepository
);

export const bindProjectToGitHubAccountUseCase =
  new BindProjectToGitHubAccountUseCase(githubAccountRepository);

export const unbindProjectFromGitHubAccountUseCase =
  new UnbindProjectFromGitHubAccountUseCase(githubAccountRepository);

// ─────────────────────────────────────────────────────────────────────────────
// Log System
// ─────────────────────────────────────────────────────────────────────────────

export const logRepository: LogRepository = getLogStore();

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
// Port Monitoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Port monitor application service.
 *
 * Combines declarative port-registry data with runtime checks (active tmux
 * session environments + lsof) to detect port conflicts and suggest
 * alternatives. Wired over the functional services via thin adapters.
 */
export const portMonitor = new PortMonitor({
  portRegistry: new PortRegistryAdapterImpl(),
  sessions: new SessionAdapterImpl(sessionRepository),
  tmux: new TmuxAdapterImpl(tmuxGateway),
});

// Prune expired port claims once at module load. This container is only ever
// imported server-side (it instantiates Drizzle repositories and tmux
// gateways), so running a one-shot DB cleanup here is safe. Fire-and-forget:
// module init must not block on it.
void pruneExpiredClaims()
  .then((deleted) => {
    if (deleted > 0) {
      log.info("Pruned expired port claims on startup", { deleted });
    }
  })
  .catch((error) => {
    log.error("Failed to prune expired port claims on startup", {
      error: String(error),
    });
  });

// Same pattern for server-to-server migration jobs: a runner that died
// mid-migration leaves a non-terminal row behind; mark anything that has not
// progressed in 2h as failed so the UI/API never shows immortal "running" jobs.
void pruneStaleMigrations()
  .then((failed) => {
    if (failed > 0) {
      log.info("Pruned stale migration jobs on startup", { failed });
    }
  })
  .catch((error) => {
    log.error("Failed to prune stale migration jobs on startup", {
      error: String(error),
    });
  });

// Destination-side counterpart: an inbound migration whose source died
// mid-push leaves an import row stuck non-terminal (+ a staging dir). Fail
// anything older than 2h and reclaim its staging directory.
void pruneStaleImports()
  .then((failed) => {
    if (failed > 0) {
      log.info("Pruned stale destination imports on startup", { failed });
    }
  })
  .catch((error) => {
    log.error("Failed to prune stale destination imports on startup", {
      error: String(error),
    });
  });

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
// Claude Usage Limits + Profile Pools [remote-dev-3b3l]
// ─────────────────────────────────────────────────────────────────────────────

/** Per-profile authoritative usage-limit state store. */
export const usageLimitStateRepository: UsageLimitStateRepository =
  new DrizzleUsageLimitStateRepository();

/** Claude fallback-pool persistence. */
export const profilePoolRepository: ProfilePoolRepository =
  new DrizzleProfilePoolRepository();

/**
 * The single usage-limit gateway: a reactive output detector + a (flag-gated,
 * default-off) proactive poller, dispatched by AccountKind. Reactive supports
 * subscription; the poller is a no-op unless RDV_CLAUDE_USAGE_POLL_ENABLED=1.
 */
export const usageLimitGateway: UsageLimitGateway = new CompositeUsageLimitGateway([
  new ReactiveOutputDetector(),
  new UsageEndpointPoller(),
]);

/**
 * Reads `project_profile_link` for a project's primary profile + explicit pool.
 */
const readProjectProfileLink = async (
  projectId: string
): Promise<ProjectProfileLink | null> => {
  const link = await appDb.query.projectProfileLinks.findFirst({
    where: drizzleEq(projectProfileLinks.projectId, projectId),
  });
  if (!link) return null;
  return { profileId: link.profileId ?? null, poolId: link.poolId ?? null };
};

/**
 * Resolves the inherited `nodePreferences.claudeProfilePoolId` for a project
 * through the existing preference chain (project→group). Lazily imports the
 * preferences service to keep the container free of a static dependency on the
 * services layer (avoids an init-time import cycle).
 */
const readInheritedPoolId = async (
  projectId: string,
  userId: string
): Promise<string | null> => {
  const { getResolvedPreferences } = await import(
    "@/services/preferences-service"
  );
  const resolved = await getResolvedPreferences(userId, projectId);
  return resolved.claudeProfilePoolId ?? null;
};

/** Priority-order primary→pool selection policy. */
export const profileSelectionPolicy: ProfileSelectionPolicy =
  new PriorityProfileSelectionPolicy(
    profilePoolRepository,
    usageLimitStateRepository,
    readProjectProfileLink,
    readInheritedPoolId
  );

/** Record a usage-limit observation (with the staleness guard). */
export const trackUsageLimitUseCase = new TrackUsageLimitUseCase(
  usageLimitStateRepository
);

/** Resolve which profile to launch for a project (explicit → primary → pool). */
export const selectProfileUseCase = new SelectProfileUseCase(
  profileSelectionPolicy
);

// NOTE: RelaunchOnLimitUseCase is intentionally NOT wired here. Its concrete
// Notification/SessionLauncher adapters touch notification-service /
// session-service and are built in Wave C (integration) to avoid an
// infra↔services import cycle. The use-case itself + its fakes live under
// application/use-cases/profile and are unit-tested there.

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
