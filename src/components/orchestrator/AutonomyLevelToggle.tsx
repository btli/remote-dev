"use client";

/**
 * AutonomyLevelToggle - Toggle for manual/confirm/full autonomy.
 *
 * Levels:
 * - Manual: Tasks are queued, user must trigger each step
 * - Confirm: Plans are generated automatically, user confirms execution
 * - Full: Complete autonomous execution
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Hand, UserCheck, Zap } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AutonomyLevel = "manual" | "confirm" | "full";

interface AutonomyLevelToggleProps {
  value: AutonomyLevel;
  onChange: (level: AutonomyLevel) => void;
  disabled?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const levels: {
  value: AutonomyLevel;
  icon: React.ElementType;
  label: string;
  description: string;
}[] = [
  {
    value: "manual",
    icon: Hand,
    label: "Manual",
    description: "Tasks are queued. You trigger each step manually.",
  },
  {
    value: "confirm",
    icon: UserCheck,
    label: "Confirm",
    description: "Plans are generated automatically. You confirm before execution.",
  },
  {
    value: "full",
    icon: Zap,
    label: "Full",
    description: "Complete autonomous execution. Tasks run immediately.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AutonomyLevelToggle({
  value,
  onChange,
  disabled = false,
  className,
}: AutonomyLevelToggleProps) {
  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-1 p-1 bg-muted rounded-lg", className)}>
        {levels.map((level) => {
          const Icon = level.icon;
          const isActive = value === level.value;

          return (
            <Tooltip key={level.value}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2 gap-1",
                    isActive && "shadow-sm"
                  )}
                  onClick={() => onChange(level.value)}
                  disabled={disabled}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-xs hidden sm:inline">{level.label}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-medium">{level.label}</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">
                  {level.description}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
