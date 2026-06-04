import { it, expect } from "vitest";
import * as sqliteSchema from "../schema.sqlite";
import * as pgSchema from "../schema.pg";

/**
 * COMPILE-TIME drift guard (fast suite + `bun run typecheck`).
 *
 * The SQLite and Postgres concrete schemas are codegen'd from the SAME
 * `src/db/schema.def.ts` (via scripts/lib/schema-codegen.ts `generateSchemas`),
 * so their inferred row types MUST be identical per table by construction. The
 * dialect facade (`@/db` / `@/db/schema`) leans on this: the active dialect's
 * table objects are cast to the SQLite-typed handles, which is only sound while
 * `$inferSelect` / `$inferInsert` match across dialects.
 *
 * Each table below gets a pair of compile-time assertions. If a column's
 * inferred TS type ever diverges between the two dialects (e.g. a hand-edit to
 * one generated file, a codegen mapping change that only lands in one dialect,
 * or a brand that fails to resolve), the corresponding `Expect<Equal<...>>`
 * resolves to `false` and `tsc --noEmit` errors out — failing CI before any
 * runtime test runs.
 *
 * `@type-challenges/utils` is not installed, so the `Equal` / `Expect` helpers
 * are defined locally. `Equal` is the standard inference-based exact-equality
 * check (identical to type-challenges' implementation); it is strict about
 * `readonly`, optionality, and union member identity.
 */

// Local exact-type-equality helper (no @type-challenges/utils dependency).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// Compiles only when its argument resolves to the literal `true`.
type Expect<T extends true> = T;

