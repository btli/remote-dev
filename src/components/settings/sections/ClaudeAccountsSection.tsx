"use client";

/**
 * Settings → Claude Accounts. [remote-dev-0yix]
 *
 * Hosts the cswap-style usage-limit dashboard plus the global default for what
 * to do when a running Claude session hits a limit (notify / auto / disabled).
 * Per-project overrides + fallback-pool assignment live in the project
 * preferences panel (PoolAssignmentPanel).
 */

import { Bell, Repeat, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { ClaudeAccountsDashboard } from "@/components/claude-limits/ClaudeAccountsDashboard";
import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";

const RELAUNCH_OPTIONS: {
  value: ClaudeAutoRelaunchMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "notify",
    label: "Notify",
    description: "Send a notification with a 1-click relaunch action (default).",
    icon: Bell,
  },
  {
    value: "auto",
    label: "Auto-relaunch",
    description:
      "Spawn a parallel session under an available profile (never force-kills).",
    icon: Repeat,
  },
  {
    value: "disabled",
    label: "Disabled",
    description: "Do nothing when a session hits a limit.",
    icon: Ban,
  },
];

export function ClaudeAccountsSection() {
  const { userSettings, updateUserSettings } = usePreferencesContext();
  const mode: ClaudeAutoRelaunchMode =
    userSettings?.claudeAutoRelaunchMode ?? "notify";

  return (
    <div className="flex flex-col gap-8 py-2">
      <ClaudeAccountsDashboard />

      {/* Global auto-relaunch default */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            When a running session hits a limit
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Global default. Projects can override this in their preferences.
          </p>
        </div>
        <div className="grid gap-2">
          {RELAUNCH_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  void updateUserSettings({ claudeAutoRelaunchMode: option.value })
                }
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/40 hover:border-primary/50"
                )}
              >
                <div
                  className={cn(
                    "p-2 rounded-md shrink-0",
                    active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted/50 text-muted-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {option.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
