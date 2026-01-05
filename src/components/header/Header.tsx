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
import { GitHubMaintenanceModal } from "@/components/github/GitHubMaintenanceModal";
import { GitHubProvider, useGitHubContext } from "@/contexts/GitHubContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import Image from "next/image";

interface HeaderProps {
  isGitHubConnected: boolean;
  userEmail: string;
  onSignOut: () => void;
}

function HeaderContent({ isGitHubConnected, userEmail, onSignOut }: HeaderProps) {
  const { isModalOpen, openModal, closeModal } = useGitHubContext();

  return (
    <>
      <header className="hidden md:flex items-center justify-between px-4 py-2 border-b border-border bg-card/30 backdrop-blur-sm">
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
        <div className="flex items-center gap-4">
          {/* Connection status icons */}
          <div className="flex items-center gap-3 pr-2 border-r border-border">
            <GitHubStatusIcon
              isConnected={isGitHubConnected}
              onClick={openModal}
            />
            <SecretsStatusButton />
            <AppearanceModeToggleCompact />
          </div>

          {/* User settings */}
          <HeaderUserMenu email={userEmail} />

          {/* Sign out */}
          <form action={onSignOut}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <GitHubMaintenanceModal open={isModalOpen} onClose={closeModal} />
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
