"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Video } from "lucide-react";
import { formatDuration } from "@/types/recording";

interface SaveRecordingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description?: string) => Promise<void>;
  duration: number;
  sessionName?: string;
}

export function SaveRecordingModal({
  open,
  onClose,
  onSave,
  duration,
  sessionName,
}: SaveRecordingModalProps) {
  const [name, setName] = useState(
    sessionName ? `${sessionName} - Recording` : "Recording"
  );
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onSave(name.trim(), description.trim() || undefined);
      onClose();
    } catch (error) {
      console.error("Failed to save recording:", error);
    } finally {
      setSaving(false);
    }
  }, [name, description, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Video className="w-5 h-5 text-destructive" />
            Save Recording
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Your recording is {formatDuration(duration)} long. Give it a name to save it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-muted-foreground">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter recording name"
              className="bg-card/50 border-border text-foreground placeholder:text-muted-foreground/70"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-muted-foreground">
              Description (optional)
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              placeholder="Add a description..."
              className="bg-card/50 border-border text-foreground placeholder:text-muted-foreground/70"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            Discard
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? "Saving..." : "Save Recording"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
