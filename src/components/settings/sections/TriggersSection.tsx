"use client";

/**
 * TriggersSection — Settings panel for GitHub-event automation triggers
 * (epic remote-dev-oyej.3). A trigger config binds a GitHub event kind +
 * filter to an agent-launch template; when a matching webhook event arrives
 * (`/api/webhooks/github`), a REAL agent run fires.
 *
 * This is a UI shell wired to `/api/trigger-configs` — list / create / toggle
 * / delete. Trigger configs are scoped to the active project. No business
 * logic lives here; the service validates kind + filter shape.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Zap, Loader2, Trash2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import type { TriggerKind } from "@/types/agent-run";

interface TriggerConfigDTO {
  id: string;
  name: string;
  kind: TriggerKind;
  filter: string;
  agentProvider: string;
  promptTemplate: string;
  worktreeType: string | null;
  enabled: boolean;
}

const KIND_OPTIONS: { value: TriggerKind; label: string }[] = [
  { value: "pr_labeled", label: "PR labeled" },
  { value: "issue_opened", label: "Issue opened" },
  { value: "ci_failed", label: "CI failed" },
];

const PROVIDER_OPTIONS = ["claude", "codex", "gemini", "opencode"];

export function TriggersSection() {
  const { activeNode } = useProjectTree();
  const projectId = activeNode?.type === "project" ? activeNode.id : null;

  const [configs, setConfigs] = useState<TriggerConfigDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"list" | "form">("list");

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/trigger-configs?projectId=${encodeURIComponent(projectId)}`,
      );
      const data = await res.json();
      setConfigs(data.configs ?? []);
    } catch {
      toast.error("Failed to load trigger configs");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleEnabled(cfg: TriggerConfigDTO) {
    try {
      await apiFetch(`/api/trigger-configs/${cfg.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !cfg.enabled }),
      });
      await refresh();
    } catch {
      toast.error("Failed to update trigger");
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/trigger-configs/${id}`, { method: "DELETE" });
      await refresh();
      toast.success("Trigger deleted");
    } catch {
      toast.error("Failed to delete trigger");
    }
  }

  if (!projectId) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Select a project to configure GitHub automation triggers.
      </div>
    );
  }

  if (view === "form") {
    return (
      <TriggerForm
        projectId={projectId}
        onCancel={() => setView("list")}
        onSaved={async () => {
          setView("list");
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Automation Triggers
          </h3>
          <p className="text-sm text-muted-foreground">
            Launch an agent run when a GitHub event matches.
          </p>
        </div>
        <Button size="sm" onClick={() => setView("form")}>
          <Plus className="w-4 h-4 mr-1" /> New Trigger
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : configs.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No triggers yet. Create one to react to PR labels, new issues, or CI
          failures.
        </div>
      ) : (
        <ul className="space-y-2">
          {configs.map((cfg) => (
            <li
              key={cfg.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {cfg.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {cfg.kind} · {cfg.agentProvider}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={cfg.enabled}
                  onCheckedChange={() => toggleEnabled(cfg)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(cfg.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TriggerForm({
  projectId,
  onCancel,
  onSaved,
}: {
  projectId: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TriggerKind>("pr_labeled");
  const [label, setLabel] = useState("agent:fix");
  const [agentProvider, setAgentProvider] = useState("claude");
  const [promptTemplate, setPromptTemplate] = useState(
    "Address {{repo}} #{{prNumber}}.",
  );
  const [worktreeType, setWorktreeType] = useState("fix");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const filter = kind === "pr_labeled" ? { label } : {};
      const res = await apiFetch("/api/trigger-configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name,
          kind,
          filter,
          agentProvider,
          promptTemplate,
          worktreeType: worktreeType || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to create trigger");
        return;
      }
      toast.success("Trigger created");
      await onSaved();
    } catch {
      toast.error("Failed to create trigger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={onCancel}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="space-y-2">
        <Label htmlFor="trigger-name">Name</Label>
        <Input
          id="trigger-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Auto-fix labeled PRs"
        />
      </div>

      <div className="space-y-2">
        <Label>Event</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as TriggerKind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === "pr_labeled" && (
        <div className="space-y-2">
          <Label htmlFor="trigger-label">Label filter</Label>
          <Input
            id="trigger-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="agent:fix"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Agent</Label>
        <Select value={agentProvider} onValueChange={setAgentProvider}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trigger-prompt">Prompt template</Label>
        <Textarea
          id="trigger-prompt"
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Placeholders: {"{{repo}}"} {"{{prNumber}}"} {"{{issueNumber}}"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trigger-worktree">Worktree type (optional)</Label>
        <Input
          id="trigger-worktree"
          value={worktreeType}
          onChange={(e) => setWorktreeType(e.target.value)}
          placeholder="fix"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !name}>
          {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Create
        </Button>
      </div>
    </div>
  );
}
