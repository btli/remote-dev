"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface EnumOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface EnumRadioGroupProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: EnumOption<T>[];
  disabled?: boolean;
  className?: string;
  description?: string;
}

/**
 * EnumRadioGroup - A radio group for selecting enum values
 *
 * Used for:
 * - permissions.defaultMode (acceptEdits, askOnEdit, readOnly)
 * - statusLine.type (disabled, command)
 * - execution.approvalPolicy (suggest, auto-edit, full-auto)
 * - execution.sandboxMode (docker, none, seatbelt)
 * - tools.sandbox.mode (strict, permissive)
 * - model.reasoningEffort (low, medium, high)
 */
export function EnumRadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className,
  description,
}: EnumRadioGroupProps<T>) {
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <Label className="text-foreground font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-2" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer w-full text-left",
              value === option.value
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-muted/30 hover:bg-muted/50",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <div
              className={cn(
                "mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                value === option.value
                  ? "border-primary bg-primary"
                  : "border-muted-foreground"
              )}
            >
              {value === option.value && (
                <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
              )}
            </div>
            <div className="space-y-0.5">
              <span
                className={cn(
                  "text-sm font-medium block",
                  value === option.value ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <p className="text-xs text-muted-foreground">{option.description}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
