"use client";

/**
 * ActionSheet — vertically-stacked action list rendered as a bottom sheet.
 *
 * Phase 2 of the mobile redesign. Used for long-press session actions in the
 * Sessions tab (Suspend / Resume / Rename / Move / Close / Recordings).
 *
 * Each item meets the 44pt minimum touch target. Destructive items render
 * in `text-destructive`. The sheet uses our flat {@link BottomSheet}
 * primitive — no backdrop-blur, no glass.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { BottomSheet } from "./BottomSheet";

export interface ActionSheetItem {
  id: string;
  label: ReactNode;
  /** Optional icon node rendered to the left of the label. */
  icon?: ReactNode;
  /** Tints the item in `text-destructive` when true. */
  destructive?: boolean;
  /** Disables the item; the sheet still closes on press. */
  disabled?: boolean;
  onSelect: () => void | Promise<unknown>;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional title rendered above the items. */
  title?: ReactNode;
  /** Optional subtitle rendered under the title. */
  subtitle?: ReactNode;
  items: ActionSheetItem[];
  /** Optional cancel item label; shows a separated "Cancel" row at the bottom. */
  cancelLabel?: string;
}

export function ActionSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  items,
  cancelLabel = "Cancel",
}: ActionSheetProps) {
  const handleSelect = (item: ActionSheetItem) => {
    if (item.disabled) {
      onOpenChange(false);
      return;
    }
    // Close first so the sheet animates out before the action's UI
    // (e.g. an undo toast) appears. The action then runs.
    onOpenChange(false);
    Promise.resolve(item.onSelect()).catch(() => {
      // Swallow — caller surfaces errors via their own UI.
    });
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel={typeof title === "string" ? title : "Action sheet"}
    >
      {(title || subtitle) ? (
        <div className="px-4 pb-2 pt-1">
          {title ? (
            <p className="text-sm font-medium leading-tight text-foreground">
              {title}
            </p>
          ) : null}
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <ul role="menu" className="px-2 py-1" data-testid="mobile-action-sheet-items">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => handleSelect(item)}
              data-action-id={item.id}
              data-destructive={item.destructive ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3",
                // 44pt minimum touch target.
                "min-h-[44px] py-2.5",
                "text-left text-[15px] leading-tight",
                "transition-colors",
                item.destructive
                  ? "text-destructive hover:bg-destructive/10 active:bg-destructive/15"
                  : "text-foreground hover:bg-accent/40 active:bg-accent/60",
                item.disabled && "opacity-50"
              )}
            >
              {item.icon ? (
                <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center text-current">
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1">{item.label}</span>
            </button>
          </li>
        ))}
        <li aria-hidden="true" className="my-1 border-t border-border" />
        <li>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "flex w-full items-center justify-center rounded-md px-3",
              "min-h-[44px] py-2.5",
              "text-[15px] font-medium leading-tight text-muted-foreground",
              "hover:bg-accent/40 active:bg-accent/60",
              "transition-colors"
            )}
          >
            {cancelLabel}
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
}
