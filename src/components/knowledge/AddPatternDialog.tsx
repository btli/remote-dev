"use client";

/**
 * AddPatternDialog - Dialog for adding learned patterns to project knowledge.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useProjectKnowledge, type LearnedPattern } from "@/hooks/useProjectKnowledge";

interface AddPatternDialogProps {
  folderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
}

type PatternType = LearnedPattern["type"];

const PATTERN_TYPES: { value: PatternType; label: string; description: string }[] = [
  { value: "success", label: "Success", description: "Something that worked well" },
  { value: "failure", label: "Failure", description: "Something that didn't work" },
  { value: "preference", label: "Preference", description: "A preferred approach" },
  { value: "anti_pattern", label: "Anti-pattern", description: "Something to avoid" },
];

export function AddPatternDialog({
  folderId,
  open,
  onOpenChange,
  onAdded,
}: AddPatternDialogProps) {
  const { addPattern } = useProjectKnowledge({ folderId, autoFetch: false });

  const [type, setType] = useState<PatternType>("success");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await addPattern({
        type,
        description: description.trim(),
        context: context.trim(),
        confidence: 1.0,
      });

      // Reset form
      setType("success");
      setDescription("");
      setContext("");

      onOpenChange(false);
      onAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add pattern");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Pattern</DialogTitle>
          <DialogDescription>
            Record a learned pattern from your development experience.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Pattern Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as PatternType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PATTERN_TYPES.map((pt) => (
                  <SelectItem key={pt.value} value={pt.value}>
                    <div className="flex flex-col">
                      <span>{pt.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {pt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What did you learn?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Context */}
          <div className="space-y-2">
            <Label htmlFor="context">Context (optional)</Label>
            <Textarea
              id="context"
              placeholder="When does this apply?"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
            />
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant={type === "success" || type === "preference" ? "default" : "destructive"}
                  className="capitalize"
                >
                  {type.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-sm">
                {description || <span className="text-muted-foreground">No description</span>}
              </p>
              {context && (
                <p className="text-xs text-muted-foreground mt-1">
                  Context: {context}
                </p>
              )}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !description.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Pattern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
