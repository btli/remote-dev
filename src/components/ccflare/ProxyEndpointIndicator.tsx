"use client";

/**
 * ProxyEndpointIndicator - Header indicator showing ccflare proxy status.
 *
 * Shows a compact badge when the proxy is running. Click opens Settings → Proxy.
 * Hidden on mobile via `hidden md:flex`.
 */

import { Network } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCcflareContext } from "@/contexts/CcflareContext";
import { cn } from "@/lib/utils";

export function ProxyEndpointIndicator() {
  const { isRunning, status, loading } = useCcflareContext();

  if (!isRunning || loading) return null;

  const handleClick = () => {
    window.open("/ccflare/dashboard", "_blank");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            "hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md",
            "bg-muted/50 border border-border text-xs text-muted-foreground",
            "hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer"
          )}
        >
          <Network className="w-3 h-3 shrink-0 text-green-400" />
          <span>Proxy</span>
          {status.port && <span className="text-muted-foreground/60">:{status.port}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>ccflare proxy active</div>
        {status.port && <div className="text-muted-foreground">Port {status.port}</div>}
      </TooltipContent>
    </Tooltip>
  );
}
