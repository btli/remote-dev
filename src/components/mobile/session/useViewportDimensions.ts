"use client";

/**
 * useViewportDimensions, Phase 3 mobile session view.
 *
 * Computes terminal cols/rows from the rendered viewport's pixel size
 * and the current mono font (family + size). Recomputes on:
 *   - viewport resize (ResizeObserver — soft keyboard show/hide,
 *     orientation rotation, etc.)
 *   - fontFamily / fontSize change (pinch-to-zoom, preference update)
 *
 * Char-width is measured by rendering an off-screen `<span>` with a
 * known character count in the same font/size and reading the actual
 * `getBoundingClientRect().width / charCount`. Results are cached per
 * (fontFamily, fontSize) tuple in module scope so that quick toggles
 * don't re-measure.
 *
 * Notifications are debounced (75ms trailing) so a pinch gesture
 * doesn't spam dependent effects (e.g. WebSocket resize messages).
 *
 * Floors:
 *   - cols ≥ 20
 *   - rows ≥ 5
 *
 * Tiny viewports (e.g. inline iframe previews on dev tools) won't
 * produce a 0×0 PTY which would otherwise break tmux.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_COLS = 20;
const MIN_ROWS = 5;
const DEBOUNCE_MS = 75;
/**
 * Tailwind's `leading-relaxed` resolves to line-height 1.625; the `<pre>`
 * block in MobileSessionView uses that class. Keep this in sync with the
 * className on that element.
 */
const LINE_HEIGHT_RATIO = 1.625;
/**
 * Padding on the `<pre>` block (`p-2` = 0.5rem ≈ 8px) on each side.
 * Subtracted from the available width / height before computing cols /
 * rows so we don't try to render content into the padding.
 */
const PRE_PADDING_PX = 8;

const charWidthCache = new Map<string, number>();

/** Measure char width by rendering an off-screen span. Cached. */
export function measureCharWidth(
  fontFamily: string,
  fontSize: number,
  doc: Document = document
): number {
  const key = `${fontFamily}|${fontSize}`;
  const cached = charWidthCache.get(key);
  if (cached !== undefined) return cached;

  const span = doc.createElement("span");
  span.textContent = "M".repeat(20);
  span.style.fontFamily = fontFamily;
  span.style.fontSize = `${fontSize}px`;
  // Match the `<pre>` block: same whitespace, no kerning/ligature
  // weirdness.
  span.style.fontVariantLigatures = "none";
  span.style.whiteSpace = "pre";
  span.style.position = "absolute";
  span.style.left = "-9999px";
  span.style.top = "-9999px";
  span.style.visibility = "hidden";
  span.style.pointerEvents = "none";
  span.setAttribute("aria-hidden", "true");
  doc.body.appendChild(span);

  let charWidth: number;
  try {
    const width = span.getBoundingClientRect().width;
    charWidth = width > 0 ? width / 20 : fontSize * 0.6;
  } finally {
    span.remove();
  }

  // Approximation fallback — happy-dom returns 0 widths for layout-less
  // synthesized DOM. Use the conservative `fontSize * 0.6` heuristic so
  // tests that don't stub the measurement still get sane numbers.
  if (!Number.isFinite(charWidth) || charWidth <= 0) {
    charWidth = fontSize * 0.6;
  }

  charWidthCache.set(key, charWidth);
  return charWidth;
}

/** Reset the char-width cache (test hook). */
export function clearCharWidthCacheForTesting(): void {
  charWidthCache.clear();
}

export interface ViewportDimensions {
  cols: number;
  rows: number;
}

export interface UseViewportDimensionsOptions {
  /** Mono font family used by the `<pre>` block. */
  fontFamily: string;
  /** Mono font size in px. */
  fontSize: number;
  /** Disabled when the terminal is hidden (e.g. exit screen overlaid). */
  enabled?: boolean;
}

export interface UseViewportDimensionsResult {
  /** Attach to the host viewport element via `ref={dims.ref}`. */
  ref: (node: HTMLElement | null) => void;
  /** Current cols/rows. Floored to (MIN_COLS, MIN_ROWS). */
  dimensions: ViewportDimensions;
}

/**
 * Track terminal cols/rows from a viewport element's pixel size.
 *
 * Pure observation — does not touch the WebSocket. Consumers wire the
 * resulting dimensions into their PTY resize call.
 */
export function useViewportDimensions(
  options: UseViewportDimensionsOptions
): UseViewportDimensionsResult {
  const { fontFamily, fontSize, enabled = true } = options;

  const [dimensions, setDimensions] = useState<ViewportDimensions>(() => ({
    cols: MIN_COLS,
    rows: MIN_ROWS,
  }));

  const elementRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const compute = useCallback(
    (width: number, height: number): ViewportDimensions => {
      const usableWidth = Math.max(0, width - PRE_PADDING_PX * 2);
      const usableHeight = Math.max(0, height - PRE_PADDING_PX * 2);
      const charWidth = measureCharWidth(fontFamily, fontSize);
      const lineHeight = fontSize * LINE_HEIGHT_RATIO;

      const cols =
        charWidth > 0 ? Math.floor(usableWidth / charWidth) : MIN_COLS;
      const rows =
        lineHeight > 0 ? Math.floor(usableHeight / lineHeight) : MIN_ROWS;

      return {
        cols: Math.max(MIN_COLS, cols),
        rows: Math.max(MIN_ROWS, rows),
      };
    },
    [fontFamily, fontSize]
  );

  const recompute = useCallback(() => {
    const { width, height } = lastSizeRef.current;
    if (width === 0 && height === 0) return;
    const next = compute(width, height);
    setDimensions((prev) =>
      prev.cols === next.cols && prev.rows === next.rows ? prev : next
    );
  }, [compute]);

  const scheduleRecompute = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      recompute();
    }, DEBOUNCE_MS);
  }, [recompute]);

  // Recompute synchronously when font changes — char width caches are
  // keyed by (family, size) so this is cheap, and we want the new size
  // reflected before the next paint rather than after a debounce delay.
  useEffect(() => {
    recompute();
  }, [recompute]);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      // Detach old observer.
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      elementRef.current = node;
      if (!node || !enabled) return;

      // Seed an immediate size read so the first dimensions reflect
      // the actual rendered viewport rather than the (MIN_COLS, MIN_ROWS)
      // floor.
      const rect = node.getBoundingClientRect();
      lastSizeRef.current = { width: rect.width, height: rect.height };
      recompute();

      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const cr = entry.contentRect;
        lastSizeRef.current = { width: cr.width, height: cr.height };
        scheduleRecompute();
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [enabled, recompute, scheduleRecompute]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return { ref: setRef, dimensions };
}
