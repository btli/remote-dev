/**
 * MigrationExportService — builds the {@link DbBundle} for a project on the
 * SOURCE instance (server-to-server migration, stage 1).
 *
 * Included: project row, project-scoped node preferences, tasks (+
 * dependencies), channel groups/channels (+ message history only when
 * opted in), MCP servers, agent configs, secrets-provider configs
 * (DECRYPTED into `providerConfigPlain` — the destination re-encrypts under
 * its own AUTH_SECRET), GitHub repo/account relink HINTS (never tokens),
 * the linked agent profile (+ satellites), trigger configs, and agent
 * schedules.
 *
 * Excluded by design: terminal sessions (tmux is host-bound),
 * agent_run/crown_run history, port registry/claims, and GitHub stats caches
 * (recomputable on the destination).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  nodePreferences,
  projectTasks,
  taskDependencies,
  channelGroups,
  channels,
  agentPeerMessages,
  mcpServers,
  agentConfigs,
  projectSecretsConfig,
  projectRepositories,
  githubRepositories,
  projectGitHubAccountLinks,
  githubAccountMetadata,
  projectProfileLinks,
  agentProfiles,
  profileGitIdentities,
  profileAppearanceSettings,
  agentProfileJsonConfigs,
  profileSecretsConfig,
  triggerConfigs,
  agentSchedules,
} from "@/db/schema";
import { decryptSafe } from "@/lib/encryption";
import {
  BUNDLE_VERSION,
  type BundleProfile,
  type BundleRepositoryHint,
  type BundleSecretsConfig,
  type DbBundle,
  type MigrationOptions,
} from "@/lib/migration-bundle";
import { createLogger } from "@/lib/logger";

const log = createLogger("MigrationExport");

/** Epoch-ms for a required Date column. */
function ms(d: Date): number {
  return d.getTime();
}

/** Epoch-ms or null for a nullable Date column. */
function msOrNull(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

/**
 * Normalize a stored secrets `providerConfig` into plaintext key/value pairs.
 * Handles both forms in the wild: an encrypted JSON string (current writes)
 * and a plain object (legacy `json`-mode rows). Returns null + pushes a
 * warning when the payload cannot be recovered.
 */
function decryptProviderConfig(
  raw: unknown,
  context: string,
  warnings: string[],
): Record<string, string> | null {
  try {
    if (typeof raw === "string") {
      const decrypted = decryptSafe(raw);
      return JSON.parse(decrypted ?? "{}") as Record<string, string>;
    }
    if (raw && typeof raw === "object") {
      return raw as Record<string, string>;
    }
    return {};
  } catch (error) {
    warnings.push(
      `Could not decrypt ${context} secrets config — excluded from the bundle (${String(error)})`,
    );
    return null;
  }
}

/** Build the repo relink hint for a source-local github_repository id. */
async function repoHintById(
  userId: string,
  repositoryId: string,
): Promise<BundleRepositoryHint | null> {
  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.id, repositoryId),
      eq(githubRepositories.userId, userId),
    ),
  });
  return repo ? { githubId: repo.githubId, fullName: repo.fullName } : null;
}

/**
 * Build the complete DB bundle for one project. Throws when the project does
 * not exist or is not owned by `userId`.
 */
