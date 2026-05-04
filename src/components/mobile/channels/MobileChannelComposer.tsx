"use client";

/**
 * MobileChannelComposer — autocorrect-ON prose composer for the mobile
 * Channels tab.
 *
 * Same external shape as the terminal {@link MobileInputBar} (textarea +
 * trailing send button, long-press = insert without firing) but tuned for
 * prose: autocorrect / autocapitalize / spellcheck on, no terminal modifier
 * machinery, plain `\n` newlines (Shift+Enter), and an `enterkeyhint="send"`
 * hint so soft keyboards show a Send affordance.
 *
 * Long-press semantics:
 *   - tap send  → submit current value, clear
 *   - hold 400ms→ "insert without sending" — keeps the text in the textarea so
 *     the user can edit and follow up before posting. Mirrors the terminal
 *     bar's "compose-without-execute" gesture so muscle memory carries.
 *
 * No `backdrop-filter` / glass — solid `bg-card` with a single hairline top
 * border per DESIGN.md "Flat-By-Default Rule".
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 400;
const PEEK_DURATION_MS = 600;

export interface MobileChannelComposerProps {
  /**
   * Submit handler. Receives the trimmed body. The composer optimistically
   * clears the textarea before awaiting the result, but if the returned
   * promise REJECTS the draft is restored and an error toast is shown so
   * the user can retry without retyping. Returning normally (or resolving
   * a non-rejection) is treated as success.
   */
  onSubmit: (text: string) => void | Promise<unknown>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Reflects the post status — when true the composer is locked to prevent
   * double-submits. */
  busy?: boolean;
}

export const MobileChannelComposer = forwardRef<
  HTMLTextAreaElement,
  MobileChannelComposerProps
>(function MobileChannelComposer(
  { onSubmit, disabled = false, placeholder = "Message", className, busy = false },
  ref
) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textareaRef.current!, []);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  const resetHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) ta.style.height = "auto";
  }, []);

  const submit = useCallback(() => {
    if (disabled || busy) return;
    const trimmed = valueRef.current.trim();
    if (!trimmed) return;
    // Optimistically clear the input so the keyboard/textarea reflects a
    // clean send, but remember the draft so we can restore it if the
    // submit rejects. Without restoration the user loses what they typed
    // when the network or server fails.
    const draft = valueRef.current;
    setValue("");
    resetHeight();
    void Promise.resolve(onSubmit(trimmed)).catch(() => {
      setValue(draft);
      // Resize back to the draft's content height on the next paint.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
      });
      toast.error("Failed to send. Try again.");
    });
  }, [disabled, busy, onSubmit, resetHeight]);

  const handleFormSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      // Long-press fires its own action and pre-empts the click; gate here too
      // so a fast-tap right after a long-press doesn't double-post.
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      submit();
    },
    [submit]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  const handleInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const handleSendPointerDown = useCallback(() => {
    if (disabled || busy) return;
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      // Long-press = "insert without send": keep the value in the textarea
      // so the author can edit further. We just give a brief visual ack.
      if (!valueRef.current.trim()) return;
      setLongPressActive(true);
      window.setTimeout(() => setLongPressActive(false), PEEK_DURATION_MS);
    }, LONG_PRESS_MS);
  }, [disabled, busy]);

  const handleSendPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      clearLongPressTimer();
      if (longPressFiredRef.current) {
        // Don't let the click bubble into a submit.
        e.preventDefault();
      }
    },
    [clearLongPressTimer]
  );

  const handleSendClick = useCallback((e: MouseEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      longPressFiredRef.current = false;
    }
  }, []);

  const canSend = value.trim().length > 0 && !busy && !disabled;

  return (
    <form
      onSubmit={handleFormSubmit}
      data-testid="mobile-channel-composer"
      className={cn(
        // Solid bg-card per DESIGN.md "Flat-By-Default Rule" + "Glass-Earns-Its-Place".
        "flex items-end gap-1.5 border-t border-border bg-card px-2 py-1.5",
        className
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder}
        disabled={disabled || busy}
        rows={1}
        // Autocorrect ON for prose. Mirrors mail / chat clients.
        autoComplete="on"
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
        enterKeyHint="send"
        data-testid="mobile-channel-composer-textarea"
        className={cn(
          "flex-1 min-h-[2.25rem] max-h-32 resize-none rounded-lg px-3 py-2",
          "bg-muted/50 text-foreground text-sm leading-snug",
          "placeholder:text-muted-foreground/60",
          "focus:outline-none focus:ring-1 focus:ring-ring/60",
          "overflow-y-auto",
          (disabled || busy) && "opacity-50 cursor-not-allowed"
        )}
      />

      <button
        type="submit"
        disabled={!canSend && !longPressActive}
        onPointerDown={handleSendPointerDown}
        onPointerUp={handleSendPointerUp}
        onPointerCancel={clearLongPressTimer}
        onClick={handleSendClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Send message (hold to keep editing)"
        data-testid="mobile-channel-composer-send"
        className={cn(
          "relative shrink-0 rounded-md p-2 touch-manipulation",
          "min-h-[44px] min-w-[44px] flex items-center justify-center",
          "transition-colors duration-200",
          !canSend && !longPressActive && "text-muted-foreground/40",
          canSend && !longPressActive && "text-foreground active:bg-accent/40",
          longPressActive && "text-foreground bg-accent/30"
        )}
      >
        <Send className="h-4 w-4" />
        {longPressActive ? (
          <span
            role="status"
            className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-sm"
          >
            Kept for editing
          </span>
        ) : null}
      </button>
    </form>
  );
});
