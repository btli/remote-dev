"use client";

/**
 * StubBody — placeholder body for Profile sub-screens whose full content
 * lands in a follow-up.
 *
 * Phase 6 ships the navigation chrome (Profile tab + push/pop stack +
 * sub-screen header) but defers the actual settings UI to follow-up
 * issues. Each sub-screen renders a header and one of these stubs so
 * the user can still navigate the surface and verify the back-stack
 * works on a real device.
 *
 * The copy is deliberately matter-of-fact, not marketing — per
 * PRODUCT.md "Trust the expert".
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StubBodyProps {
  /** One-line description of what the screen will eventually do. */
  description: ReactNode;
  /**
   * Optional reference to the desktop component that should be ported
   * for the full implementation. Rendered as a TODO note for engineers.
   */
  portFromComponent?: string;
  className?: string;
}

export function StubBody({
  description,
  portFromComponent,
  className,
}: StubBodyProps) {
  return (
    <div
      data-testid="mobile-profile-stub-body"
      className={cn(
        "flex flex-col gap-2 px-4 py-6 text-center",
        className
      )}
    >
      <p className="text-[13px] leading-snug text-muted-foreground">
        {description}
      </p>
      <p className="text-[12px] leading-snug text-muted-foreground/70">
        Mobile UI for this screen lands in a follow-up.
      </p>
      {portFromComponent ? (
        <p
          aria-hidden="true"
          className="mt-2 text-[11px] font-mono text-muted-foreground/50"
        >
          TODO: port from {portFromComponent}
        </p>
      ) : null}
    </div>
  );
}
