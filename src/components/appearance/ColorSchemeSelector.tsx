"use client";

import { Check } from "lucide-react";
import { useAppearance } from "@/contexts/AppearanceContext";
import type { ColorSchemeId, ResolvedMode } from "@/types/appearance";
import { cn } from "@/lib/utils";

interface ColorSchemeSelectorProps {
  /** Which mode to configure */
  mode: ResolvedMode;
  /** Additional class name */
  className?: string;
}

export function ColorSchemeSelector({ mode, className }: ColorSchemeSelectorProps) {
  const { settings, schemes, setLightScheme, setDarkScheme, loading } = useAppearance();

  const currentScheme =
    mode === "light"
      ? settings?.lightColorScheme ?? "ocean"
      : settings?.darkColorScheme ?? "midnight";

  const handleSelect = (schemeId: ColorSchemeId) => {
    if (mode === "light") {
      setLightScheme(schemeId);
    } else {
      setDarkScheme(schemeId);
    }
  };

  // Group schemes by category
  const coolSchemes = schemes.filter((s) => s.category === "cool");
  const neutralSchemes = schemes.filter((s) => s.category === "neutral");
  const warmSchemes = schemes.filter((s) => s.category === "warm");

  return (
    <div className={cn("space-y-4", className)}>
      {/* Cool schemes */}
      {coolSchemes.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Cool
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {coolSchemes.map((scheme) => (
              <SchemeCard
                key={scheme.id}
                scheme={scheme}
                mode={mode}
                isSelected={currentScheme === scheme.id}
                disabled={loading}
                onSelect={() => handleSelect(scheme.id as ColorSchemeId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Neutral schemes */}
      {neutralSchemes.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Neutral
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {neutralSchemes.map((scheme) => (
              <SchemeCard
                key={scheme.id}
                scheme={scheme}
                mode={mode}
                isSelected={currentScheme === scheme.id}
                disabled={loading}
                onSelect={() => handleSelect(scheme.id as ColorSchemeId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Warm schemes */}
      {warmSchemes.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Warm
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {warmSchemes.map((scheme) => (
              <SchemeCard
                key={scheme.id}
                scheme={scheme}
                mode={mode}
                isSelected={currentScheme === scheme.id}
                disabled={loading}
                onSelect={() => handleSelect(scheme.id as ColorSchemeId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SchemeCardProps {
  scheme: {
    id: string;
    name: string;
    description: string;
    preview: {
      light: { background: string; foreground: string; accent: string };
      dark: { background: string; foreground: string; accent: string };
    };
  };
  mode: ResolvedMode;
  isSelected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function SchemeCard({ scheme, mode, isSelected, disabled, onSelect }: SchemeCardProps) {
  const preview = mode === "light" ? scheme.preview.light : scheme.preview.dark;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col rounded-lg border p-2 text-left transition-all",
        "hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/50",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border bg-card/30 hover:bg-card/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {/* Color preview */}
      <div
        className="mb-2 h-8 w-full rounded-md flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: preview.background }}
      >
        <div
          className="flex items-center gap-1 px-2 py-1 rounded"
          style={{ backgroundColor: preview.accent }}
        >
          <span
            className="text-[10px] font-medium"
            style={{ color: preview.foreground }}
          >
            Aa
          </span>
        </div>
      </div>

      {/* Name and description */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">{scheme.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{scheme.description}</p>
        </div>

        {/* Selected indicator */}
        {isSelected && (
          <div className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5 text-primary-foreground" />
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Combined selector for both light and dark mode schemes
 */
export function ColorSchemeDualSelector({ className }: { className?: string }) {
  const { effectiveMode } = useAppearance();

  return (
    <div className={cn("space-y-6", className)}>
      {/* Light mode schemes */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-amber-200 to-orange-300" />
          <h3 className="text-sm font-medium text-foreground">Light Mode Scheme</h3>
          {effectiveMode === "light" && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">
              Active
            </span>
          )}
        </div>
        <ColorSchemeSelector mode="light" />
      </div>

      {/* Dark mode schemes */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-slate-600 to-slate-800" />
          <h3 className="text-sm font-medium text-foreground">Dark Mode Scheme</h3>
          {effectiveMode === "dark" && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">
              Active
            </span>
          )}
        </div>
        <ColorSchemeSelector mode="dark" />
      </div>
    </div>
  );
}
