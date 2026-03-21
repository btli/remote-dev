"use client";

/**
 * LoopChatInput — Mobile-first chat input bar
 *
 * Auto-growing textarea that sends on Enter (Shift+Enter for newline).
 * Anchored to the bottom of the viewport with safe-area support.
 */

import { useCallback, useRef, useState } from "react";
import { Send, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoopChatInputProps {
  onSend: (text: string) => void;
  onConfigOpen?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function LoopChatInput({
  onSend,
  onConfigOpen,
  disabled = false,
  placeholder = "Type a message...",
}: LoopChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      // Auto-grow
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    []
  );

  const hasContent = value.trim().length > 0;

  return (
    <div className="flex-none border-t border-border bg-background/80 backdrop-blur-sm px-3 py-2 pb-safe-bottom">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        {onConfigOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onConfigOpen}
          >
            <Settings className="w-4 h-4" />
          </Button>
        )}

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              "w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm",
              "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "max-h-[120px] overflow-y-auto"
            )}
          />
        </div>

        <Button
          variant={hasContent ? "default" : "ghost"}
          size="icon"
          className={cn(
            "flex-shrink-0 h-8 w-8 rounded-full transition-colors",
            hasContent
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-muted-foreground"
          )}
          onClick={handleSend}
          disabled={!hasContent || disabled}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
