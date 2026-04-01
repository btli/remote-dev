"use client";

/**
 * CcflareStatusIndicator - Header status indicator for ccflare proxy
 *
 * Shows a small icon with status dot in the header bar.
 * Green when running, gray when stopped.
 * Click triggers the provided callback (typically opens settings to Proxy tab).
 */

import { Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCcflareContext } from "@/contexts/CcflareContext";

interface CcflareStatusIndicatorProps {
  onClick?: () => void;
}

export function CcflareStatusIndicator({ onClick }: CcflareStatusIndicatorProps) {
  const { status, isRunning, loading } = useCcflareContext();

  // Don't render if ccflare is not installed
  if (!loading && !status.installed) {
    return null;
  }

  const tooltipLabel = isRunning
    ? `Proxy: Running (port ${status.port})`
    : "Proxy: Stopped";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={loading}
          onClick={onClick}
        >
          <div className="relative">
            <Network
              className={cn(
                "h-4 w-4 transition-colors",
                isRunning ? "text-green-400" : "text-muted-foreground"
              )}
            />
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full",
                isRunning ? "bg-green-400" : "bg-muted-foreground/50"
              )}
            />
          </div>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
