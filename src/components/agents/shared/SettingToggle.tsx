"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * SettingToggle - A labeled toggle switch for boolean settings
 *
 * Used for:
 * - sandbox.enabled
 * - sandbox.autoAllowBashIfSandboxed
 * - previewFeatures
 * - vimMode
 * - security.disableYoloMode
 */
export function SettingToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: SettingToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border",
        className
      )}
    >
      <div className="space-y-0.5 pr-4">
        <Label className="text-foreground font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
