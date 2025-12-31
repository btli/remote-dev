"use client";

import { useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SliderWithInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  description?: string;
}

/**
 * SliderWithInput - A slider with an accompanying number input
 *
 * Used for:
 * - cleanupPeriodDays
 * - model.maxSessionTurns
 * - sessionRetention.maxAge
 * - terminalOpacity
 */
export function SliderWithInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  className,
  description,
}: SliderWithInputProps) {
  const handleSliderChange = useCallback(
    (values: number[]) => {
      onChange(values[0]);
    },
    [onChange]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseFloat(e.target.value);
      if (!isNaN(parsed)) {
        // Clamp to valid range
        const clamped = Math.min(Math.max(parsed, min), max);
        onChange(clamped);
      }
    },
    [onChange, min, max]
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <Label className="text-foreground">{label}</Label>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            value={value}
            onChange={handleInputChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="w-20 h-8 text-sm text-right bg-input border-border"
          />
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
      </div>
      <Slider
        value={[value]}
        onValueChange={handleSliderChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full"
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
