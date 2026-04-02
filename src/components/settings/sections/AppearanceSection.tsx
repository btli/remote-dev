"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AppearanceModeToggle,
  ColorSchemeDualSelector,
} from "@/components/appearance";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import { FONT_OPTIONS, DEFAULT_FONT_FAMILY } from "@/lib/terminal-options";

export function AppearanceSection() {
  const { userSettings, updateUserSettings } = usePreferencesContext();

  if (!userSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <AppearanceSectionInner userSettings={userSettings} updateUserSettings={updateUserSettings} />;
}

function AppearanceSectionInner({ userSettings, updateUserSettings }: {
  userSettings: NonNullable<ReturnType<typeof usePreferencesContext>["userSettings"]>;
  updateUserSettings: ReturnType<typeof usePreferencesContext>["updateUserSettings"];
}) {
  // Local state for font size slider (saved on debounced change)
  const [fontSize, setFontSize] = useState(userSettings.fontSize ?? 14);

  const debouncedSave = useDebouncedSave(updateUserSettings);

  return (
    <div className="space-y-4">
      {/* Appearance Mode (Light/System/Dark) */}
      <div className="space-y-2">
        <Label className="text-foreground">Appearance Mode</Label>
        <AppearanceModeToggle />
        <p className="text-xs text-muted-foreground">
          Choose light, dark, or follow your system preference
        </p>
      </div>

      {/* Color Schemes */}
      <div className="space-y-2">
        <Label className="text-foreground">Color Schemes</Label>
        <p className="text-xs text-muted-foreground mb-3">
          Select different color schemes for light and dark modes
        </p>
        <ColorSchemeDualSelector />
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-foreground">Font Size</Label>
          <span className="text-sm text-muted-foreground">{fontSize}px</span>
        </div>
        <Slider
          value={[fontSize]}
          onValueChange={([value]) => {
            setFontSize(value);
            debouncedSave("fontSize", value);
          }}
          min={10}
          max={24}
          step={1}
          className="w-full"
        />
      </div>

      {/* Font Family */}
      <div className="space-y-2">
        <Label className="text-foreground">Font Family</Label>
        <Select
          value={
            userSettings?.fontFamily ??
            DEFAULT_FONT_FAMILY
          }
          onValueChange={(value) => updateUserSettings({ fontFamily: value })}
        >
          <SelectTrigger className="bg-input border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {FONT_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-popover-foreground focus:bg-primary/20"
                style={{ fontFamily: option.value }}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