export async function buildDbBundle(
  userId: string,
  projectId: string,
  options: MigrationOptions,
): Promise<{ bundle: DbBundle; warnings: string[] }> {
  const warnings: string[] = [];

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
  if (!project) {
    throw new Error("Project not found");
  }

  // Project-scoped node preferences (per-user rows for this owner).
  const prefRows = await db
    .select()
    .from(nodePreferences)
    .where(
      and(
        eq(nodePreferences.ownerId, projectId),
        eq(nodePreferences.ownerType, "project"),
        eq(nodePreferences.userId, userId),
      ),
    );

  // Tasks + dependencies (both endpoints FK project tasks, so blocker-side
  // membership is sufficient to collect all in-project edges).
  const taskRows = await db
    .select()
    .from(projectTasks)
    .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.userId, userId)));
  const taskIds = taskRows.map((t) => t.id);
  const depRows = taskIds.length
    ? await db
        .select()
        .from(taskDependencies)
        .where(inArray(taskDependencies.blockerId, taskIds))
    : [];
  const taskIdSet = new Set(taskIds);

  const groupRows = await db
    .select()
    .from(channelGroups)
    .where(eq(channelGroups.projectId, projectId));
  const channelRows = await db
    .select()
    .from(channels)
    .where(eq(channels.projectId, projectId));
  const messageRows = options.includeChannelHistory
    ? await db
        .select()
        .from(agentPeerMessages)
        .where(eq(agentPeerMessages.projectId, projectId))
    : [];

  const mcpRows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.projectId, projectId), eq(mcpServers.userId, userId)));

  const agentConfigRows = options.includeAgentSettings
    ? await db
        .select()
        .from(agentConfigs)
        .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.userId, userId)))
    : [];
  if (!options.includeAgentSettings) {
    warnings.push("Agent settings excluded by option (includeAgentSettings=false)");
  }

  // Project secrets config — decrypted for transport (destination re-encrypts).
  let projectSecrets: BundleSecretsConfig | null = null;
  if (options.includeAgentCreds) {
    const secretsRow = await db.query.projectSecretsConfig.findFirst({
      where: and(
        eq(projectSecretsConfig.projectId, projectId),
        eq(projectSecretsConfig.userId, userId),
      ),
    });
    if (secretsRow) {
      const plain = decryptProviderConfig(
        secretsRow.providerConfig,
        `project ${projectId}`,
        warnings,
      );
      if (plain) {
        projectSecrets = {
          provider: secretsRow.provider,
          providerConfigPlain: plain,
          enabled: secretsRow.enabled,
        };
      }
    }
  }

  // GitHub repo relink hint — { githubId, fullName } only, never tokens.
  const repoLink = await db.query.projectRepositories.findFirst({
    where: and(
      eq(projectRepositories.projectId, projectId),
      eq(projectRepositories.userId, userId),
    ),
  });
  const repositoryHint = repoLink
    ? await repoHintById(userId, repoLink.repositoryId)
    : null;

  // GitHub account relink hint via the account metadata row.
  const accountLink = await db.query.projectGitHubAccountLinks.findFirst({
    where: eq(projectGitHubAccountLinks.projectId, projectId),
  });
  let githubAccountHint: DbBundle["githubAccountHint"] = null;
  if (accountLink) {
    const meta = await db.query.githubAccountMetadata.findFirst({
      where: and(
        eq(githubAccountMetadata.providerAccountId, accountLink.providerAccountId),
        eq(githubAccountMetadata.userId, userId),
      ),
    });
    githubAccountHint = {
      providerAccountId: accountLink.providerAccountId,
      login: meta?.login ?? "",
    };
  }

  // Linked agent profile (0..1 — project_profile_link PK is projectId).
  const profiles: BundleProfile[] = [];
  const profileLink = await db.query.projectProfileLinks.findFirst({
    where: eq(projectProfileLinks.projectId, projectId),
  });
  if (profileLink) {
    const profile = await db.query.agentProfiles.findFirst({
      where: and(
        eq(agentProfiles.id, profileLink.profileId),
        eq(agentProfiles.userId, userId),
      ),
    });
    if (profile) {
      const [gitIdentity, appearance, jsonConfigRows, secretsRow] = await Promise.all([
        db.query.profileGitIdentities.findFirst({
          where: eq(profileGitIdentities.profileId, profile.id),
        }),
        db.query.profileAppearanceSettings.findFirst({
          where: eq(profileAppearanceSettings.profileId, profile.id),
        }),
        options.includeAgentSettings
          ? db
              .select()
              .from(agentProfileJsonConfigs)
              .where(eq(agentProfileJsonConfigs.profileId, profile.id))
          : Promise.resolve([]),
        options.includeAgentCreds
          ? db.query.profileSecretsConfig.findFirst({
              where: and(
                eq(profileSecretsConfig.profileId, profile.id),
                eq(profileSecretsConfig.userId, userId),
              ),
            })
          : Promise.resolve(undefined),
      ]);

      let profileSecrets: BundleSecretsConfig | null = null;
      if (secretsRow) {
        const plain = decryptProviderConfig(
          secretsRow.providerConfig,
          `profile ${profile.id}`,
          warnings,
        );
        if (plain) {
          profileSecrets = {
            provider: secretsRow.provider,
            providerConfigPlain: plain,
            enabled: secretsRow.enabled,
          };
        }
      }

      profiles.push({
        id: profile.id,
        name: profile.name,
        description: profile.description ?? null,
        provider: profile.provider,
        isDefault: profile.isDefault,
        // Lets the destination rewrite profile-relative paths (sshKeyPath)
        // and locate this profile inside the profiles archive.
        sourceConfigDir: profile.configDir,
        gitIdentity: gitIdentity
          ? {
              userName: gitIdentity.userName,
              userEmail: gitIdentity.userEmail,
              sshKeyPath: gitIdentity.sshKeyPath ?? null,
              gpgKeyId: gitIdentity.gpgKeyId ?? null,
              githubUsername: gitIdentity.githubUsername ?? null,
            }
          : null,
        appearance: appearance
          ? {
              appearanceMode: appearance.appearanceMode,
              lightColorScheme: appearance.lightColorScheme,
              darkColorScheme: appearance.darkColorScheme,
              terminalOpacity: appearance.terminalOpacity,
              terminalBlur: appearance.terminalBlur,
              terminalCursorStyle: appearance.terminalCursorStyle,
            }
          : null,
        jsonConfigs: jsonConfigRows.map((c) => ({
          agentType: c.agentType,
          configJson: c.configJson,
          isValid: c.isValid,
          validationErrors: c.validationErrors ?? null,
        })),
        secrets: profileSecrets,
      });
    } else {
      warnings.push(
        `Linked profile ${profileLink.profileId} not found (or not owned) — excluded`,
      );
    }
  }

  // Trigger configs (with per-config repo relink hints).
  const triggerRows = await db
    .select()
    .from(triggerConfigs)
    .where(and(eq(triggerConfigs.projectId, projectId), eq(triggerConfigs.userId, userId)));
  const bundleTriggers = await Promise.all(
    triggerRows.map(async (t) => ({
      name: t.name,
      kind: t.kind as string,
      filter: t.filter,
      agentProvider: t.agentProvider,
      agentFlags: t.agentFlags,
      promptTemplate: t.promptTemplate,
      worktreeType: t.worktreeType ?? null,
      enabled: t.enabled,
      githubRepoHint: t.githubRepoId ? await repoHintById(userId, t.githubRepoId) : null,
    })),
  );

  const scheduleRows = await db
    .select()
    .from(agentSchedules)
    .where(and(eq(agentSchedules.projectId, projectId), eq(agentSchedules.userId, userId)));

  const bundle: DbBundle = {
    version: BUNDLE_VERSION,
    project: {
      id: project.id,
      name: project.name,
      groupId: project.groupId ?? null,
      collapsed: project.collapsed,
      sortOrder: project.sortOrder,
      isAutoCreated: project.isAutoCreated,
      createdAt: ms(project.createdAt),
      updatedAt: ms(project.updatedAt),
    },
    nodePreferences: prefRows.map((p) => ({
      id: p.id,
      ownerType: p.ownerType,
      defaultWorkingDirectory: p.defaultWorkingDirectory ?? null,
      defaultShell: p.defaultShell ?? null,
      startupCommand: p.startupCommand ?? null,
      theme: p.theme ?? null,
      fontSize: p.fontSize ?? null,
      fontFamily: p.fontFamily ?? null,
      githubRepoId: p.githubRepoId ?? null,
      localRepoPath: p.localRepoPath ?? null,
      defaultAgentProvider: p.defaultAgentProvider ?? null,
      agentProviderSettings: p.agentProviderSettings ?? null,
      environmentVars: p.environmentVars ?? null,
      pinnedFiles: p.pinnedFiles ?? null,
      gitIdentityName: p.gitIdentityName ?? null,
      gitIdentityEmail: p.gitIdentityEmail ?? null,
      isSensitive: p.isSensitive,
    })),
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority,
      source: t.source,
      labels: t.labels,
      subtasks: t.subtasks,
      metadata: t.metadata,
      instructions: t.instructions ?? null,
      agentTaskKey: t.agentTaskKey ?? null,
      owner: t.owner ?? null,
      dueDate: msOrNull(t.dueDate),
      githubIssueUrl: t.githubIssueUrl ?? null,
      sortOrder: t.sortOrder,
      createdAt: ms(t.createdAt),
      updatedAt: ms(t.updatedAt),
    })),
    // Keep only edges whose BOTH endpoints are in-project (blocker membership
    // is guaranteed by the query; blocked could reference another project).
    taskDependencies: depRows
      .filter((d) => taskIdSet.has(d.blockerId) && taskIdSet.has(d.blockedId))
      .map((d) => ({ blockerId: d.blockerId, blockedId: d.blockedId })),
    channelGroups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      position: g.position,
      createdAt: ms(g.createdAt),
    })),
    channels: channelRows.map((c) => ({
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      displayName: c.displayName,
      type: c.type,
      topic: c.topic ?? null,
      isDefault: c.isDefault,
      lastMessageAt: msOrNull(c.lastMessageAt),
      messageCount: c.messageCount,
      archivedAt: msOrNull(c.archivedAt),
      createdAt: ms(c.createdAt),
    })),
    peerMessages: messageRows.map((m) => ({
      id: m.id,
      fromSessionName: m.fromSessionName,
      body: m.body,
      isUserMessage: m.isUserMessage,
      channelId: m.channelId ?? null,
      parentMessageId: m.parentMessageId ?? null,
      replyCount: m.replyCount,
      createdAt: ms(m.createdAt),
    })),
    mcpServers: mcpRows.map((s) => ({
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      env: s.env,
      enabled: s.enabled,
      autoStart: s.autoStart,
    })),
    agentConfigs: agentConfigRows.map((c) => ({
      provider: c.provider,
      configType: c.configType,
      content: c.content,
    })),
    projectSecrets,
    repositoryHint,
    githubAccountHint,
    profiles,
    triggerConfigs: bundleTriggers,
    agentSchedules: scheduleRows.map((s) => ({
      name: s.name,
      agentProvider: s.agentProvider,
      agentFlags: s.agentFlags,
      prompt: s.prompt,
      worktreeType: s.worktreeType ?? null,
      baseBranch: s.baseBranch ?? null,
      scheduleType: s.scheduleType,
      cronExpression: s.cronExpression ?? null,
      scheduledAt: msOrNull(s.scheduledAt),
      timezone: s.timezone,
      maxRetries: s.maxRetries,
      enabled: s.enabled,
    })),
  };

  log.info("DB bundle built", {
    projectId,
    tasks: bundle.tasks.length,
    channels: bundle.channels.length,
    messages: bundle.peerMessages.length,
    profiles: bundle.profiles.length,
    warnings: warnings.length,
  });

  return { bundle, warnings };
}
