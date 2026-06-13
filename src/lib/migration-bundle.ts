/**
 * Wire contract for server-to-server project migration.
 *
 * KEEP STABLE & DEPENDENCY-LIGHT: this module defines the JSON shapes that
 * travel between two Remote Dev instances (possibly running different
 * versions). It must not import from `@/db`, services, or anything
 * Node-runtime-specific — only types and `zod` (validation at the import
 * boundary). Bump {@link BUNDLE_VERSION} on breaking shape changes; the
 * destination advertises its supported version via
 * `GET /api/migration/capabilities`.
 *
 * Conventions:
 * - All timestamps are epoch milliseconds (`number`) or `null` — never Date
 *   objects or ISO strings (except `BundleManifest.exportedAt`, ISO-8601 for
 *   human readability in staged manifests).
 * - Secrets travel DECRYPTED (`providerConfigPlain`) because the destination
 *   has a different AUTH_SECRET and re-encrypts with its own key on import.
 *   The transport is HTTPS + Bearer auth; bundles are never written to disk
 *   unencrypted on the source.
 * - Host-bound references (terminal sessions, tmux names, source-local file
 *   paths except working-dir hints) are stripped at export.
 */
import { z } from "zod";
import type { MigrationWorkingTreeMode } from "@/types/migration";

/** Version of the DbBundle / manifest wire format. */
export const BUNDLE_VERSION = 1;

/** Stage-2 file chunk size (bytes). Declared now so capabilities can advertise it. */
export const CHUNK_SIZE_BYTES = 64 * 1024 * 1024;

/**
 * Directory names excluded from working-tree transfer (stage 2). Dependency /
 * build / cache trees that are large and fully reproducible.
 */
export const EXCLUDE_PATTERNS = [
  "node_modules",
  ".next",
  "target",
  "dist",
  "build",
  ".venv",
  "__pycache__",
  ".turbo",
  ".cache",
] as const;

