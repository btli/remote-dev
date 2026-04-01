"use client";

/**
 * CreateChannelModal — Dialog for creating a new channel.
 *
 * Auto-slugifies the channel name to lowercase-hyphenated format.
 * Validates the name and calls createChannel from ChannelContext on submit.
 */

import { useState, useCallback, type ChangeEvent } from "react";
import { useChannelContext } from "@/contexts/ChannelContext";
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
import { cn } from "@/lib/utils";

interface CreateChannelModalProps {
  open: boolean;
  onClose: () => void;
}

/** Converts arbitrary text to a valid channel slug. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 50);
}

/** Validates a channel name slug. */
function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name);
}

export function CreateChannelModal({ open, onClose }: CreateChannelModalProps) {
  const { createChannel } = useChannelContext();

  const [nameInput, setNameInput] = useState("");
  const [topic, setTopic] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugifiedName = slugify(nameInput);
  const nameIsValid = slugifiedName.length > 0 && isValidName(slugifiedName);

  function handleNameChange(e: ChangeEvent<HTMLInputElement>): void {
    setNameInput(e.target.value);
    setError(null);
  }

  function handleTopicChange(e: ChangeEvent<HTMLInputElement>): void {
    setTopic(e.target.value);
  }

  const handleCreate = useCallback(async () => {
    if (!nameIsValid || isCreating) return;

    setIsCreating(true);
    setError(null);
    try {
      await createChannel(slugifiedName, topic.trim() || undefined);
      // Reset form and close on success
      setNameInput("");
      setTopic("");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create channel"
      );
    } finally {
      setIsCreating(false);
    }
  }, [nameIsValid, isCreating, createChannel, slugifiedName, topic, onClose]);

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v && !isCreating) {
        setNameInput("");
        setTopic("");
        setError(null);
        onClose();
      }
    },
    [isCreating, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && nameIsValid && !isCreating) {
        e.preventDefault();
        handleCreate();
      }
    },
    [nameIsValid, isCreating, handleCreate]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Create a Channel</DialogTitle>
          <DialogDescription className="text-xs">
            Channels are where your team communicates. Give it a clear, lowercase
            name using letters, numbers, and hyphens.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Name input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Channel name
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none pointer-events-none">
                #
              </span>
              <Input
                value={nameInput}
                onChange={handleNameChange}
                onKeyDown={handleKeyDown}
                placeholder="e.g. general, bugs, release-v2"
                className={cn(
                  "pl-6 text-xs h-8",
                  error && "border-destructive focus-visible:ring-destructive"
                )}
                autoFocus
                maxLength={60}
                disabled={isCreating}
              />
            </div>
            {/* Preview slug */}
            {nameInput && (
              <p
                className={cn(
                  "text-[11px]",
                  nameIsValid
                    ? "text-muted-foreground"
                    : "text-destructive"
                )}
              >
                {nameIsValid
                  ? `Will be created as: #${slugifiedName}`
                  : "Name must be 1–50 lowercase alphanumeric characters or hyphens, and cannot start or end with a hyphen."}
              </p>
            )}
            {error && (
              <p className="text-[11px] text-destructive">{error}</p>
            )}
          </div>

          {/* Topic input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Topic{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              value={topic}
              onChange={handleTopicChange}
              onKeyDown={handleKeyDown}
              placeholder="What is this channel about?"
              className="text-xs h-8"
              maxLength={200}
              disabled={isCreating}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleCreate}
            disabled={!nameIsValid || isCreating}
          >
            {isCreating ? "Creating..." : "Create Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
