"use client";

import { useState, useEffect } from "react";
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  Loader2,
  Save,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProfileAppearanceSettings, AgentProfile } from "@/types/agent";
import type { AppearanceMode, ColorSchemeId } from "@/types/appearance";
import { COLOR_SCHEMES, oklchToHex } from "@/lib/color-schemes";

interface AgentProfileAppearanceSettingsProps {
  profile: AgentProfile;
  onSave?: (settings: ProfileAppearanceSettings) => void;
}

const APPEARANCE_MODES: {
  value: AppearanceMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

const CURSOR_STYLES: { value: "block" | "underline" | "bar"; label: string }[] =
  [
    { value: "block", label: "Block" },
    { value: "underline", label: "Underline" },
    { value: "bar", label: "Bar" },
  ];

export function AgentProfileAppearanceSettings({
  profile,
  onSave,
}: AgentProfileAppearanceSettingsProps) {
  const [settings, setSettings] = useState<Partial<ProfileAppearanceSettings>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalSettings, setOriginalSettings] =
    useState<ProfileAppearanceSettings | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/profiles/${profile.id}/appearance`);
        if (response.ok) {
          const data = await response.json();
          if (data) {
            setSettings(data);
            setOriginalSettings(data);
          } else {
            // No custom settings, use defaults
            setSettings({
              appearanceMode: "system",
              lightColorScheme: "ocean",
              darkColorScheme: "midnight",
              terminalOpacity: 100,
              terminalBlur: 0,
              terminalCursorStyle: "block",
            });
          }
        }
      } catch (error) {
        console.error("Failed to fetch appearance settings:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [profile.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/profiles/${profile.id}/appearance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        const saved = await response.json();
        setOriginalSettings(saved);
        setHasChanges(false);
        onSave?.(saved);
      }
    } catch (error) {
      console.error("Failed to save appearance settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const response = await fetch(`/api/profiles/${profile.id}/appearance`, {
        method: "DELETE",
      });

      if (response.ok) {
        setSettings({
          appearanceMode: "system",
          lightColorScheme: "ocean",
          darkColorScheme: "midnight",
          terminalOpacity: 100,
          terminalBlur: 0,
          terminalCursorStyle: "block",
        });
        setOriginalSettings(null);
        setHasChanges(false);
      }
    } catch (error) {
      console.error("Failed to reset appearance settings:", error);
    }
  };

  const updateSetting = <K extends keyof ProfileAppearanceSettings>(
    key: K,
    value: ProfileAppearanceSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading appearance settings...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Palette className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Profile Appearance
          </span>
          <Badge
            variant="outline"
            className="text-xs font-mono border-primary/30 text-primary/80"
          >
            {profile.name}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {originalSettings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="h-7"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Appearance Mode */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
          Appearance Mode
        </Label>
        <div className="flex rounded-lg bg-muted/30 p-1 gap-1">
          {APPEARANCE_MODES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => updateSetting("appearanceMode", value)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-sm font-medium transition-all",
                settings.appearanceMode === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Color Schemes Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Light Scheme */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Sun className="w-3 h-3" />
            Light Scheme
          </Label>
          <Select
            value={settings.lightColorScheme}
            onValueChange={(value: ColorSchemeId) =>
              updateSetting("lightColorScheme", value)
            }
          >
            <SelectTrigger className="bg-input border-border text-foreground h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {COLOR_SCHEMES.map((scheme) => (
                <SelectItem
                  key={scheme.id}
                  value={scheme.id}
                  className="text-popover-foreground focus:bg-primary/20"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full border border-border"
                      style={{ backgroundColor: oklchToHex(scheme.light.semantic.primary) }}
                    />
                    {scheme.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Dark Scheme */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Moon className="w-3 h-3" />
            Dark Scheme
          </Label>
          <Select
            value={settings.darkColorScheme}
            onValueChange={(value: ColorSchemeId) =>
              updateSetting("darkColorScheme", value)
            }
          >
            <SelectTrigger className="bg-input border-border text-foreground h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {COLOR_SCHEMES.map((scheme) => (
                <SelectItem
                  key={scheme.id}
                  value={scheme.id}
                  className="text-popover-foreground focus:bg-primary/20"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full border border-border"
                      style={{ backgroundColor: oklchToHex(scheme.dark.semantic.primary) }}
                    />
                    {scheme.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Terminal Settings */}
      <div className="space-y-4 pt-2 border-t border-border/30">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Terminal Settings
        </span>

        {/* Opacity */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-foreground">Opacity</Label>
            <span className="text-xs font-mono text-muted-foreground">
              {settings.terminalOpacity ?? 100}%
            </span>
          </div>
          <Slider
            value={[settings.terminalOpacity ?? 100]}
            onValueChange={([value]) => updateSetting("terminalOpacity", value)}
            min={50}
            max={100}
            step={5}
            className="w-full"
          />
        </div>

        {/* Blur */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-foreground">Background Blur</Label>
            <span className="text-xs font-mono text-muted-foreground">
              {settings.terminalBlur ?? 0}px
            </span>
          </div>
          <Slider
            value={[settings.terminalBlur ?? 0]}
            onValueChange={([value]) => updateSetting("terminalBlur", value)}
            min={0}
            max={20}
            step={1}
            className="w-full"
          />
        </div>

        {/* Cursor Style */}
        <div className="space-y-2">
          <Label className="text-sm text-foreground">Cursor Style</Label>
          <div className="flex rounded-lg bg-muted/30 p-1 gap-1">
            {CURSOR_STYLES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => updateSetting("terminalCursorStyle", value)}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all",
                  settings.terminalCursorStyle === value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
