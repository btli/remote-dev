"use client";

import { useState, useCallback, forwardRef } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileInputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Native text input bar for mobile terminal sessions.
 *
 * Enables autocorrect, autocomplete, predictive text, and voice dictation
 * by using a standard HTML textarea instead of xterm.js's internal textarea
 * (which disables all of these to prevent duplication bugs).
 *
 * - Enter: submit text and clear
 * - Shift+Enter: insert literal newline
 * - Auto-expands height with content (max 8rem)
 */
export const MobileInputBar = forwardRef<HTMLTextAreaElement, MobileInputBarProps>(
  function MobileInputBar(
    {
      onSubmit,
      disabled = false,
      placeholder = "Type a message...",
      className,
    },
    ref
  ) {
    const [value, setValue] = useState("");

    const handleSubmit = useCallback(() => {
      // Trim prevents submitting whitespace-only input. Leading/trailing
      // spaces are stripped intentionally — mobile text entry rarely needs
      // them, and autocorrect often inserts trailing spaces.
      const trimmed = value.trim();
      if (!trimmed || disabled) return;

      onSubmit(trimmed + "\n");
      setValue("");
    }, [value, disabled, onSubmit]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit]
    );

    const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }, []);

    return (
      <div
        className={cn(
          "flex items-end gap-1.5 px-2 py-1.5 bg-popover/95 backdrop-blur-sm border-t border-border",
          className
        )}
      >
        {/* Native text input with autocorrect/voice enabled */}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          autoComplete="on"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          enterKeyHint="send"
          className={cn(
            "flex-1 min-h-[2.25rem] max-h-32 resize-none rounded-lg px-3 py-2",
            "bg-muted/50 text-foreground text-sm leading-snug",
            "placeholder:text-muted-foreground/60",
            "focus:outline-none focus:ring-1 focus:ring-primary/50",
            "overflow-y-auto",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "p-2 rounded-md shrink-0 touch-manipulation",
            "transition-colors duration-100",
            value.trim() && !disabled
              ? "text-primary active:bg-primary/20"
              : "text-muted-foreground/40"
          )}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    );
  }
);
