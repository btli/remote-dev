"use client";

import { useEffect, useState } from "react";
import { Briefcase, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

/** Fields valid on a project node (shared + project-only). */
interface ProjectPrefs {
  // Shared (same as group)
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  startupCommand?: string | null;
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
  pinnedFiles?: string[] | null;
}

const EMPTY: ProjectPrefs = {};

export function ProjectPreferencesModal({ open, onClose, projectId, projectName }: Props) {
  const [prefs, setPrefs] = useState<ProjectPrefs>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/node-preferences/project/${projectId}`);
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
  }, [open, projectId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/node-preferences/project/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      onClose();
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
      const res = await fetch(`/api/node-preferences/project/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Reset failed (${res.status})`);
      }
      setPrefs(EMPTY);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Briefcase className="w-5 h-5 text-primary" />
            Project Preferences
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Overrides and project-specific settings for{" "}
            {projectName ? <strong>{projectName}</strong> : "this project"}. Values fall back
            through parent groups when unset.
          </DialogDescription>
        </DialogHeader>

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
                <Input
                  id="project-local-path"
                  value={prefs.localRepoPath ?? ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, localRepoPath: e.target.value || null })
                  }
                  placeholder="/path/to/repo"
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-agent">Default agent provider</Label>
                <Input
                  id="project-agent"
                  value={prefs.defaultAgentProvider ?? ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, defaultAgentProvider: e.target.value || null })
                  }
                  placeholder="claude | codex | gemini | opencode"
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-pinned">Pinned files (one per line)</Label>
                <textarea
                  id="project-pinned"
                  value={(prefs.pinnedFiles ?? []).join("\n")}
                  onChange={(e) => {
                    const lines = e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    setPrefs({ ...prefs, pinnedFiles: lines.length ? lines : null });
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
              <Input
                id="project-cwd"
                value={prefs.defaultWorkingDirectory ?? ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, defaultWorkingDirectory: e.target.value || null })
                }
                placeholder="/path/to/workspace"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-shell">Default shell</Label>
              <Input
                id="project-shell"
                value={prefs.defaultShell ?? ""}
                onChange={(e) => setPrefs({ ...prefs, defaultShell: e.target.value || null })}
                placeholder="/bin/zsh"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-startup">Startup command</Label>
              <Input
                id="project-startup"
                value={prefs.startupCommand ?? ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, startupCommand: e.target.value || null })
                }
                placeholder="e.g., source .envrc"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="project-theme">Theme</Label>
                <Input
                  id="project-theme"
                  value={prefs.theme ?? ""}
                  onChange={(e) => setPrefs({ ...prefs, theme: e.target.value || null })}
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
                onChange={(e) => setPrefs({ ...prefs, fontFamily: e.target.value || null })}
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
                    setPrefs({ ...prefs, gitIdentityName: e.target.value || null })
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
                    setPrefs({ ...prefs, gitIdentityEmail: e.target.value || null })
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
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      setPrefs({ ...prefs, environmentVars: parsed as Record<string, string> });
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
            <Button variant="ghost" onClick={onClose} disabled={saving}>
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
      </DialogContent>
    </Dialog>
  );
}