/** User-selected migration toggles (persisted on the source job row). */
export interface MigrationOptions {
  workingTreeMode: MigrationWorkingTreeMode;
  includeDotEnv: boolean;
  includeAgentCreds: boolean;
  includeSshKeys: boolean;
  includeAgentSettings: boolean;
  includeChannelHistory: boolean;
  removeSourceAfterVerify: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DbBundle row shapes (subset of DB columns that travel; host-bound and
// destination-recomputed fields are intentionally absent).
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleProject {
  /** Source project id. Destination keeps it when free, else remaps. */
  id: string;
  name: string;
  /** Source group id — informational only; imports land at the tree root. */
  groupId: string | null;
  collapsed: boolean;
  sortOrder: number;
  isAutoCreated: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BundleNodePreference {
  /** Source row id (informational; destination assigns a fresh uuid). */
  id: string;
  /** Always "project" in a bundle (group prefs do not migrate). */
  ownerType: string;
  defaultWorkingDirectory: string | null;
  defaultShell: string | null;
  startupCommand: string | null;
  theme: string | null;
  fontSize: number | null;
  fontFamily: string | null;
  /** Source-local github_repository uuid; destination re-links or nulls it. */
  githubRepoId: string | null;
  localRepoPath: string | null;
  defaultAgentProvider: string | null;
  agentProviderSettings: unknown;
  environmentVars: unknown;
  pinnedFiles: unknown;
  gitIdentityName: string | null;
  gitIdentityEmail: string | null;
  isSensitive: boolean;
}

export interface BundleTask {
  /** Source task id (dependency endpoints reference these; remapped on import). */
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  /** JSON array string (stored form). */
  labels: string;
  /** JSON array string (stored form). */
  subtasks: string;
  /** JSON object string (stored form). */
  metadata: string;
  instructions: string | null;
  agentTaskKey: string | null;
  owner: string | null;
  dueDate: number | null;
  githubIssueUrl: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface BundleTaskDependency {
  blockerId: string;
  blockedId: string;
}

export interface BundleChannelGroup {
  id: string;
  name: string;
  position: number;
  createdAt: number;
}

export interface BundleChannel {
  id: string;
  groupId: string;
  name: string;
  displayName: string;
  type: string;
  topic: string | null;
  isDefault: boolean;
  lastMessageAt: number | null;
  messageCount: number;
  archivedAt: number | null;
  createdAt: number;
}

export interface BundlePeerMessage {
  id: string;
  /** Display name survives; session ids are host-bound and stripped. */
  fromSessionName: string;
  body: string;
  isUserMessage: boolean;
  channelId: string | null;
  parentMessageId: string | null;
  replyCount: number;
  createdAt: number;
}

export interface BundleMcpServer {
  name: string;
  transport: string;
  command: string;
  /** JSON array string (stored form). */
  args: string;
  /** JSON object string (stored form). */
  env: string;
  enabled: boolean;
  autoStart: boolean;
}

export interface BundleAgentConfig {
  provider: string;
  configType: string;
  content: string;
}

/**
 * A secrets-provider config with the provider settings DECRYPTED
 * (`providerConfigPlain`) — the destination re-encrypts under its own
 * AUTH_SECRET before insert.
 */
export interface BundleSecretsConfig {
  provider: string;
  providerConfigPlain: Record<string, string>;
  enabled: boolean;
}

/** Relink HINT for a GitHub repository — never tokens, never source-local ids. */
export interface BundleRepositoryHint {
  githubId: number;
  fullName: string;
}

/** Relink HINT for a linked GitHub account. */
export interface BundleGithubAccountHint {
  providerAccountId: string;
  login: string;
}

export interface BundleProfileGitIdentity {
  userName: string;
  userEmail: string;
  /** Source-host path; only meaningful after a stage-2 ssh-key transfer. */
  sshKeyPath: string | null;
  gpgKeyId: string | null;
  githubUsername: string | null;
}

export interface BundleProfileAppearance {
  appearanceMode: string;
  lightColorScheme: string;
  darkColorScheme: string;
  terminalOpacity: number;
  terminalBlur: number;
  terminalCursorStyle: string;
}

export interface BundleProfileJsonConfig {
  agentType: string;
  configJson: string;
  isValid: boolean;
  validationErrors: string | null;
}

/** An agent profile linked to the project, with its satellite rows. */
export interface BundleProfile {
  /** Source profile id (remap key; destination always assigns a fresh uuid). */
  id: string;
  name: string;
  description: string | null;
  provider: string;
  /** Whether this was the source's default profile (informational). */
  isDefault: boolean;
  gitIdentity: BundleProfileGitIdentity | null;
  appearance: BundleProfileAppearance | null;
  jsonConfigs: BundleProfileJsonConfig[];
  secrets: BundleSecretsConfig | null;
}

export interface BundleTriggerConfig {
  name: string;
  kind: string;
  /** JSON object string (stored form). */
  filter: string;
  agentProvider: string;
  /** JSON array string (stored form). */
  agentFlags: string;
  promptTemplate: string;
  worktreeType: string | null;
  /** Source enabled state (imports are force-disabled pending review). */
  enabled: boolean;
  githubRepoHint: BundleRepositoryHint | null;
}

export interface BundleAgentSchedule {
  name: string;
  agentProvider: string;
  /** JSON array string (stored form). */
  agentFlags: string;
  prompt: string;
  worktreeType: string | null;
  baseBranch: string | null;
  scheduleType: string;
  cronExpression: string | null;
  scheduledAt: number | null;
  timezone: string;
  maxRetries: number;
  /** Source enabled state (imports are force-disabled to prevent double-firing). */
  enabled: boolean;
}

/**
 * The complete DB-row payload for one project migration, POSTed to the
 * destination as JSON. Sessions, run history, port claims, and stats caches
 * never migrate (host-bound or recomputable).
 */
export interface DbBundle {
  version: number;
  project: BundleProject;
  nodePreferences: BundleNodePreference[];
  tasks: BundleTask[];
  taskDependencies: BundleTaskDependency[];
  channelGroups: BundleChannelGroup[];
  channels: BundleChannel[];
  /** Populated only when MigrationOptions.includeChannelHistory. */
  peerMessages: BundlePeerMessage[];
  mcpServers: BundleMcpServer[];
  agentConfigs: BundleAgentConfig[];
  projectSecrets: BundleSecretsConfig | null;
  repositoryHint: BundleRepositoryHint | null;
  githubAccountHint: BundleGithubAccountHint | null;
  /** Profiles linked to the project via project_profile_link (0..1 today). */
  profiles: BundleProfile[];
  triggerConfigs: BundleTriggerConfig[];
  agentSchedules: BundleAgentSchedule[];
}

/**
 * Manifest describing a whole migration (DB bundle + stage-2 file chunks).
 * Sent with the import init and persisted in the staging dir.
 */
export interface BundleManifest {
  version: number;
  sourceInstanceUrl: string;
  sourceProjectId: string;
  sourceProjectName: string;
  /** ISO-8601 export time. */
  exportedAt: string;
  workingTreeMode: MigrationWorkingTreeMode;
  /** File chunks to expect in stage 2 (0 in stage 1). */
  totalChunks: number;
  /** Total file bytes to expect in stage 2 (0 in stage 1). */
  totalBytes: number;
  agentSettingsIncluded: boolean;
  /** Source profile ids included in the bundle. */
  profileIds: string[];
  warnings: string[];
}

/** A single non-fatal conflict the import resolved (or deferred to the user). */
export interface ConflictReport {
  type: string;
  message: string;
  detail?: string;
}

/** Result of a destination-side DB import. */
export interface ImportResult {
  importedProjectId: string;
  /** Source id → destination id for every remapped row. */
  idRemaps: Record<string, string>;
  conflicts: ConflictReport[];
  /** Rows inserted per logical table. */
  rowCounts: Record<string, number>;
}

/** Result of a destination-side verification pass. */
export interface VerifyResult {
  ok: boolean;
  rowCounts: Record<string, number>;
  /** Filesystem paths expected but missing (always empty in stage 1). */
  missingPaths: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod validation for the import boundary. Unknown keys are stripped (forward
// compatibility with newer same-major sources); enum-ish columns stay plain
// strings — the source is a trusted peer of the same product and over-strict
// enums here would break cross-version migrations.
// ─────────────────────────────────────────────────────────────────────────────

const msTimestamp = z.number().int();
const secretsConfigSchema = z.object({
  provider: z.string().min(1),
  providerConfigPlain: z.record(z.string(), z.string()),
  enabled: z.boolean(),
});
const repositoryHintSchema = z.object({
  githubId: z.number().int(),
  fullName: z.string().min(1),
});

export const dbBundleSchema: z.ZodType<DbBundle> = z.object({
  version: z.literal(BUNDLE_VERSION),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    groupId: z.string().nullable(),
    collapsed: z.boolean(),
    sortOrder: z.number().int(),
    isAutoCreated: z.boolean(),
    createdAt: msTimestamp,
    updatedAt: msTimestamp,
  }),
  nodePreferences: z.array(
    z.object({
      id: z.string().min(1),
      ownerType: z.string(),
      defaultWorkingDirectory: z.string().nullable(),
      defaultShell: z.string().nullable(),
      startupCommand: z.string().nullable(),
      theme: z.string().nullable(),
      fontSize: z.number().nullable(),
      fontFamily: z.string().nullable(),
      githubRepoId: z.string().nullable(),
      localRepoPath: z.string().nullable(),
      defaultAgentProvider: z.string().nullable(),
      agentProviderSettings: z.unknown(),
      environmentVars: z.unknown(),
      pinnedFiles: z.unknown(),
      gitIdentityName: z.string().nullable(),
      gitIdentityEmail: z.string().nullable(),
      isSensitive: z.boolean(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      description: z.string().nullable(),
      status: z.string(),
      priority: z.string(),
      source: z.string(),
      labels: z.string(),
      subtasks: z.string(),
      metadata: z.string(),
      instructions: z.string().nullable(),
      agentTaskKey: z.string().nullable(),
      owner: z.string().nullable(),
      dueDate: msTimestamp.nullable(),
      githubIssueUrl: z.string().nullable(),
      sortOrder: z.number().int(),
      createdAt: msTimestamp,
      updatedAt: msTimestamp,
    }),
  ),
  taskDependencies: z.array(
    z.object({
      blockerId: z.string().min(1),
      blockedId: z.string().min(1),
    }),
  ),
  channelGroups: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      position: z.number().int(),
      createdAt: msTimestamp,
    }),
  ),
  channels: z.array(
    z.object({
      id: z.string().min(1),
      groupId: z.string().min(1),
      name: z.string(),
      displayName: z.string(),
      type: z.string(),
      topic: z.string().nullable(),
      isDefault: z.boolean(),
      lastMessageAt: msTimestamp.nullable(),
      messageCount: z.number().int(),
      archivedAt: msTimestamp.nullable(),
      createdAt: msTimestamp,
    }),
  ),
  peerMessages: z.array(
    z.object({
      id: z.string().min(1),
      fromSessionName: z.string(),
      body: z.string(),
      isUserMessage: z.boolean(),
      channelId: z.string().nullable(),
      parentMessageId: z.string().nullable(),
      replyCount: z.number().int(),
      createdAt: msTimestamp,
    }),
  ),
  mcpServers: z.array(
    z.object({
      name: z.string(),
      transport: z.string(),
      command: z.string(),
      args: z.string(),
      env: z.string(),
      enabled: z.boolean(),
      autoStart: z.boolean(),
    }),
  ),
  agentConfigs: z.array(
    z.object({
      provider: z.string(),
      configType: z.string(),
      content: z.string(),
    }),
  ),
  projectSecrets: secretsConfigSchema.nullable(),
  repositoryHint: repositoryHintSchema.nullable(),
  githubAccountHint: z
    .object({
      providerAccountId: z.string().min(1),
      login: z.string(),
    })
    .nullable(),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      description: z.string().nullable(),
      provider: z.string(),
      isDefault: z.boolean(),
      gitIdentity: z
        .object({
          userName: z.string(),
          userEmail: z.string(),
          sshKeyPath: z.string().nullable(),
          gpgKeyId: z.string().nullable(),
          githubUsername: z.string().nullable(),
        })
        .nullable(),
      appearance: z
        .object({
          appearanceMode: z.string(),
          lightColorScheme: z.string(),
          darkColorScheme: z.string(),
          terminalOpacity: z.number(),
          terminalBlur: z.number(),
          terminalCursorStyle: z.string(),
        })
        .nullable(),
      jsonConfigs: z.array(
        z.object({
          agentType: z.string(),
          configJson: z.string(),
          isValid: z.boolean(),
          validationErrors: z.string().nullable(),
        }),
      ),
      secrets: secretsConfigSchema.nullable(),
    }),
  ),
  triggerConfigs: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      filter: z.string(),
      agentProvider: z.string(),
      agentFlags: z.string(),
      promptTemplate: z.string(),
      worktreeType: z.string().nullable(),
      enabled: z.boolean(),
      githubRepoHint: repositoryHintSchema.nullable(),
    }),
  ),
  agentSchedules: z.array(
    z.object({
      name: z.string(),
      agentProvider: z.string(),
      agentFlags: z.string(),
      prompt: z.string(),
      worktreeType: z.string().nullable(),
      baseBranch: z.string().nullable(),
      scheduleType: z.string(),
      cronExpression: z.string().nullable(),
      scheduledAt: msTimestamp.nullable(),
      timezone: z.string(),
      maxRetries: z.number().int(),
      enabled: z.boolean(),
    }),
  ),
});

/** Zod schema for the migration options block (import init boundary). */
export const migrationOptionsSchema: z.ZodType<MigrationOptions> = z.object({
  workingTreeMode: z.enum(["full_tar", "git_essentials", "none"]),
  includeDotEnv: z.boolean(),
  includeAgentCreds: z.boolean(),
  includeSshKeys: z.boolean(),
  includeAgentSettings: z.boolean(),
  includeChannelHistory: z.boolean(),
  removeSourceAfterVerify: z.boolean(),
});

/** Zod schema for the bundle manifest (import init boundary). */
export const bundleManifestSchema: z.ZodType<BundleManifest> = z.object({
  version: z.literal(BUNDLE_VERSION),
  sourceInstanceUrl: z.string(),
  sourceProjectId: z.string().min(1),
  sourceProjectName: z.string(),
  exportedAt: z.string(),
  workingTreeMode: z.enum(["full_tar", "git_essentials", "none"]),
  totalChunks: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  agentSettingsIncluded: z.boolean(),
  profileIds: z.array(z.string()),
  warnings: z.array(z.string()),
});
