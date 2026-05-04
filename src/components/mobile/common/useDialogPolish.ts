"use client";

/**
 * useDialogPolish — shared accessibility primitives for modal-style mobile
 * panels (BottomSheet, MobileThreadTakeover, etc.).
 *
 * Three concerns rolled into one hook so call sites stay short:
 *
 *  1. **Body scroll lock** — refcounted on `document.body.dataset.scrollLockCount`
 *     so concurrent sheets/takeovers can't clobber each other's locked state.
 *     Naive save/restore breaks under nesting: a second dialog would save
 *     `prev = "hidden"` (set by the first), and on its close would restore
 *     "hidden" — locking scroll forever. Only the first dialog actually
 *     applies the lock; only the last one to close releases it.
 *
 *  2. **Focus trap** — WCAG / `aria-modal="true"` compliance. When the
 *     dialog enters, move focus to the first focusable child (or the panel
 *     itself when no focusable children exist), trap Tab/Shift+Tab inside,
 *     and restore focus to the previously-focused element on close.
 *
 *  3. **ESC handling with topmost-modal stack** — when stacked dialogs are
 *     open (e.g. a BottomSheet over a MobileThreadTakeover), pressing
 *     Escape must close ONLY the topmost panel. We push each active dialog
 *     onto a module-level stack and only fire `onEscape` for the dialog
 *     whose id is on top. This replaces the per-component window-level ESC
 *     listeners that previously closed every layer at once.
 *
 * Both visual effects key on the `active` flag so callers using a two-phase
 * mount/transition lifecycle (`mounted` + `entered`) can pass `entered`
 * here and have the polish track the visible state of the dialog.
 */

import { useEffect, useRef, type RefObject } from "react";

export interface UseDialogPolishOptions {
  /**
   * When true the dialog is considered visible and interactive: the body
   * scroll lock is applied, the focus trap is engaged, and ESC handling is
   * registered. When false, all three effects are released.
   */
  active: boolean;
  /** The dialog's outer panel — used as the focus trap root. */
  panelRef: RefObject<HTMLElement | null>;
  /**
   * Optional ESC handler. When provided, ESC will only fire it while this
   * dialog is on top of the modal stack — so a BottomSheet rendered over a
   * MobileThreadTakeover can close itself without dismissing the takeover
   * underneath.
   */
  onEscape?: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Module-level monotonic id and stack of currently-active dialog ids. The
// last entry is the topmost dialog; only it should respond to ESC.
let nextDialogId = 0;
const dialogStack: number[] = [];

export function useDialogPolish({ active, panelRef, onEscape }: UseDialogPolishOptions) {
  // A stable id per call site so the ESC handler can ask "am I on top?".
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) {
    idRef.current = ++nextDialogId;
  }

  // Body scroll lock with refcount.
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const body = document.body;
    const count = Number(body.dataset.scrollLockCount ?? "0") + 1;
    body.dataset.scrollLockCount = String(count);
    if (count === 1) body.style.overflow = "hidden";
    return () => {
      const next = Math.max(
        0,
        Number(body.dataset.scrollLockCount ?? "1") - 1
      );
      body.dataset.scrollLockCount = String(next);
      if (next === 0) body.style.overflow = "";
    };
  }, [active]);

  // Modal stack registration. Push on activate, pop on deactivate so
  // `dialogStack[length-1]` always points at the topmost open dialog.
  useEffect(() => {
    if (!active) return;
    const id = idRef.current;
    if (id === null) return;
    dialogStack.push(id);
    return () => {
      const idx = dialogStack.lastIndexOf(id);
      if (idx >= 0) dialogStack.splice(idx, 1);
    };
  }, [active]);

  // ESC handling — only fires when this dialog is on top of the stack. We
  // keep a ref to the latest handler so callers don't have to memoize it.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    if (!active || !onEscape) return;
    const id = idRef.current;
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dialogStack[dialogStack.length - 1] !== id) return;
      onEscapeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // We intentionally only depend on `active` + presence of a handler; the
    // identity of the handler is read through a ref so callers don't need
    // to memoize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, !!onEscape]);

  // Focus trap.
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const getFocusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const initial = getFocusables()[0] ?? panel;
    initial.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = getFocusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [active, panelRef]);
}
