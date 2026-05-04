"use client";

/**
 * useDialogPolish — shared accessibility primitives for modal-style mobile
 * panels (BottomSheet, MobileThreadTakeover, etc.).
 *
 * Two concerns rolled into one hook so call sites stay short:
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
 * Both effects key on the `active` flag so callers using a two-phase
 * mount/transition lifecycle (`mounted` + `entered`) can pass `entered`
 * here and have the polish track the visible state of the dialog.
 */

import { useEffect, type RefObject } from "react";

export interface UseDialogPolishOptions {
  /**
   * When true the dialog is considered visible and interactive: the body
   * scroll lock is applied and the focus trap is engaged. When false, both
   * effects are released.
   */
  active: boolean;
  /** The dialog's outer panel — used as the focus trap root. */
  panelRef: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogPolish({ active, panelRef }: UseDialogPolishOptions) {
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
