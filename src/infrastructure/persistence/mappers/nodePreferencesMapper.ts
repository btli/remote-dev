import { NodePreferences } from "@/domain/value-objects/NodePreferences";
import { nodePreferences } from "@/db/schema";

export type NodePreferencesRow = typeof nodePreferences.$inferSelect;

export function toDomain(row: NodePreferencesRow): NodePreferences {
  const fields = {
    defaultWorkingDirectory: row.defaultWorkingDirectory,
    defaultShell: row.defaultShell,
    startupCommand: row.startupCommand,
    theme: row.theme,
    fontSize: row.fontSize,
    fontFamily: row.fontFamily,
    githubRepoId: row.githubRepoId,
    localRepoPath: row.localRepoPath,
    defaultAgentProvider: row.defaultAgentProvider,
    environmentVars: row.environmentVars as Record<string, string> | null,
    pinnedFiles: row.pinnedFiles as string[] | null,
    gitIdentityName: row.gitIdentityName,
    gitIdentityEmail: row.gitIdentityEmail,
    isSensitive: row.isSensitive,
  };
  return row.ownerType === "group"
    ? NodePreferences.forGroup(fields)
    : NodePreferences.forProject(fields);
}
