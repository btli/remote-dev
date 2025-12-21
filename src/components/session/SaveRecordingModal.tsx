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
import { formatDuration } from "@/services/recording-service";

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
      <DialogContent className="sm:max-w-[425px] bg-slate-900/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-red-400" />
            Save Recording
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Your recording is {formatDuration(duration)} long. Give it a name to save it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter recording name"
              className="bg-slate-800/50 border-white/10 text-white placeholder:text-slate-500"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-slate-300">
              Description (optional)
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              placeholder="Add a description..."
              className="bg-slate-800/50 border-white/10 text-white placeholder:text-slate-500"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            Discard
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {saving ? "Saving..." : "Save Recording"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
