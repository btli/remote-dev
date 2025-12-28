"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppearance } from "@/contexts/AppearanceContext";
import type { AppearanceMode } from "@/types/appearance";
import { cn } from "@/lib/utils";

interface AppearanceModeToggleProps {
  /** Size variant */
  size?: "sm" | "default";
  /** Show labels */
  showLabels?: boolean;
  /** Additional class name */
  className?: string;
}

const MODE_OPTIONS: { mode: AppearanceMode; icon: typeof Sun; label: string }[] = [
  { mode: "light", icon: Sun, label: "Light" },
  { mode: "system", icon: Monitor, label: "System" },
  { mode: "dark", icon: Moon, label: "Dark" },
];

export function AppearanceModeToggle({
  size = "default",
  showLabels = true,
  className,
}: AppearanceModeToggleProps) {
  const { settings, setMode, loading } = useAppearance();
  const currentMode = settings?.appearanceMode ?? "system";

  return (
    <div
      className={cn(
        "inline-flex rounded-lg bg-muted/50 p-1",
        className
      )}
    >
      {MODE_OPTIONS.map(({ mode, icon: Icon, label }) => {
        const isActive = currentMode === mode;
        return (
          <Button
            key={mode}
            variant="ghost"
            size={size === "sm" ? "sm" : "default"}
            disabled={loading}
            onClick={() => setMode(mode)}
            className={cn(
              "relative gap-1.5 transition-all",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-xs",
              isActive
                ? "bg-secondary text-foreground hover:bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Icon className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
            {showLabels && <span>{label}</span>}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Compact mode toggle for header/toolbar use
 * Shows only icon, cycles through modes on click
 */
export function AppearanceModeToggleCompact({ className }: { className?: string }) {
  const { settings, effectiveMode, setMode, loading } = useAppearance();
  const currentMode = settings?.appearanceMode ?? "system";

  const handleClick = () => {
    // Cycle: light -> system -> dark -> light
    const nextMode: AppearanceMode =
      currentMode === "light"
        ? "system"
        : currentMode === "system"
        ? "dark"
        : "light";
    setMode(nextMode);
  };

  // Show icon based on current mode preference
  const Icon =
    currentMode === "system" ? Monitor : currentMode === "dark" ? Moon : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={loading}
      onClick={handleClick}
      className={cn("h-8 w-8", className)}
      title={`Mode: ${currentMode} (${effectiveMode})`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
