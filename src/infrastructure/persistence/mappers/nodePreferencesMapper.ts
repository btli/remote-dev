import { NodePreferences } from "@/domain/value-objects/NodePreferences";
import { nodePreferences } from "@/db/schema";

export type NodePreferencesRow = typeof nodePreferences.$inferSelect;

/**
 * Tolerate JSON columns coming back as either a parsed object (libsql JSON
 * mode) or a string (defensive for migration paths). Returns null on
 * malformed input rather than throwing — a corrupt row shouldn't block
 * the rest of the preferences flow.
 */
function parseAgentProviderSettings(
  raw: unknown,
): Record<string, { extraFlags: string[]; allowDangerous: boolean }> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<
        string,
        { extraFlags: string[]; allowDangerous: boolean }
      >;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as Record<string, { extraFlags: string[]; allowDangerous: boolean }>;
  }
  return null;
}

export function toDomain(row: NodePreferencesRow): NodePreferences {
  const fields = {
    defaultWorkingDirectory: row.defaultWorkingDirectory,
    defaultShell: row.defaultShell,
    theme: row.theme,
    fontSize: row.fontSize,
    fontFamily: row.fontFamily,
    githubRepoId: row.githubRepoId,
    localRepoPath: row.localRepoPath,
    defaultAgentProvider: row.defaultAgentProvider,
    agentProviderSettings: parseAgentProviderSettings(row.agentProviderSettings),
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
