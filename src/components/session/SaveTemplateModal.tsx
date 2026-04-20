"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Briefcase, Loader2 } from "lucide-react";
import { useTemplateContext } from "@/contexts/TemplateContext";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { ProjectPickerCombobox } from "./ProjectPickerCombobox";
import type { TerminalSession } from "@/types/session";

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  session: TerminalSession | null;
}

export function SaveTemplateModal({
  open,
  onClose,
  session,
}: SaveTemplateModalProps) {
  const { createTemplate } = useTemplateContext();
  const { projects, activeNode } = useProjectTree();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sessionNamePattern, setSessionNamePattern] = useState("");
  const [startupCommand, setStartupCommand] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select project from: the session's projectId, else from the session's
  // legacy folderId (mapped via ProjectTreeContext), else the active project
  // node (if any).
  useEffect(() => {
    if (!open) return;
    if (session?.projectId) {
      setProjectId(session.projectId);
      return;
    }
    if (session?.folderId) {
      const mapped = projects.find(
        (p) => p.legacyFolderId === session.folderId
      );
      if (mapped) {
        setProjectId(mapped.id);
        return;
      }
    }
    if (activeNode?.type === "project") {
      setProjectId(activeNode.id);
    }
  }, [open, session?.projectId, session?.folderId, projects, activeNode]);

  // Reset form when session changes
  const handleOpen = (isOpen: boolean) => {
    if (isOpen && session) {
      setName(session.name + " Template");
      setSessionNamePattern(`${session.name} \${n}`);
      setStartupCommand("");
      setError(null);
    }
    if (!isOpen) {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        sessionNamePattern: sessionNamePattern.trim() || undefined,
        projectPath: session?.projectPath || undefined,
        startupCommand: startupCommand.trim() || undefined,
        // Phase 4: prefer projectId; keep folderId for legacy consumers.
        projectId: projectId ?? undefined,
        folderId: session?.folderId || undefined,
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-[425px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Save as Template
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a reusable template from this session configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="template-name" className="text-sm text-muted-foreground">
              Template Name *
            </Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Dev Environment"
              className="bg-card/50 border-border focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description" className="text-sm text-muted-foreground">
              Description
            </Label>
            <Input
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="bg-card/50 border-border focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-pattern" className="text-sm text-muted-foreground">
              Session Name Pattern
            </Label>
            <Input
              id="session-pattern"
              value={sessionNamePattern}
              onChange={(e) => setSessionNamePattern(e.target.value)}
              placeholder="Dev Server ${n}"
              className="bg-card/50 border-border focus:border-primary"
            />
            <p className="text-xs text-muted-foreground/70">
              Use {"${n}"} for counter, {"${date}"} for date, {"${time}"} for time
            </p>
          </div>

          {projects.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" />
                Project
              </Label>
              <ProjectPickerCombobox
                value={projectId}
                onChange={(id) => setProjectId(id)}
                placeholder="Select a project (optional)"
              />
              <p className="text-xs text-muted-foreground/70">
                Templates created in a project inherit its preferences.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="startup-command" className="text-sm text-muted-foreground">
              Startup Command
            </Label>
            <Input
              id="startup-command"
              value={startupCommand}
              onChange={(e) => setStartupCommand(e.target.value)}
              placeholder="npm run dev"
              className="bg-card/50 border-border focus:border-primary"
            />
            <p className="text-xs text-muted-foreground/70">
              Command to run when session starts
            </p>
          </div>

          {session?.projectPath && (
            <div className="p-3 rounded-lg bg-card/30 border border-border">
              <p className="text-xs text-muted-foreground/70 mb-1">Working Directory</p>
              <p className="text-sm text-muted-foreground font-mono truncate">
                {session.projectPath}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Template"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
