"use client";

/**
 * ProfileRow — single tappable row in the Profile index or any sub-screen.
 *
 * Phase 6 of the mobile redesign. A pure presentational primitive: icon
 * on the left, label + optional value on the right, chevron at the end.
 * No side-stripes, no glass; achromatic-default. Hierarchy is by weight.
 *
 * Touch target is at least 56pt tall (well above the 44pt minimum), with
 * a generous press state via `active:bg-accent/40`.
 */

import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ProfileRowProps {
  /**
   * Optional Lucide icon component. Rendered in `text-muted-foreground`
   * so it reads as orientation, not decoration.
   */
  icon?: LucideIcon;
  /** Primary label. */
  label: ReactNode;
  /** Optional muted right-aligned value (e.g. version string, count). */
  value?: ReactNode;
  /** True for sign-out and similar; renders the label in destructive ink. */
  destructive?: boolean;
  /** Disables the row visually and suppresses tap/click events. */
  disabled?: boolean;
  /** Hide the trailing chevron. Useful for terminal "Sign out" style rows. */
  hideChevron?: boolean;
  onPress: () => void;
  className?: string;
  /** Optional `data-row` identifier for tests and analytics. */
  rowId?: string;
}

export function ProfileRow({
  icon: Icon,
  label,
  value,
  destructive = false,
  disabled = false,
  hideChevron = false,
  onPress,
  className,
  rowId,
}: ProfileRowProps) {
  return (
    <button
      type="button"
      data-row={rowId}
      data-destructive={destructive ? "true" : undefined}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-4",
        // 56pt row keeps Profile reading as native iOS-grade settings.
        "min-h-[56px] py-3",
        "text-left",
        "transition-colors",
        "active:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        // Hairline divider rendered by parent; row stays flush.
        disabled && "opacity-50",
        className
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground"
        >
          <Icon
            aria-hidden="true"
            className="h-5 w-5"
            strokeWidth={1.75}
          />
        </span>
      ) : null}
      <span
        className={cn(
          "flex-1 truncate text-[15px] leading-tight",
          destructive ? "text-destructive font-medium" : "font-medium text-foreground"
        )}
      >
        {label}
      </span>
      {value !== undefined && value !== null ? (
        <span className="truncate text-[13px] text-muted-foreground">
          {value}
        </span>
      ) : null}
      {hideChevron ? null : (
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
      )}
    </button>
  );
}
