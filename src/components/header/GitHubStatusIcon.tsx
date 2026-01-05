"use client";

/**
 * GitHubStatusIcon - Icon-only GitHub connection indicator
 *
 * Shows green when connected, gray when disconnected.
 * Clicking always opens the GitHub maintenance modal.
 */

import { Github } from "lucide-react";
import { cn } from "@/lib/utils";

interface GitHubStatusIconProps {
  isConnected: boolean;
  onClick?: () => void;
}

export function GitHubStatusIcon({ isConnected, onClick }: GitHubStatusIconProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center transition-colors cursor-pointer",
        "hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      )}
      title="GitHub Maintenance"
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
