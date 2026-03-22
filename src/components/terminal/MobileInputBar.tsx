"use client";

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileInputBarProps {
  onSubmit: (text: string) => void;
  /** Send a single modifier-resolved sequence to the terminal (bypasses textarea) */
  onModifiedKeyPress?: (sequence: string) => void;
  onHeightChange?: () => void;
  /** Whether any sticky modifier is active (shows visual indicator) */
  modifierActive?: boolean;
  /** Resolve the next keystroke through active modifiers */
  resolveKey?: (key: string) => string;
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
 * - Enter / Send button: submit text and clear
 * - Shift+Enter: insert literal newline
 * - Auto-expands height with content (max 8rem)
 */
export const MobileInputBar = forwardRef<HTMLTextAreaElement, MobileInputBarProps>(
  function MobileInputBar(
    {
      onSubmit,
      onModifiedKeyPress,
      onHeightChange,
      modifierActive = false,
      resolveKey,
      disabled = false,
      placeholder = "Type a message...",
      className,
    },
    ref
  ) {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => textareaRef.current!, []);

    const resetTextareaHeight = useCallback(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
      }
      onHeightChange?.();
    }, [onHeightChange]);

    const handleSubmit = useCallback((e?: React.FormEvent) => {
      e?.preventDefault();
      if (disabled) return;

      onSubmit(value ? value + "\r" : "\r");
      setValue("");
      resetTextareaHeight();
    }, [value, disabled, onSubmit, resetTextareaHeight]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Sticky modifier interception: when a modifier is active, consume the next
        // real keystroke, resolve it through modifiers, and send directly to terminal.
        // Guards: skip hardware modifiers, IME composition, and non-character keys.
        if (modifierActive && resolveKey && onModifiedKeyPress && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const { key } = e;
          if (key.length === 1 || key === "Enter" || key === "Backspace") {
            e.preventDefault();
            const raw = key === "Enter" ? "\r" : key === "Backspace" ? "\x7f" : key;
            onModifiedKeyPress(resolveKey(raw));
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit, modifierActive, resolveKey, onModifiedKeyPress]
    );

    const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
      onHeightChange?.();
    }, [onHeightChange]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value),
      []
    );

    return (
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-1.5 px-2 py-1.5 bg-popover/95 backdrop-blur-sm border-t border-border",
          className
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
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
            disabled && "opacity-50 cursor-not-allowed",
            modifierActive && "ring-1 ring-primary/70 bg-primary/5"
          )}
        />

        <button
          type="submit"
          disabled={disabled}
          className={cn(
            "p-2 rounded-md shrink-0 touch-manipulation",
            "transition-colors duration-100",
            !disabled
              ? "text-primary active:bg-primary/20"
              : "text-muted-foreground/40"
          )}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    );
  }
);
