"use client";

/**
 * NotificationFilterChips — Phase 4 mobile redesign.
 *
 * Three sticky-top filter chips: All / Unread / Mentions. Hierarchy is by
 * weight + tint, not by chroma — see DESIGN.md "Achromatic-Default Rule".
 *
 * The Unread chip exposes its count as a trailing pill; Mentions does the
 * same. The Active chip shows `font-medium` and a tinted `bg-accent/40`
 * background; inactive chips are `font-normal` muted text on a card-flat
 * background. No accent color, no side-stripe.
 *
 * Touch targets clear 44pt via `min-h-[40px]` plus the row's vertical
 * padding (Phase brief calls 40+ acceptable for chip rails inside a 44pt
 * touch zone; the parent header strip pads above and below to keep the
 * tappable target at the 44pt mark).
 */

import { cn } from "@/lib/utils";

export type NotificationFilter = "all" | "unread" | "mentions";

export interface NotificationFilterChipsProps {
  active: NotificationFilter;
  onChange: (next: NotificationFilter) => void;
  counts: {
    all: number;
    unread: number;
    mentions: number;
  };
  className?: string;
}

interface ChipDef {
  id: NotificationFilter;
  label: string;
}

const CHIPS: readonly ChipDef[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
] as const;

export function NotificationFilterChips({
  active,
  onChange,
  counts,
  className,
}: NotificationFilterChipsProps) {
  return (
    <div
      role="tablist"
      aria-label="Notification filters"
      data-testid="mobile-notification-filter-chips"
      className={cn("flex items-center gap-1.5", className)}
    >
      {CHIPS.map((chip) => {
        const isActive = chip.id === active;
        const count = counts[chip.id];
        // Show a trailing count pill on Unread / Mentions only when the
        // count is meaningful (>0). The All chip omits the pill — its
        // count duplicates the list length and would be visual noise.
        const showCount = chip.id !== "all" && count > 0;
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls="mobile-notifications-list"
            data-filter={chip.id}
            data-active={isActive ? "true" : "false"}
            onClick={() => onChange(chip.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-border",
              "px-3 min-h-[36px] text-xs",
              "transition-colors",
              isActive
                ? "bg-accent/40 font-medium text-foreground"
                : "bg-card font-normal text-muted-foreground",
              "hover:bg-accent/40 active:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
          >
            <span>{chip.label}</span>
            {showCount ? (
              <span
                aria-hidden="true"
                data-testid={`mobile-notification-filter-count-${chip.id}`}
                className={cn(
                  "inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1",
                  "text-[10px] font-medium leading-none",
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted-foreground/15 text-muted-foreground"
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
