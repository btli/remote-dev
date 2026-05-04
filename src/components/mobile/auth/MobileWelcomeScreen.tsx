"use client";

/**
 * MobileWelcomeScreen — shown once after the user lands post-Cloudflare-Access
 * the first time on this device.
 *
 * Phase 6 of the mobile redesign. Quiet, calm, expert. Per the brief:
 *
 *   - "Signed in as <email>" line so the user can confirm the right account.
 *   - Optional "Connect GitHub" CTA that triggers `/api/auth/github/link`.
 *   - "Skip for now" text button that lands the user on Sessions.
 *
 * No marketing illustrations, no gradient hero, no accent walls. Type-driven
 * hierarchy and a single primary action; everything else is a ghost button
 * or muted text. Achromatic-default per DESIGN.md.
 */

import { Github } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MobileWelcomeScreenProps {
  /** Authenticated user's email — typically `session.user.email`. */
  email: string | null | undefined;
  /** True when the user already has a GitHub OAuth account linked. */
  isGitHubConnected: boolean;
  /** Called when the user taps "Connect GitHub". */
  onConnectGitHub: () => void;
  /** Called when the user taps "Skip for now" or "Continue". */
  onSkip: () => void;
  className?: string;
}

export function MobileWelcomeScreen({
  email,
  isGitHubConnected,
  onConnectGitHub,
  onSkip,
  className,
}: MobileWelcomeScreenProps) {
  return (
    <div
      data-testid="mobile-welcome-screen"
      className={cn(
        "flex h-[100dvh] w-full flex-col bg-background text-foreground",
        "px-6 pb-safe-bottom pt-safe-top",
        className
      )}
    >
      {/* Top spacer so the welcome copy lands roughly mid-screen on a phone. */}
      <div aria-hidden="true" className="flex-1" />

      <div className="flex flex-col gap-3">
        <p className="text-[22px] font-semibold leading-tight tracking-tight">
          Welcome to Remote Dev.
        </p>
        <p className="text-[14px] leading-snug text-muted-foreground">
          Your terminal, agents, and projects, on your phone.
        </p>
        {email ? (
          <p
            data-testid="mobile-welcome-signed-in-as"
            className="text-[13px] leading-snug text-muted-foreground"
          >
            Signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        ) : null}
      </div>

      <div className="flex-1" aria-hidden="true" />

      <div className="flex flex-col gap-2">
        {isGitHubConnected ? (
          <p
            data-testid="mobile-welcome-github-connected"
            className="text-center text-[13px] text-muted-foreground"
          >
            GitHub is already connected.
          </p>
        ) : (
          <Button
            type="button"
            data-testid="mobile-welcome-connect-github"
            onClick={onConnectGitHub}
            className="h-11 w-full text-[15px]"
          >
            <Github aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            Connect GitHub
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          data-testid="mobile-welcome-skip"
          onClick={onSkip}
          className="h-11 w-full text-[14px] text-muted-foreground hover:text-foreground"
        >
          {isGitHubConnected ? "Continue" : "Skip for now"}
        </Button>
      </div>

      <div aria-hidden="true" className="h-4" />
    </div>
  );
}
