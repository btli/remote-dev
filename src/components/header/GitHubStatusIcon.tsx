"use client";

/**
 * GitHubStatusIcon - Icon-only GitHub connection indicator
 *
 * Shows green when connected, gray when disconnected.
 * Clicking always opens the GitHub maintenance modal.
 */

import { Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GitHubStatusIconProps {
  isConnected: boolean;
  onClick?: () => void;
}

export function GitHubStatusIcon({ isConnected, onClick }: GitHubStatusIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClick}>
          <Github
            className={cn(
              "h-4 w-4 transition-colors",
              isConnected ? "text-green-400" : "text-muted-foreground"
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>GitHub</TooltipContent>
    </Tooltip>
  );
}
