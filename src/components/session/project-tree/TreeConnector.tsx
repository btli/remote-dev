"use client";
import { type ReactNode } from "react";

interface Props {
  depth: number;
  isLastChild: boolean;
  children: ReactNode;
}

/**
 * Wrapper for tree rows. Previously rendered vertical nesting guide bars via
 * CSS custom properties consumed by a `.tree-item::before` pseudo-element.
 * The bars were removed (they didn't align reliably with parent rows and the
 * user preferred plain indentation), so this component is now a thin wrapper
 * that preserves the last-child data attribute for potential styling hooks.
 * `depth` is retained in the API because call-sites pass it through, but it
 * no longer drives any layout — indentation is owned by the individual row
 * components via `paddingLeft` / `marginLeft`.
 */
export function TreeConnector({ depth: _depth, isLastChild, children }: Props) {
  return (
    <div data-tree-last={isLastChild ? "true" : undefined}>
      {children}
    </div>
  );
}
