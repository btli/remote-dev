"use client";

/**
 * Header - Client component wrapper for the application header
 *
 * Manages GitHub modal state and renders header UI elements.
 */

import { GitHubStatusIcon } from "./GitHubStatusIcon";
import { SecretsStatusButton } from "./SecretsStatusButton";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { AppearanceModeToggleCompact } from "@/components/appearance";
import { GitHubProvider } from "@/contexts/GitHubContext";
import { useMobile } from "@/hooks/useMobile";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LogOut } from "lucide-react";
import Image from "next/image";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProxyEndpointIndicator } from "@/components/litellm/ProxyEndpointIndicator";

interface HeaderProps {
  isGitHubConnected: boolean;
  userEmail: string;
  onSignOut: () => void;
}

function HeaderContent({ isGitHubConnected, userEmail, onSignOut }: HeaderProps) {
  const isMobile = useMobile();

  // The maintenance view is now a per-repo terminal-type tab rather than a
  // global modal. Dispatch a window event so SessionManager can pick a
  // linked-repo project as carrier and open (or reuse) the maintenance tab.
  const openMaintenance = () => {
    window.dispatchEvent(new CustomEvent("open-github-maintenance"));
  };

  if (isMobile) {
    return (
      <>
        <header className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card/30 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Image
              src="/favicon.svg"
              alt="Remote Dev"
              width={24}
              height={24}
              className="rounded-md"
              unoptimized
            />
            <h1 className="text-sm font-semibold text-foreground">Remote Dev</h1>
          </div>

          <div className="flex items-center gap-1">
            <GitHubStatusIcon
              isConnected={isGitHubConnected}
              onClick={openMaintenance}
            />
            <SecretsStatusButton />
            <AppearanceModeToggleCompact />
            <NotificationBell
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("notification-panel-toggle")
                )
              }
            />
            <HeaderUserMenu />
            <form action={onSignOut}>
              <Button
                variant="ghost"
                size="icon"
                type="submit"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </form>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/30 backdrop-blur-sm">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Image
            src="/favicon.svg"
            alt="Remote Dev"
            width={32}
            height={32}
            className="rounded-lg"
            unoptimized
          />
          <h1 className="text-lg font-semibold text-foreground">Remote Dev</h1>
        </div>

        {/* User info and actions */}
        <div className="flex items-center gap-1">
          <ProxyEndpointIndicator />
          <GitHubStatusIcon
            isConnected={isGitHubConnected}
            onClick={openMaintenance}
          />
          <SecretsStatusButton />
          <AppearanceModeToggleCompact />
          <NotificationBell
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("notification-panel-toggle")
              )
            }
          />

          <div className="w-px h-5 bg-border mx-1" />

          <span className="text-sm text-muted-foreground px-1">{userEmail}</span>
          <HeaderUserMenu />

          <Tooltip>
            <TooltipTrigger asChild>
              <form action={onSignOut}>
                <Button
                  variant="ghost"
                  size="icon"
                  type="submit"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </TooltipTrigger>
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </>
  );
}

export function Header({ isGitHubConnected, userEmail, onSignOut }: HeaderProps) {
  return (
    <GitHubProvider initialIsConnected={isGitHubConnected}>
      <HeaderContent
        isGitHubConnected={isGitHubConnected}
        userEmail={userEmail}
        onSignOut={onSignOut}
      />
    </GitHubProvider>
  );
}
