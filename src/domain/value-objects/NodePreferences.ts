export interface NodePreferencesFields {
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  githubRepoId?: string | null;
  localRepoPath?: string | null;
  defaultAgentProvider?: string | null;
  /**
   * Per-agent-provider settings (extra flags + allowDangerous). Stored as a
   * map keyed by provider id. Project-level entries REPLACE user-level
   * entries for the same provider key (no per-provider merge). The exact
   * shape is `AgentProviderSettingsMap` from `@/types/preferences`; this
   * layer keeps the type loose to avoid pulling preferences types into the
   * domain layer.
   */
  agentProviderSettings?: Record<string, { extraFlags: string[]; allowDangerous: boolean }> | null;
  environmentVars?: Record<string, string> | null;
  pinnedFiles?: string[] | null;
  gitIdentityName?: string | null;
  gitIdentityEmail?: string | null;
  isSensitive?: boolean;
}

const PROJECT_ONLY_FIELDS = new Set<keyof NodePreferencesFields>([
  "githubRepoId",
  "localRepoPath",
  "defaultAgentProvider",
  "agentProviderSettings",
  "pinnedFiles",
]);

export class NodePreferences {
  private constructor(public readonly fields: Readonly<NodePreferencesFields>) {}

  static forGroup(fields: NodePreferencesFields): NodePreferences {
    for (const key of Object.keys(fields) as (keyof NodePreferencesFields)[]) {
      if (PROJECT_ONLY_FIELDS.has(key) && fields[key] != null) {
        throw new Error(`Field '${String(key)}' is only valid on project preferences`);
      }
    }
    return new NodePreferences({ ...fields });
  }

  static forProject(fields: NodePreferencesFields): NodePreferences {
    return new NodePreferences({ ...fields });
  }

  merge(overlay: NodePreferences): NodePreferences {
    const envMerged =
      this.fields.environmentVars || overlay.fields.environmentVars
        ? { ...(this.fields.environmentVars ?? {}), ...(overlay.fields.environmentVars ?? {}) }
        : null;
    return new NodePreferences({
      ...this.fields,
      ...overlay.fields,
      environmentVars: envMerged,
    });
  }
}
