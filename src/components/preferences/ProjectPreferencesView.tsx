"use client";

/**
 * Body of the project preferences form, extracted from the original
 * `ProjectPreferencesModal` so it can be used both as a Dialog child and as
 * the main surface of a `project-prefs` terminal-type session.
 *
 * The view owns its own loading / saving state and talks to
 * `/api/node-preferences/project/:id`. Dialog-specific chrome (title, close
 * chrome) is the caller's responsibility — this component only renders the
 * form, error, and action buttons.
 *
 * The `initialTab` prop is reserved for future tab-based navigation; today
 * the form is a single scrolling column and the value is not read, but it
 * is threaded through the terminal-type plugin metadata so callers can set
 * it once and have it survive reloads.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PathInput } from "@/components/common/PathInput";
import { AgentProviderConfigCard } from "@/components/agents";
import { AGENT_PROVIDERS, type AgentProviderType } from "@/types/session";
import {
  DEFAULT_AGENT_PROVIDER_SETTINGS,
  type AgentProviderSettingsMap,
} from "@/types/preferences";
import type { PinnedFile } from "@/types/pinned-files";

import { apiFetch } from "@/lib/api-fetch";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import type { UpdateFolderPreferencesInput } from "@/types/preferences";
const INHERIT_VALUE = "__inherit__";
type ConfigurableProvider = Exclude<AgentProviderType, "none">;

export type ProjectPrefsInitialTab =
  | "general"
  | "appearance"
  | "repository"
  | "environment";

interface Props {
  projectId: string;
  projectName?: string;
  /**
   * Optional sub-tab to open to. Reserved for future use — ignored today
   * but forwarded through terminal-type metadata so callers do not need to
   * drop it when wiring via the plugin path.
   */
  initialTab?: ProjectPrefsInitialTab | null;
  /** Called after a successful save / reset, and when "Cancel" is clicked. */
  onDone?: () => void;
  /**
   * Whether to render a description header with the project name. Dialog
   * callers render their own DialogHeader so they pass `false`.
   */
  showHeader?: boolean;
}

/** Fields valid on a project node (shared + project-only). */
interface ProjectPrefs {
  // Shared (same as group)
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  environmentVars?: Record<string, string> | null;
  gitIdentityName?: string | null;
  gitIdentityEmail?: string | null;
  isSensitive?: boolean;
  // Project-only
  githubRepoId?: string | null;
  localRepoPath?: string | null;
  defaultAgentProvider?: string | null;
  agentProviderSettings?: AgentProviderSettingsMap | null;
  pinnedFiles?: PinnedFile[] | null;
}

const EMPTY: ProjectPrefs = {};

