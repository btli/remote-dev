"use client";

/**
 * GitHubStatusIcon - Icon-only GitHub connection indicator
 *
 * Shows green when connected, gray when disconnected.
 * Clicking opens the GitHub OAuth flow when disconnected.
 */

import { Github } from "lucide-react";
import { cn } from "@/lib/utils";

interface GitHubStatusIconProps {
  isConnected: boolean;
}

export function GitHubStatusIcon({ isConnected }: GitHubStatusIconProps) {
  const handleClick = () => {
    if (!isConnected) {
      window.location.href = "/api/auth/github/link";
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center transition-colors",
        "hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        !isConnected && "cursor-pointer"
      )}
      title={isConnected ? "GitHub Connected" : "Connect GitHub"}
    >
      <Github
        className={cn(
          "w-4 h-4 transition-colors",
          isConnected ? "text-green-400" : "text-muted-foreground hover:text-foreground"
        )}
      />
    </button>
  );
}
