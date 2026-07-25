"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useScheduleTemplateContext } from "@/contexts/ScheduleTemplateContext";
import type { CreateScheduleTemplateInput } from "@/types/schedule-template";

interface SaveScheduleTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Omit<CreateScheduleTemplateInput, "name" | "description">;
  suggestedName?: string;
}

export function SaveScheduleTemplateDialog({
  open,
  onOpenChange,
  snapshot,
  suggestedName = "",
}: SaveScheduleTemplateDialogProps) {
  const { createTemplate } = useScheduleTemplateContext();
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }

    setSaving(true);
    setError(null);
    const template = await createTemplate({
      ...snapshot,
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setSaving(false);
    if (template) {
      onOpenChange(false);
    } else {
      setError("Failed to save schedule template");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Save as template</DialogTitle>
          <DialogDescription className="text-xs">
            Dates and anchor times are chosen fresh when the template is used.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-template-name" className="text-xs">
              Name *
            </Label>
            <Input
              id="schedule-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Morning checks"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-template-description" className="text-xs">
              Description
            </Label>
            <Input
              id="schedule-template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              className="h-8 text-xs"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