export function ProjectPreferencesView({
  projectId,
  projectName,
  onDone,
  showHeader = false,
}: Props) {
  const [prefs, setPrefs] = useState<ProjectPrefs>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentOverridesOpen, setAgentOverridesOpen] = useState(false);

  // Route persistence through the preferences context so the shared
  // nodePreferences cache (used to resolve a session's working dir / agent
  // provider) is optimistically updated. Both handlers PUT/DELETE the same
  // /api/node-preferences/project/:id endpoint this view used directly, so the
  // network behavior is unchanged — but a project's prefs set here are now
  // immediately visible to new sessions without a page reload. (remote-dev-u84s)
  const { updateFolderPreferences, deleteFolderPreferences } =
    usePreferencesContext();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/node-preferences/project/${projectId}`);
        const body = await res.json();
        if (cancelled) return;
        setPrefs(body.preferences ?? EMPTY);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // `prefs` is the same payload the view PUT directly before; cast to the
      // context input type (the field shapes are runtime-compatible — both are
      // the node-preferences project surface).
      await updateFolderPreferences(
        projectId,
        prefs as UpdateFolderPreferencesInput
      );
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await deleteFolderPreferences(projectId);
      setPrefs(EMPTY);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {showHeader && (
        <p className="text-sm text-muted-foreground">
          Overrides and project-specific settings for{" "}
          {projectName ? <strong>{projectName}</strong> : "this project"}. Values
          fall back through parent groups when unset.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid gap-4 py-2">
          {/* Project-only section */}
          <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Project-specific
            </p>

            <div className="space-y-2">
              <Label htmlFor="project-repo-id">GitHub repo ID</Label>
              <Input
                id="project-repo-id"
                value={prefs.githubRepoId ?? ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, githubRepoId: e.target.value || null })
                }
                placeholder="owner/name or internal id"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-local-path">Local repo path</Label>
              <PathInput
                id="project-local-path"
                mode="directory"
                value={prefs.localRepoPath ?? ""}
                onChange={(v) =>
                  setPrefs({ ...prefs, localRepoPath: v || null })
                }
                placeholder="/path/to/repo"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-agent">Default agent provider</Label>
              <Select
                value={prefs.defaultAgentProvider ?? INHERIT_VALUE}
                onValueChange={(value) =>
                  setPrefs({
                    ...prefs,
                    defaultAgentProvider:
                      value === INHERIT_VALUE ? null : value,
                  })
                }
              >
                <SelectTrigger
                  id="project-agent"
                  className="bg-card/50 border-border focus:border-primary"
                >
                  <SelectValue placeholder="(inherit)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_VALUE}>(inherit)</SelectItem>
                  {AGENT_PROVIDERS.filter((p) => p.id !== "none").map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setAgentOverridesOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {agentOverridesOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Per-agent overrides
                {prefs.agentProviderSettings && (
                  <span className="ml-1 text-[10px] text-primary">Custom</span>
                )}
              </button>
              {agentOverridesOpen && (
                <div className="space-y-3 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    Project-level entries replace the user-level entry for the
                    same provider key.
                  </p>
                  {AGENT_PROVIDERS.filter(
                    (p): p is typeof p & { id: ConfigurableProvider } =>
                      p.id !== "none"
                  ).map((provider) => (
                    <AgentProviderConfigCard
                      key={provider.id}
                      provider={provider}
                      settings={
                        prefs.agentProviderSettings?.[provider.id] ??
                        DEFAULT_AGENT_PROVIDER_SETTINGS
                      }
                      onChange={(next) => {
                        const map = {
                          ...(prefs.agentProviderSettings ?? {}),
                          [provider.id]: next,
                        };
                        setPrefs({ ...prefs, agentProviderSettings: map });
                      }}
                    />
                  ))}
                  {prefs.agentProviderSettings && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPrefs({ ...prefs, agentProviderSettings: null })
                      }
                    >
                      Clear all overrides (use user defaults)
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-pinned">Pinned files (one per line)</Label>
              <textarea
                id="project-pinned"
                value={(Array.isArray(prefs.pinnedFiles)
                  ? prefs.pinnedFiles
                  : []
                )
                  .map((f) => f.path)
                  .filter(Boolean)
                  .join("\n")}
                onChange={(e) => {
                  const existing = Array.isArray(prefs.pinnedFiles)
                    ? prefs.pinnedFiles
                    : [];
                  const byPath = new Map(existing.map((f) => [f.path, f]));
                  const now = new Date().toISOString();
                  const items: PinnedFile[] = e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((path, index) => {
                      const prev = byPath.get(path);
                      if (prev) {
                        // Preserve existing metadata; refresh sortOrder.
                        return { ...prev, sortOrder: index };
                      }
                      const name = path.split("/").pop() ?? path;
                      return {
                        id: crypto.randomUUID(),
                        path,
                        name,
                        sortOrder: index,
                        createdAt: now,
                      };
                    });
                  setPrefs({
                    ...prefs,
                    pinnedFiles: items.length ? items : null,
                  });
                }}
                rows={3}
                placeholder="CLAUDE.md\ndocs/ARCHITECTURE.md"
                className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Shared section */}
          <div className="space-y-2">
            <Label htmlFor="project-cwd">Default working directory</Label>
            <PathInput
              id="project-cwd"
              mode="directory"
              value={prefs.defaultWorkingDirectory ?? ""}
              onChange={(v) =>
                setPrefs({
                  ...prefs,
                  defaultWorkingDirectory: v || null,
                })
              }
              placeholder="/path/to/workspace"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-shell">Default shell</Label>
            <Input
              id="project-shell"
              value={prefs.defaultShell ?? ""}
              onChange={(e) =>
                setPrefs({ ...prefs, defaultShell: e.target.value || null })
              }
              placeholder="/bin/zsh"
              className="bg-card/50 border-border focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="project-theme">Theme</Label>
              <Input
                id="project-theme"
                value={prefs.theme ?? ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, theme: e.target.value || null })
                }
                placeholder="tokyo-night"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-font-size">Font size</Label>
              <Input
                id="project-font-size"
                type="number"
                min={8}
                max={36}
                value={prefs.fontSize ?? ""}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    fontSize: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-font-family">Font family</Label>
            <Input
              id="project-font-family"
              value={prefs.fontFamily ?? ""}
              onChange={(e) =>
                setPrefs({ ...prefs, fontFamily: e.target.value || null })
              }
              placeholder="'JetBrainsMono Nerd Font Mono', monospace"
              className="bg-card/50 border-border focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="project-git-name">Git identity name</Label>
              <Input
                id="project-git-name"
                value={prefs.gitIdentityName ?? ""}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    gitIdentityName: e.target.value || null,
                  })
                }
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-git-email">Git identity email</Label>
              <Input
                id="project-git-email"
                value={prefs.gitIdentityEmail ?? ""}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    gitIdentityEmail: e.target.value || null,
                  })
                }
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-env">Environment variables (JSON)</Label>
            <textarea
              id="project-env"
              value={
                prefs.environmentVars
                  ? JSON.stringify(prefs.environmentVars, null, 2)
                  : ""
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw.trim()) {
                  setPrefs({ ...prefs, environmentVars: null });
                  setError(null);
                  return;
                }
                try {
                  const parsed = JSON.parse(raw);
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                  ) {
                    setPrefs({
                      ...prefs,
                      environmentVars: parsed as Record<string, string>,
                    });
                    setError(null);
                  } else {
                    setError("environmentVars must be a JSON object");
                  }
                } catch {
                  setError("Invalid JSON for environment variables");
                }
              }}
              rows={4}
              placeholder='{ "NODE_ENV": "development" }'
              className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={reset} disabled={saving || loading}>
          Reset to inherited
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onDone?.()} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
