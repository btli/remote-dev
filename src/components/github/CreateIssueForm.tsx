"use client";

/**
 * CreateIssueForm - Inline form for creating new GitHub issues
 */

import { useState, useCallback } from "react";
import { ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface CreateIssueFormProps {
  repositoryUrl: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateIssueForm({
  repositoryUrl,
  onClose,
  onCreated,
}: CreateIssueFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!title.trim()) {
        setError("Title is required");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        // Extract owner and repo from URL
        const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) {
          throw new Error("Invalid repository URL");
        }
        const [, owner, repo] = match;

        const response = await fetch("/api/github/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner,
            repo,
            title: title.trim(),
            body: body.trim() || undefined,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to create issue");
        }

        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create issue");
      } finally {
        setIsSubmitting(false);
      }
    },
    [title, body, repositoryUrl, onCreated]
  );

  const handleOpenOnGitHub = useCallback(() => {
    // Pre-fill title and body in GitHub's new issue form
    const params = new URLSearchParams();
    if (title.trim()) params.set("title", title.trim());
    if (body.trim()) params.set("body", body.trim());

    const url = `${repositoryUrl}/issues/new${params.toString() ? `?${params.toString()}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [repositoryUrl, title, body]);

  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 px-2 text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back
        </Button>
        <span className="text-sm font-medium">Create New Issue</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="issue-title" className="text-xs">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="issue-title"
            placeholder="Issue title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-sm"
            disabled={isSubmitting}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="issue-body" className="text-xs">
            Description
          </Label>
          <Textarea
            id="issue-body"
            placeholder="Add a description... (supports Markdown)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[120px] text-sm resize-none"
            disabled={isSubmitting}
          />
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleOpenOnGitHub}
            className="text-xs text-muted-foreground"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            Open on GitHub instead
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || !title.trim()}
              className="text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Issue"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
