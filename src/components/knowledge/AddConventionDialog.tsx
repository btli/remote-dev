"use client";

/**
 * AddConventionDialog - Dialog for adding new conventions to project knowledge.
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
import { Input } from "@/components/ui/input";
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
import { Plus, X, Loader2 } from "lucide-react";
import { useProjectKnowledge, type Convention } from "@/hooks/useProjectKnowledge";

interface AddConventionDialogProps {
  folderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
}

type ConventionCategory = Convention["category"];

const CATEGORIES: { value: ConventionCategory; label: string }[] = [
  { value: "code_style", label: "Code Style" },
  { value: "naming", label: "Naming" },
  { value: "architecture", label: "Architecture" },
  { value: "testing", label: "Testing" },
  { value: "git", label: "Git" },
  { value: "other", label: "Other" },
];

export function AddConventionDialog({
  folderId,
  open,
  onOpenChange,
  onAdded,
}: AddConventionDialogProps) {
  const { addConvention } = useProjectKnowledge({ folderId, autoFetch: false });

  const [category, setCategory] = useState<ConventionCategory>("code_style");
  const [description, setDescription] = useState("");
  const [examples, setExamples] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddExample = () => {
    setExamples([...examples, ""]);
  };

  const handleRemoveExample = (index: number) => {
    setExamples(examples.filter((_, i) => i !== index));
  };

  const handleExampleChange = (index: number, value: string) => {
    const newExamples = [...examples];
    newExamples[index] = value;
    setExamples(newExamples);
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await addConvention({
        category,
        description: description.trim(),
        examples: examples.filter((e) => e.trim()),
        confidence: 1.0, // Manual entries have full confidence
        source: "manual",
      });

      // Reset form
      setCategory("code_style");
      setDescription("");
      setExamples([""]);

      onOpenChange(false);
      onAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add convention");
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
          <DialogTitle>Add Convention</DialogTitle>
          <DialogDescription>
            Define a code convention or standard for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ConventionCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
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
              placeholder="Describe the convention..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Examples */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Examples (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddExample}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {examples.map((example, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder={`Example ${index + 1}`}
                    value={example}
                    onChange={(e) => handleExampleChange(index, e.target.value)}
                  />
                  {examples.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveExample(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="capitalize">
                  {category.replace("_", " ")}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  100% confidence
                </Badge>
                <Badge variant="outline" className="text-xs">
                  manual
                </Badge>
              </div>
              <p className="text-sm">
                {description || <span className="text-muted-foreground">No description</span>}
              </p>
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
            Add Convention
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
