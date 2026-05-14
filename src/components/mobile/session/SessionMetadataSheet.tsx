"use client";

/**
 * SessionMetadataSheet, Phase 3 mobile session view.
 *
 * Pull-down (well, slide-up, same primitive, different intent) sheet that
 * exposes session-level affordances that don't belong on the smart-key
 * strip: Recordings, Restart agent, Peer messages, Suspend / Close. Built
 * on the existing {@link BottomSheet} primitive so we inherit motion,
 * focus trap, body-scroll-lock, and reduced-motion handling.
 *
 * The brief allows either flipping BottomSheet or building a TopSheet.
 * Practical user testing on a one-handed phone hold shows that a slide-up
 * action sheet is reachable; a slide-down sheet from the very top of the
 * notch is not. We use BottomSheet to keep the visual + motion grammar
 * consistent with Phase 2 (ActionSheet, ProjectTreeSheet, NewSessionSheet).
 */

import type { ReactNode } from "react";

import { ActionSheet, type ActionSheetItem } from "../common/ActionSheet";

export interface SessionMetadataSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  projectName?: string | null;
  /** True if the session is an agent type and we can offer "Restart". */
  showRestart?: boolean;
  /** True if recordings exist (gates the menu item). */
  hasRecordings?: boolean;
  /** Disabled toggles for menu items not yet wired. */
  onViewRecordings?: () => void | Promise<unknown>;
  onRestartAgent?: () => void | Promise<unknown>;
  onOpenPeerMessages?: () => void | Promise<unknown>;
  /**
   * Open the in-terminal search overlay (xterm.js SearchAddon). Mobile
   * lacks Cmd+F, so this is the only entry point for that feature here.
   */
  onOpenSearch?: () => void | Promise<unknown>;
  onSuspend?: () => void | Promise<unknown>;
  onClose?: () => void | Promise<unknown>;
  /** Optional extra rows appended at the bottom (Phase 4+ slot-in points). */
  extraItems?: ActionSheetItem[];
}

export function SessionMetadataSheet({
  open,
  onOpenChange,
  sessionName,
  projectName,
  showRestart = false,
  hasRecordings = false,
  onViewRecordings,
  onRestartAgent,
  onOpenPeerMessages,
  onOpenSearch,
  onSuspend,
  onClose,
  extraItems,
}: SessionMetadataSheetProps) {
  const items: ActionSheetItem[] = [];

  if (onOpenSearch) {
    items.push({
      id: "search-terminal",
      label: "Search terminal",
      onSelect: () => onOpenSearch(),
    });
  }

  if (showRestart) {
    items.push({
      id: "restart-agent",
      label: "Restart agent",
      disabled: !onRestartAgent,
      onSelect: () => onRestartAgent?.(),
    });
  }

  items.push({
    id: "view-recordings",
    label: hasRecordings ? "View recordings" : "Recordings (none)",
    disabled: !onViewRecordings || !hasRecordings,
    onSelect: () => onViewRecordings?.(),
  });

  items.push({
    id: "peer-messages",
    label: "Peer messages",
    disabled: !onOpenPeerMessages,
    onSelect: () => onOpenPeerMessages?.(),
  });

  if (onSuspend) {
    items.push({
      id: "suspend",
      label: "Suspend session",
      onSelect: () => onSuspend(),
    });
  }

  if (extraItems && extraItems.length > 0) {
    items.push(...extraItems);
  }

  if (onClose) {
    items.push({
      id: "close",
      label: "Close session",
      destructive: true,
      onSelect: () => onClose(),
    });
  }

  const subtitle: ReactNode = projectName ? (
    <span className="truncate">{projectName}</span>
  ) : undefined;

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sessionName}
      subtitle={subtitle}
      items={items}
    />
  );
}