// Per-table $inferSelect / $inferInsert parity for ALL 74 tables. A drift makes
// one of these `false`, which is a compile error on the `true[]` annotation.
type _SchemaParity = [
  // users
  Expect<Equal<(typeof sqliteSchema.users)["$inferSelect"], (typeof pgSchema.users)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.users)["$inferInsert"], (typeof pgSchema.users)["$inferInsert"]>>,
  // userEmails
  Expect<Equal<(typeof sqliteSchema.userEmails)["$inferSelect"], (typeof pgSchema.userEmails)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.userEmails)["$inferInsert"], (typeof pgSchema.userEmails)["$inferInsert"]>>,
  // accounts
  Expect<Equal<(typeof sqliteSchema.accounts)["$inferSelect"], (typeof pgSchema.accounts)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.accounts)["$inferInsert"], (typeof pgSchema.accounts)["$inferInsert"]>>,
  // sessions
  Expect<Equal<(typeof sqliteSchema.sessions)["$inferSelect"], (typeof pgSchema.sessions)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sessions)["$inferInsert"], (typeof pgSchema.sessions)["$inferInsert"]>>,
  // verificationTokens
  Expect<Equal<(typeof sqliteSchema.verificationTokens)["$inferSelect"], (typeof pgSchema.verificationTokens)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.verificationTokens)["$inferInsert"], (typeof pgSchema.verificationTokens)["$inferInsert"]>>,
  // authorizedUsers
  Expect<Equal<(typeof sqliteSchema.authorizedUsers)["$inferSelect"], (typeof pgSchema.authorizedUsers)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.authorizedUsers)["$inferInsert"], (typeof pgSchema.authorizedUsers)["$inferInsert"]>>,
  // userSettings
  Expect<Equal<(typeof sqliteSchema.userSettings)["$inferSelect"], (typeof pgSchema.userSettings)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.userSettings)["$inferInsert"], (typeof pgSchema.userSettings)["$inferInsert"]>>,
  // githubRepositories
  Expect<Equal<(typeof sqliteSchema.githubRepositories)["$inferSelect"], (typeof pgSchema.githubRepositories)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubRepositories)["$inferInsert"], (typeof pgSchema.githubRepositories)["$inferInsert"]>>,
  // githubAccountMetadata
  Expect<Equal<(typeof sqliteSchema.githubAccountMetadata)["$inferSelect"], (typeof pgSchema.githubAccountMetadata)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubAccountMetadata)["$inferInsert"], (typeof pgSchema.githubAccountMetadata)["$inferInsert"]>>,
  // portRegistry
  Expect<Equal<(typeof sqliteSchema.portRegistry)["$inferSelect"], (typeof pgSchema.portRegistry)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.portRegistry)["$inferInsert"], (typeof pgSchema.portRegistry)["$inferInsert"]>>,
  // portClaims
  Expect<Equal<(typeof sqliteSchema.portClaims)["$inferSelect"], (typeof pgSchema.portClaims)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.portClaims)["$inferInsert"], (typeof pgSchema.portClaims)["$inferInsert"]>>,
  // sessionTemplates
  Expect<Equal<(typeof sqliteSchema.sessionTemplates)["$inferSelect"], (typeof pgSchema.sessionTemplates)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sessionTemplates)["$inferInsert"], (typeof pgSchema.sessionTemplates)["$inferInsert"]>>,
  // sessionRecordings
  Expect<Equal<(typeof sqliteSchema.sessionRecordings)["$inferSelect"], (typeof pgSchema.sessionRecordings)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sessionRecordings)["$inferInsert"], (typeof pgSchema.sessionRecordings)["$inferInsert"]>>,
  // apiKeys
  Expect<Equal<(typeof sqliteSchema.apiKeys)["$inferSelect"], (typeof pgSchema.apiKeys)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.apiKeys)["$inferInsert"], (typeof pgSchema.apiKeys)["$inferInsert"]>>,
  // terminalSessions
  Expect<Equal<(typeof sqliteSchema.terminalSessions)["$inferSelect"], (typeof pgSchema.terminalSessions)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.terminalSessions)["$inferInsert"], (typeof pgSchema.terminalSessions)["$inferInsert"]>>,
  // trashItems
  Expect<Equal<(typeof sqliteSchema.trashItems)["$inferSelect"], (typeof pgSchema.trashItems)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.trashItems)["$inferInsert"], (typeof pgSchema.trashItems)["$inferInsert"]>>,
  // worktreeTrashMetadata
  Expect<Equal<(typeof sqliteSchema.worktreeTrashMetadata)["$inferSelect"], (typeof pgSchema.worktreeTrashMetadata)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.worktreeTrashMetadata)["$inferInsert"], (typeof pgSchema.worktreeTrashMetadata)["$inferInsert"]>>,
  // githubRepositoryStats
  Expect<Equal<(typeof sqliteSchema.githubRepositoryStats)["$inferSelect"], (typeof pgSchema.githubRepositoryStats)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubRepositoryStats)["$inferInsert"], (typeof pgSchema.githubRepositoryStats)["$inferInsert"]>>,
  // githubPullRequests
  Expect<Equal<(typeof sqliteSchema.githubPullRequests)["$inferSelect"], (typeof pgSchema.githubPullRequests)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubPullRequests)["$inferInsert"], (typeof pgSchema.githubPullRequests)["$inferInsert"]>>,
  // githubBranchProtection
  Expect<Equal<(typeof sqliteSchema.githubBranchProtection)["$inferSelect"], (typeof pgSchema.githubBranchProtection)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubBranchProtection)["$inferInsert"], (typeof pgSchema.githubBranchProtection)["$inferInsert"]>>,
  // githubStatsPreferences
  Expect<Equal<(typeof sqliteSchema.githubStatsPreferences)["$inferSelect"], (typeof pgSchema.githubStatsPreferences)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubStatsPreferences)["$inferInsert"], (typeof pgSchema.githubStatsPreferences)["$inferInsert"]>>,
  // githubChangeNotifications
  Expect<Equal<(typeof sqliteSchema.githubChangeNotifications)["$inferSelect"], (typeof pgSchema.githubChangeNotifications)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubChangeNotifications)["$inferInsert"], (typeof pgSchema.githubChangeNotifications)["$inferInsert"]>>,
  // githubIssues
  Expect<Equal<(typeof sqliteSchema.githubIssues)["$inferSelect"], (typeof pgSchema.githubIssues)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.githubIssues)["$inferInsert"], (typeof pgSchema.githubIssues)["$inferInsert"]>>,
  // sessionSchedules
  Expect<Equal<(typeof sqliteSchema.sessionSchedules)["$inferSelect"], (typeof pgSchema.sessionSchedules)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sessionSchedules)["$inferInsert"], (typeof pgSchema.sessionSchedules)["$inferInsert"]>>,
  // scheduleCommands
  Expect<Equal<(typeof sqliteSchema.scheduleCommands)["$inferSelect"], (typeof pgSchema.scheduleCommands)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.scheduleCommands)["$inferInsert"], (typeof pgSchema.scheduleCommands)["$inferInsert"]>>,
  // scheduleExecutions
  Expect<Equal<(typeof sqliteSchema.scheduleExecutions)["$inferSelect"], (typeof pgSchema.scheduleExecutions)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.scheduleExecutions)["$inferInsert"], (typeof pgSchema.scheduleExecutions)["$inferInsert"]>>,
  // commandExecutions
  Expect<Equal<(typeof sqliteSchema.commandExecutions)["$inferSelect"], (typeof pgSchema.commandExecutions)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.commandExecutions)["$inferInsert"], (typeof pgSchema.commandExecutions)["$inferInsert"]>>,
  // setupConfig
  Expect<Equal<(typeof sqliteSchema.setupConfig)["$inferSelect"], (typeof pgSchema.setupConfig)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.setupConfig)["$inferInsert"], (typeof pgSchema.setupConfig)["$inferInsert"]>>,
  // agentProfiles
  Expect<Equal<(typeof sqliteSchema.agentProfiles)["$inferSelect"], (typeof pgSchema.agentProfiles)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentProfiles)["$inferInsert"], (typeof pgSchema.agentProfiles)["$inferInsert"]>>,
  // agentConfigs
  Expect<Equal<(typeof sqliteSchema.agentConfigs)["$inferSelect"], (typeof pgSchema.agentConfigs)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentConfigs)["$inferInsert"], (typeof pgSchema.agentConfigs)["$inferInsert"]>>,
  // mcpServers
  Expect<Equal<(typeof sqliteSchema.mcpServers)["$inferSelect"], (typeof pgSchema.mcpServers)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.mcpServers)["$inferInsert"], (typeof pgSchema.mcpServers)["$inferInsert"]>>,
  // profileGitIdentities
  Expect<Equal<(typeof sqliteSchema.profileGitIdentities)["$inferSelect"], (typeof pgSchema.profileGitIdentities)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.profileGitIdentities)["$inferInsert"], (typeof pgSchema.profileGitIdentities)["$inferInsert"]>>,
  // profileSecretsConfig
  Expect<Equal<(typeof sqliteSchema.profileSecretsConfig)["$inferSelect"], (typeof pgSchema.profileSecretsConfig)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.profileSecretsConfig)["$inferInsert"], (typeof pgSchema.profileSecretsConfig)["$inferInsert"]>>,
  // mcpDiscoveredTools
  Expect<Equal<(typeof sqliteSchema.mcpDiscoveredTools)["$inferSelect"], (typeof pgSchema.mcpDiscoveredTools)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.mcpDiscoveredTools)["$inferInsert"], (typeof pgSchema.mcpDiscoveredTools)["$inferInsert"]>>,
  // mcpDiscoveredResources
  Expect<Equal<(typeof sqliteSchema.mcpDiscoveredResources)["$inferSelect"], (typeof pgSchema.mcpDiscoveredResources)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.mcpDiscoveredResources)["$inferInsert"], (typeof pgSchema.mcpDiscoveredResources)["$inferInsert"]>>,
  // agentActivityEvents
  Expect<Equal<(typeof sqliteSchema.agentActivityEvents)["$inferSelect"], (typeof pgSchema.agentActivityEvents)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentActivityEvents)["$inferInsert"], (typeof pgSchema.agentActivityEvents)["$inferInsert"]>>,
  // agentDailyStats
  Expect<Equal<(typeof sqliteSchema.agentDailyStats)["$inferSelect"], (typeof pgSchema.agentDailyStats)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentDailyStats)["$inferInsert"], (typeof pgSchema.agentDailyStats)["$inferInsert"]>>,
  // sessionMemory
  Expect<Equal<(typeof sqliteSchema.sessionMemory)["$inferSelect"], (typeof pgSchema.sessionMemory)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sessionMemory)["$inferInsert"], (typeof pgSchema.sessionMemory)["$inferInsert"]>>,
  // colorSchemes
  Expect<Equal<(typeof sqliteSchema.colorSchemes)["$inferSelect"], (typeof pgSchema.colorSchemes)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.colorSchemes)["$inferInsert"], (typeof pgSchema.colorSchemes)["$inferInsert"]>>,
  // appearanceSettings
  Expect<Equal<(typeof sqliteSchema.appearanceSettings)["$inferSelect"], (typeof pgSchema.appearanceSettings)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.appearanceSettings)["$inferInsert"], (typeof pgSchema.appearanceSettings)["$inferInsert"]>>,
  // agentProfileJsonConfigs
  Expect<Equal<(typeof sqliteSchema.agentProfileJsonConfigs)["$inferSelect"], (typeof pgSchema.agentProfileJsonConfigs)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentProfileJsonConfigs)["$inferInsert"], (typeof pgSchema.agentProfileJsonConfigs)["$inferInsert"]>>,
  // profileAppearanceSettings
  Expect<Equal<(typeof sqliteSchema.profileAppearanceSettings)["$inferSelect"], (typeof pgSchema.profileAppearanceSettings)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.profileAppearanceSettings)["$inferInsert"], (typeof pgSchema.profileAppearanceSettings)["$inferInsert"]>>,
  // projectTasks
  Expect<Equal<(typeof sqliteSchema.projectTasks)["$inferSelect"], (typeof pgSchema.projectTasks)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectTasks)["$inferInsert"], (typeof pgSchema.projectTasks)["$inferInsert"]>>,
  // taskDependencies
  Expect<Equal<(typeof sqliteSchema.taskDependencies)["$inferSelect"], (typeof pgSchema.taskDependencies)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.taskDependencies)["$inferInsert"], (typeof pgSchema.taskDependencies)["$inferInsert"]>>,
  // notificationEvents
  Expect<Equal<(typeof sqliteSchema.notificationEvents)["$inferSelect"], (typeof pgSchema.notificationEvents)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.notificationEvents)["$inferInsert"], (typeof pgSchema.notificationEvents)["$inferInsert"]>>,
  // pushTokens
  Expect<Equal<(typeof sqliteSchema.pushTokens)["$inferSelect"], (typeof pgSchema.pushTokens)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.pushTokens)["$inferInsert"], (typeof pgSchema.pushTokens)["$inferInsert"]>>,
  // agentPeerMessages
  Expect<Equal<(typeof sqliteSchema.agentPeerMessages)["$inferSelect"], (typeof pgSchema.agentPeerMessages)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentPeerMessages)["$inferInsert"], (typeof pgSchema.agentPeerMessages)["$inferInsert"]>>,
  // channelGroups
  Expect<Equal<(typeof sqliteSchema.channelGroups)["$inferSelect"], (typeof pgSchema.channelGroups)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.channelGroups)["$inferInsert"], (typeof pgSchema.channelGroups)["$inferInsert"]>>,
  // channels
  Expect<Equal<(typeof sqliteSchema.channels)["$inferSelect"], (typeof pgSchema.channels)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.channels)["$inferInsert"], (typeof pgSchema.channels)["$inferInsert"]>>,
  // channelReadState
  Expect<Equal<(typeof sqliteSchema.channelReadState)["$inferSelect"], (typeof pgSchema.channelReadState)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.channelReadState)["$inferInsert"], (typeof pgSchema.channelReadState)["$inferInsert"]>>,
  // systemUpdateCache
  Expect<Equal<(typeof sqliteSchema.systemUpdateCache)["$inferSelect"], (typeof pgSchema.systemUpdateCache)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.systemUpdateCache)["$inferInsert"], (typeof pgSchema.systemUpdateCache)["$inferInsert"]>>,
  // litellmConfig
  Expect<Equal<(typeof sqliteSchema.litellmConfig)["$inferSelect"], (typeof pgSchema.litellmConfig)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.litellmConfig)["$inferInsert"], (typeof pgSchema.litellmConfig)["$inferInsert"]>>,
  // litellmModels
  Expect<Equal<(typeof sqliteSchema.litellmModels)["$inferSelect"], (typeof pgSchema.litellmModels)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.litellmModels)["$inferInsert"], (typeof pgSchema.litellmModels)["$inferInsert"]>>,
  // projectGroups
  Expect<Equal<(typeof sqliteSchema.projectGroups)["$inferSelect"], (typeof pgSchema.projectGroups)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectGroups)["$inferInsert"], (typeof pgSchema.projectGroups)["$inferInsert"]>>,
  // projects
  Expect<Equal<(typeof sqliteSchema.projects)["$inferSelect"], (typeof pgSchema.projects)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projects)["$inferInsert"], (typeof pgSchema.projects)["$inferInsert"]>>,
  // nodePreferences
  Expect<Equal<(typeof sqliteSchema.nodePreferences)["$inferSelect"], (typeof pgSchema.nodePreferences)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.nodePreferences)["$inferInsert"], (typeof pgSchema.nodePreferences)["$inferInsert"]>>,
  // projectSecretsConfig
  Expect<Equal<(typeof sqliteSchema.projectSecretsConfig)["$inferSelect"], (typeof pgSchema.projectSecretsConfig)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectSecretsConfig)["$inferInsert"], (typeof pgSchema.projectSecretsConfig)["$inferInsert"]>>,
  // projectGitHubAccountLinks
  Expect<Equal<(typeof sqliteSchema.projectGitHubAccountLinks)["$inferSelect"], (typeof pgSchema.projectGitHubAccountLinks)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectGitHubAccountLinks)["$inferInsert"], (typeof pgSchema.projectGitHubAccountLinks)["$inferInsert"]>>,
  // projectProfileLinks
  Expect<Equal<(typeof sqliteSchema.projectProfileLinks)["$inferSelect"], (typeof pgSchema.projectProfileLinks)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectProfileLinks)["$inferInsert"], (typeof pgSchema.projectProfileLinks)["$inferInsert"]>>,
  // projectRepositories
  Expect<Equal<(typeof sqliteSchema.projectRepositories)["$inferSelect"], (typeof pgSchema.projectRepositories)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.projectRepositories)["$inferInsert"], (typeof pgSchema.projectRepositories)["$inferInsert"]>>,
  // sshConnections
  Expect<Equal<(typeof sqliteSchema.sshConnections)["$inferSelect"], (typeof pgSchema.sshConnections)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.sshConnections)["$inferInsert"], (typeof pgSchema.sshConnections)["$inferInsert"]>>,
  // [y5ch.6] notificationPreferences
  Expect<Equal<(typeof sqliteSchema.notificationPreferences)["$inferSelect"], (typeof pgSchema.notificationPreferences)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.notificationPreferences)["$inferInsert"], (typeof pgSchema.notificationPreferences)["$inferInsert"]>>,
  // [aehq] model-proxy tables
  // modelProxyTokens
  Expect<Equal<(typeof sqliteSchema.modelProxyTokens)["$inferSelect"], (typeof pgSchema.modelProxyTokens)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.modelProxyTokens)["$inferInsert"], (typeof pgSchema.modelProxyTokens)["$inferInsert"]>>,
  // modelUsageEvents
  Expect<Equal<(typeof sqliteSchema.modelUsageEvents)["$inferSelect"], (typeof pgSchema.modelUsageEvents)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.modelUsageEvents)["$inferInsert"], (typeof pgSchema.modelUsageEvents)["$inferInsert"]>>,
  // [oyej] automation tables
  // triggerConfigs
  Expect<Equal<(typeof sqliteSchema.triggerConfigs)["$inferSelect"], (typeof pgSchema.triggerConfigs)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.triggerConfigs)["$inferInsert"], (typeof pgSchema.triggerConfigs)["$inferInsert"]>>,
  // agentSchedules
  Expect<Equal<(typeof sqliteSchema.agentSchedules)["$inferSelect"], (typeof pgSchema.agentSchedules)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentSchedules)["$inferInsert"], (typeof pgSchema.agentSchedules)["$inferInsert"]>>,
  // agentRuns
  Expect<Equal<(typeof sqliteSchema.agentRuns)["$inferSelect"], (typeof pgSchema.agentRuns)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentRuns)["$inferInsert"], (typeof pgSchema.agentRuns)["$inferInsert"]>>,
  // triggerEvents
  Expect<Equal<(typeof sqliteSchema.triggerEvents)["$inferSelect"], (typeof pgSchema.triggerEvents)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.triggerEvents)["$inferInsert"], (typeof pgSchema.triggerEvents)["$inferInsert"]>>,
  // crownRuns
  Expect<Equal<(typeof sqliteSchema.crownRuns)["$inferSelect"], (typeof pgSchema.crownRuns)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.crownRuns)["$inferInsert"], (typeof pgSchema.crownRuns)["$inferInsert"]>>,
  // crownCandidates
  Expect<Equal<(typeof sqliteSchema.crownCandidates)["$inferSelect"], (typeof pgSchema.crownCandidates)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.crownCandidates)["$inferInsert"], (typeof pgSchema.crownCandidates)["$inferInsert"]>>,
  // [x386] chat & coordination tables
  // messageDelivery
  Expect<Equal<(typeof sqliteSchema.messageDelivery)["$inferSelect"], (typeof pgSchema.messageDelivery)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.messageDelivery)["$inferInsert"], (typeof pgSchema.messageDelivery)["$inferInsert"]>>,
  // messageReplayCursor
  Expect<Equal<(typeof sqliteSchema.messageReplayCursor)["$inferSelect"], (typeof pgSchema.messageReplayCursor)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.messageReplayCursor)["$inferInsert"], (typeof pgSchema.messageReplayCursor)["$inferInsert"]>>,
  // channelSubscription
  Expect<Equal<(typeof sqliteSchema.channelSubscription)["$inferSelect"], (typeof pgSchema.channelSubscription)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.channelSubscription)["$inferInsert"], (typeof pgSchema.channelSubscription)["$inferInsert"]>>,
  // agentWorkContext
  Expect<Equal<(typeof sqliteSchema.agentWorkContext)["$inferSelect"], (typeof pgSchema.agentWorkContext)["$inferSelect"]>>,
  Expect<Equal<(typeof sqliteSchema.agentWorkContext)["$inferInsert"], (typeof pgSchema.agentWorkContext)["$inferInsert"]>>,
];

// Force the assertion tuple to be evaluated: `true[]` only accepts a tuple
// whose every element is `true`. Referenced by the runtime test below so the
// type is not elided as unused.
const _parityHolds: _SchemaParity = [] as unknown as _SchemaParity;
void _parityHolds;

// Trivial runtime test so vitest treats this file as a (passing) suite. The
// real guarantee is the compile-time tuple above, enforced by `tsc`.
it("schema.sqlite and schema.pg expose the same 74 table exports", () => {
  const sqliteTables = Object.keys(sqliteSchema).sort();
  const pgTables = Object.keys(pgSchema).sort();
  expect(sqliteTables).toEqual(pgTables);
  // 61 base + 1 (y5ch: notification_preferences) + 2 (aehq: model_proxy_token,
  // model_usage_event) + 6 (oyej: agentSchedules, agentRuns, triggerConfigs,
  // triggerEvents, crownRuns, crownCandidates) + 4 (x386: messageDelivery,
  // messageReplayCursor, channelSubscription, agentWorkContext) = 74.
  expect(sqliteTables).toHaveLength(74);
});
