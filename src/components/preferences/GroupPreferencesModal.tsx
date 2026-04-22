"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
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
  groupId: string;
  groupName?: string;
}

/** Fields valid on a group node (shared-only — no project-scoped fields). */
interface GroupPrefs {
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
}

const EMPTY: GroupPrefs = {};

export function GroupPreferencesModal({ open, onClose, groupId, groupName }: Props) {
  const [prefs, setPrefs] = useState<GroupPrefs>(EMPTY);
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
        const res = await fetch(`/api/node-preferences/group/${groupId}`);
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
  }, [open, groupId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/node-preferences/group/${groupId}`, {
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
      const res = await fetch(`/api/node-preferences/group/${groupId}`, {
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
      <DialogContent className="sm:max-w-[560px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Settings className="w-5 h-5 text-primary" />
            Group Preferences
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Shared defaults for {groupName ? <strong>{groupName}</strong> : "this group"} and all
            descendant projects. Project-specific fields (repository, agent) live on each project.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="group-cwd">Default working directory</Label>
              <Input
                id="group-cwd"
                value={prefs.defaultWorkingDirectory ?? ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, defaultWorkingDirectory: e.target.value || null })
                }
                placeholder="/path/to/workspace"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-shell">Default shell</Label>
              <Input
                id="group-shell"
                value={prefs.defaultShell ?? ""}
                onChange={(e) => setPrefs({ ...prefs, defaultShell: e.target.value || null })}
                placeholder="/bin/zsh"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-startup">Startup command</Label>
              <Input
                id="group-startup"
                value={prefs.startupCommand ?? ""}
                onChange={(e) => setPrefs({ ...prefs, startupCommand: e.target.value || null })}
                placeholder="e.g., source .envrc"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="group-theme">Theme</Label>
                <Input
                  id="group-theme"
                  value={prefs.theme ?? ""}
                  onChange={(e) => setPrefs({ ...prefs, theme: e.target.value || null })}
                  placeholder="tokyo-night"
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-font-size">Font size</Label>
                <Input
                  id="group-font-size"
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
              <Label htmlFor="group-font-family">Font family</Label>
              <Input
                id="group-font-family"
                value={prefs.fontFamily ?? ""}
                onChange={(e) => setPrefs({ ...prefs, fontFamily: e.target.value || null })}
                placeholder="'JetBrainsMono Nerd Font Mono', monospace"
                className="bg-card/50 border-border focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="group-git-name">Git identity name</Label>
                <Input
                  id="group-git-name"
                  value={prefs.gitIdentityName ?? ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, gitIdentityName: e.target.value || null })
                  }
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-git-email">Git identity email</Label>
                <Input
                  id="group-git-email"
                  value={prefs.gitIdentityEmail ?? ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, gitIdentityEmail: e.target.value || null })
                  }
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-env">Environment variables (JSON)</Label>
              <textarea
                id="group-env"
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
                    // Keep the text; flag invalid JSON but don't clobber state
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
