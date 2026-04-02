"use client";

import { useState, useEffect, useReducer } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import { Loader2 } from "lucide-react";
import type { BeadsSectionExpandDefaults } from "@/types/preferences";
import { BEADS_SECTION_EXPAND_DEFAULTS } from "@/types/preferences";

/** Fetch .beads/config.yaml for a project path, returning { content, loading }. */
function useBeadsConfig(projectPath: string | null) {
  type State = { content: string | null; loading: boolean };
  type Action = { type: "start" } | { type: "done"; content: string | null };

  const [state, dispatch] = useReducer(
    (_: State, action: Action): State => {
      if (action.type === "start") return { content: null, loading: true };
      return { content: action.content, loading: false };
    },
    { content: null, loading: false }
  );

  useEffect(() => {
    if (!projectPath) return;

    let cancelled = false;
    dispatch({ type: "start" });

    fetch(`/api/beads/config?projectPath=${encodeURIComponent(projectPath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) dispatch({ type: "done", content: data.content ?? null });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "done", content: null });
      });

    return () => { cancelled = true; };
  }, [projectPath]);

  return projectPath ? state : { content: null, loading: false };
}

export function BeadsSection() {
  const { userSettings, updateUserSettings } = usePreferencesContext();

  if (!userSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <BeadsSectionInner userSettings={userSettings} updateUserSettings={updateUserSettings} />;
}

function BeadsSectionInner({ userSettings, updateUserSettings }: {
  userSettings: NonNullable<ReturnType<typeof usePreferencesContext>["userSettings"]>;
  updateUserSettings: ReturnType<typeof usePreferencesContext>["updateUserSettings"];
}) {
  const { currentPreferences } = usePreferencesContext();
  const projectPath = currentPreferences.defaultWorkingDirectory || null;

  // Local state for sliders
  const [sidebarWidth, setSidebarWidth] = useState(userSettings.beadsSidebarWidth ?? 320);
  const [retentionDays, setRetentionDays] = useState(userSettings.beadsClosedRetentionDays ?? 7);

  const debouncedSave = useDebouncedSave(updateUserSettings);

  // Section expand defaults
  const sectionExpanded: BeadsSectionExpandDefaults =
    userSettings.beadsSectionExpanded ?? BEADS_SECTION_EXPAND_DEFAULTS;

  const updateSectionExpanded = (key: keyof BeadsSectionExpandDefaults, value: boolean) => {
    const updated = { ...sectionExpanded, [key]: value };
    updateUserSettings({ beadsSectionExpanded: updated });
  };

  // Config viewer — fetches .beads/config.yaml for the active project
  const configState = useBeadsConfig(projectPath);

  return (
    <div className="space-y-4">
      {/* Sidebar defaults */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div className="space-y-0.5">
          <Label className="text-foreground">Start collapsed</Label>
          <p className="text-xs text-muted-foreground">
            Whether the beads sidebar starts collapsed on page load
          </p>
        </div>
        <Switch
          checked={userSettings.beadsSidebarCollapsed}
          onCheckedChange={(checked) =>
            updateUserSettings({ beadsSidebarCollapsed: checked })
          }
        />
      </div>

      {/* Sidebar width */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-foreground">Default width</Label>
          <span className="text-sm text-muted-foreground">{sidebarWidth}px</span>
        </div>
        <Slider
          value={[sidebarWidth]}
          onValueChange={([value]) => {
            setSidebarWidth(value);
            debouncedSave("beadsSidebarWidth", value);
          }}
          min={240}
          max={500}
          step={10}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Default expanded width of the beads sidebar (240–500px)
        </p>
      </div>

      {/* Closed issues retention */}
      <div className="pt-4 border-t border-border">
        <Label className="text-foreground text-sm font-medium">Issues</Label>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Configure how issues are displayed in the sidebar.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-foreground text-sm">Closed issue retention</Label>
            <span className="text-sm text-muted-foreground">{retentionDays} days</span>
          </div>
          <Slider
            value={[retentionDays]}
            onValueChange={([value]) => {
              setRetentionDays(value);
              debouncedSave("beadsClosedRetentionDays", value);
            }}
            min={1}
            max={90}
            step={1}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            How many days to show closed issues in the sidebar before hiding them
          </p>
        </div>
      </div>

      {/* Section expand defaults */}
      <div className="pt-4 border-t border-border">
        <Label className="text-foreground text-sm font-medium">
          Default section visibility
        </Label>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Which sidebar sections start expanded by default.
        </p>

        <div className="space-y-2">
          {([
            { key: "ready" as const, label: "Ready" },
            { key: "inProgress" as const, label: "In Progress" },
            { key: "open" as const, label: "Open (blocked/deferred)" },
            { key: "closed" as const, label: "Closed" },
          ]).map(({ key, label }) => (
            <div
              key={key}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border border-border"
            >
              <Label className="text-foreground text-sm">{label}</Label>
              <Switch
                checked={sectionExpanded[key]}
                onCheckedChange={(checked) => updateSectionExpanded(key, checked)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* bd CLI Configuration (read-only) */}
      <div className="pt-4 border-t border-border">
        <Label className="text-foreground text-sm font-medium">
          bd CLI Configuration
        </Label>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Read-only view of <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">.beads/config.yaml</code> from the active project.
          Edit with <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">bd config set</code>.
        </p>

        {!projectPath ? (
          <p className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border">
            Select a project folder in Project settings to view configuration.
          </p>
        ) : configState.loading ? (
          <div className="flex items-center gap-2 p-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading configuration...</span>
          </div>
        ) : configState.content ? (
          <pre className="p-3 rounded-lg bg-muted/50 border border-border text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
            {configState.content}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border">
            No config.yaml found. Run <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">bd init</code> to initialize beads.
          </p>
        )}
      </div>
    </div>
  );
}
