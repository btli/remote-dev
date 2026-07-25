"use client";

/**
 * Interval-form state helpers and fields shared by CreateScheduleModal and
 * EditScheduleModal, plus the template-snapshot builder both use to feed
 * SaveScheduleTemplateDialog.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { MAX_INTERVAL_SECONDS } from "@/lib/schedule-validation";
import type { ScheduleCommandInput, ScheduleType } from "@/types/schedule";
import type { CreateScheduleTemplateInput } from "@/types/schedule-template";

export type IntervalUnit = "minutes" | "hours" | "days";

export const INTERVAL_UNIT_SECONDS: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

// 30 days expressed in each unit — mirrors MAX_INTERVAL_SECONDS
const INTERVAL_UNIT_MAX: Record<IntervalUnit, number> = {
  minutes: 43_200,
  hours: 720,
  days: 30,
};

export function splitInterval(seconds: number): { value: number; unit: IntervalUnit } {
  if (seconds % 86_400 === 0) return { value: seconds / 86_400, unit: "days" };
  if (seconds % 3_600 === 0) return { value: seconds / 3_600, unit: "hours" };
  return { value: Math.max(1, seconds / 60), unit: "minutes" };
}

export function intervalFormError(
  intervalValue: number,
  intervalUnit: IntervalUnit,
  anchorDateTime: Date | undefined
): string | null {
  const intervalSeconds = intervalValue * INTERVAL_UNIT_SECONDS[intervalUnit];
  if (
    !Number.isFinite(intervalValue) ||
    !Number.isInteger(intervalSeconds) ||
    intervalValue < 1 ||
    intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    return "Interval must be between 1 minute and 30 days";
  }
  if (!anchorDateTime || isNaN(anchorDateTime.getTime())) {
    return "Starting time is required for interval schedules";
  }
  return null;
}

export type ScheduleTemplateSnapshot = Omit<
  CreateScheduleTemplateInput,
  "name" | "description"
>;

export function buildTemplateSnapshot(form: {
  scheduleType: ScheduleType;
  cronExpression: string;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  timezone: string;
  maxRetries: number;
  retryDelaySeconds: number;
  timeoutSeconds: number;
  commands: ScheduleCommandInput[];
}): ScheduleTemplateSnapshot {
  return {
    scheduleType: form.scheduleType,
    cronExpression:
      form.scheduleType === "recurring" ? form.cronExpression.trim() : null,
    intervalSeconds:
      form.scheduleType === "interval"
        ? form.intervalValue * INTERVAL_UNIT_SECONDS[form.intervalUnit]
        : null,
    timezone: form.timezone,
    maxRetries: form.maxRetries,
    retryDelaySeconds: form.retryDelaySeconds,
    timeoutSeconds: form.timeoutSeconds,
    commands: form.commands
      .filter((command) => command.command.trim())
      .map((command, order) => ({
        command: command.command.trim(),
        order,
        delayBeforeSeconds: command.delayBeforeSeconds ?? 0,
        continueOnError: command.continueOnError ?? false,
      })),
  };
}

interface IntervalScheduleFieldsProps {
  intervalValue: number;
  intervalUnit: IntervalUnit;
  anchorDateTime: Date | undefined;
  onIntervalValueChange: (value: number) => void;
  onIntervalUnitChange: (unit: IntervalUnit) => void;
  onAnchorDateTimeChange: (date: Date | undefined) => void;
  /** Optional next-run preview line rendered under the anchor picker. */
  preview?: string;
}

export function IntervalScheduleFields({
  intervalValue,
  intervalUnit,
  anchorDateTime,
  onIntervalValueChange,
  onIntervalUnitChange,
  onAnchorDateTimeChange,
  preview,
}: IntervalScheduleFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Every N
        </Label>
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <Input
            type="number"
            step={1}
            min={1}
            max={INTERVAL_UNIT_MAX[intervalUnit]}
            value={intervalValue}
            onChange={(event) =>
              onIntervalValueChange(Number(event.target.value))
            }
            className="h-8 text-xs bg-card/50 border-border"
          />
          <Select
            value={intervalUnit}
            onValueChange={(value) =>
              onIntervalUnitChange(value as IntervalUnit)
            }
          >
            <SelectTrigger className="h-8 text-xs bg-card/50 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Starting from *
        </Label>
        <DateTimePicker
          date={anchorDateTime}
          onDateChange={onAnchorDateTimeChange}
          placeholder="Select anchor date and time"
        />
        {preview !== undefined && (
          <p className="text-[10px] text-primary/80">{preview}</p>
        )}
      </div>
    </div>
  );
}
