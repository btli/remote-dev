"use client";

/**
 * SubScreen — chrome wrapper for any pushed Profile screen.
 *
 * Phase 6 of the mobile redesign. Provides:
 *
 *   - A 44pt header strip with a back affordance ("‹ Back") and a title.
 *   - A scrollable body region.
 *   - The same 56pt+safe-area bottom inset reserved by `MobileShell` so
 *     the bottom tab bar never overlaps content.
 *
 * The visual register is deliberately quiet: hairline border under the
 * header, no shadow, no glass. Per DESIGN.md "Flat-By-Default Rule".
 *
 * Note: we render a native `<button>` with a chevron instead of relying
 * on the platform's swipe-from-edge gesture so the back affordance is
 * visible and tappable for users who don't know the gesture. The
 * left-edge swipe still works because parents that need it can wire it
 * up at the navigation-stack layer.
 */

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SubScreenProps {
  /** Title rendered centered on the header strip. */
  title: ReactNode;
  /** Called when the back affordance is tapped. */
  onBack: () => void;
  children: ReactNode;
  /** Optional right-side header slot for an action button. */
  trailingAction?: ReactNode;
  /** Optional accessibility label override for the back button. */
  backLabel?: string;
  className?: string;
}

export function SubScreen({
  title,
  onBack,
  children,
  trailingAction,
  backLabel = "Back",
  className,
}: SubScreenProps) {
  return (
    <div
      data-testid="mobile-profile-sub-screen"
      className={cn(
        "relative flex h-full flex-col bg-background text-foreground",
        className
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-10 flex h-11 items-center gap-1 px-2",
          "bg-background",
          "border-b border-border"
        )}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          data-testid="mobile-profile-back"
          className={cn(
            "inline-flex h-9 min-w-[44px] items-center gap-0.5 rounded-md px-1.5",
            "text-[15px] text-foreground",
            "active:bg-accent/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
          <span className="text-[15px]">{backLabel}</span>
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 truncate text-[15px] font-medium leading-tight text-foreground">
          {title}
        </h1>
        <div className="ml-auto flex h-9 items-center">{trailingAction}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
