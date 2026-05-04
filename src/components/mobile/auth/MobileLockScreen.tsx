"use client";

/**
 * MobileLockScreen — interstitial shown while the browser is finishing the
 * Cloudflare Access challenge.
 *
 * Phase 6 of the mobile redesign. This is intentionally calm: a single
 * line of copy and an unobtrusive spinner. Per DESIGN.md "Achromatic-Default
 * Rule" the surface carries no chroma, no glassmorphism, no gradient. The
 * spinner uses the foreground token rather than a signal color because
 * "authenticating" is not a state the user needs to react to.
 *
 * Rendered above the rest of the mobile composition until the session
 * lands; once the session is available the host swaps to either
 * {@link MobileWelcomeScreen} (first run) or the Sessions tab.
 */

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MobileLockScreenProps {
  /**
   * Optional override for the primary line. Defaults to the Cloudflare
   * Access copy. Tests use this to assert variant rendering without
   * having to thread real auth state.
   */
  message?: string;
  /** Optional sub-line. */
  detail?: string;
  className?: string;
}

const DEFAULT_MESSAGE = "Authenticating via Cloudflare Access";
const DEFAULT_DETAIL = "Hold tight, this should only take a moment.";

export function MobileLockScreen({
  message = DEFAULT_MESSAGE,
  detail = DEFAULT_DETAIL,
  className,
}: MobileLockScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mobile-lock-screen"
      className={cn(
        "flex h-[100dvh] w-full flex-col items-center justify-center gap-3",
        "bg-background text-foreground",
        "px-6 text-center",
        className
      )}
    >
      <Loader2
        aria-hidden="true"
        className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        strokeWidth={1.75}
      />
      <p className="text-[15px] font-medium leading-tight">{message}</p>
      {detail ? (
        <p className="max-w-[28ch] text-[13px] leading-snug text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
