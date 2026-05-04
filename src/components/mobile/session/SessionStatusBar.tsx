"use client";

/**
 * SessionStatusBar, Phase 3 mobile session view.
 *
 * Top status strip rendered above the full-bleed terminal viewport. Layout:
 *
 *   [back] [project · session]               [pip]  [more]
 *
 * The pip + halo communicate connection / agent state. The bar uses solid
 * `bg-card`, hairline bottom border, no glass, per DESIGN.md "Flat-By-
 * Default Rule" and "Achromatic-Default Rule".
 *
 * The notification halo wraps the entire pip cluster (not the bar) to keep
 * the canonical attention-blue ring (`oklch(0.6 0.2 250 / 0.8)`) visually
 * tight to the affected control. `prefers-reduced-motion` callers can
 * suppress the pulse from the parent by passing `haloEnabled={false}`.
 */

import { ChevronLeft, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

export type SessionPipState =
  | "idle"
  | "running"
  | "waiting"
  | "error"
  | "disconnected"
  | "reconnecting";

export interface SessionStatusBarProps {
  projectName?: string | null;
  sessionName: string;
  pipState: SessionPipState;
  /** Render the attention halo around the pip when true. */
  haloEnabled?: boolean;
  /** Optional terminal recording indicator. */
  recording?: boolean;
  onBack?: () => void;
  onOpenMetadata?: () => void;
}

/** Map pip state to an achromatic-default tone. */
function pipClassName(state: SessionPipState): string {
  switch (state) {
    case "running":
      return "bg-[var(--signal-running)]";
    case "waiting":
      return "bg-[var(--signal-attention-solid)]";
    case "error":
      return "bg-destructive";
    case "reconnecting":
      return "bg-muted-foreground/70";
    case "disconnected":
      return "bg-muted-foreground/40";
    case "idle":
    default:
      return "bg-foreground/60";
  }
}

function pipAriaLabel(state: SessionPipState): string {
  switch (state) {
    case "running":
      return "Session running";
    case "waiting":
      return "Session waiting for input";
    case "error":
      return "Session error";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
    case "idle":
    default:
      return "Session idle";
  }
}

export function SessionStatusBar({
  projectName,
  sessionName,
  pipState,
  haloEnabled = true,
  recording = false,
  onBack,
  onOpenMetadata,
}: SessionStatusBarProps) {
  const showHalo = haloEnabled && pipState === "waiting";

  return (
    <header
      data-testid="mobile-session-status-bar"
      data-pip={pipState}
      className={cn(
        "relative flex w-full items-center gap-2",
        "border-b border-border bg-card",
        "px-2 py-1.5",
        // No backdrop-filter; per DESIGN.md "Flat-By-Default Rule".
      )}
    >
      {onBack ? (
        <button
          type="button"
          aria-label="Back to sessions"
          onClick={onBack}
          data-testid="mobile-session-back"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md",
            "h-9 w-9 text-foreground",
            "hover:bg-accent/40 active:bg-accent/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
      ) : null}

      {/* Title cluster: project + session. Project name in muted-foreground;
          session in foreground. Hierarchy by weight, never by color. */}
      <div className="min-w-0 flex-1">
        {projectName ? (
          <p
            data-testid="mobile-session-status-project"
            className="truncate text-[11px] font-normal leading-none text-muted-foreground"
          >
            {projectName}
          </p>
        ) : null}
        <p
          data-testid="mobile-session-status-name"
          className={cn(
            "truncate text-sm font-medium leading-tight text-foreground",
            !projectName && "mt-0"
          )}
        >
          {sessionName}
        </p>
      </div>

      {recording ? (
        <span
          aria-label="Recording"
          data-testid="mobile-session-status-recording"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          REC
        </span>
      ) : null}

      {/* Pip with optional halo */}
      <span
        data-testid="mobile-session-status-pip-wrap"
        className={cn(
          "relative inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full",
          showHalo && "notification-ring"
        )}
        role="status"
        aria-label={pipAriaLabel(pipState)}
      >
        <span
          aria-hidden="true"
          data-testid="mobile-session-status-pip"
          className={cn("h-1.5 w-1.5 rounded-full", pipClassName(pipState))}
        />
      </span>

      {onOpenMetadata ? (
        <button
          type="button"
          aria-label="Session details"
          onClick={onOpenMetadata}
          data-testid="mobile-session-status-more"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md",
            "h-9 w-9 text-foreground",
            "hover:bg-accent/40 active:bg-accent/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
        </button>
      ) : null}
    </header>
  );
}
