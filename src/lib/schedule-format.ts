/**
 * Calculate the next interval occurrence using an absolute-duration cadence.
 * The result is always strictly after `now`; missed occurrences are skipped.
 */
export function calculateNextIntervalRun(
  anchorAt: Date,
  intervalSeconds: number,
  now: Date = new Date()
): Date {
  const intervalMs = intervalSeconds * 1000;
  if (now.getTime() < anchorAt.getTime()) {
    return new Date(anchorAt);
  }

  const elapsedMs = now.getTime() - anchorAt.getTime();
  const elapsedIntervals = Math.ceil(elapsedMs / intervalMs);
  const candidate = anchorAt.getTime() + elapsedIntervals * intervalMs;
  return new Date(candidate <= now.getTime() ? candidate + intervalMs : candidate);
}

export function describeIntervalSchedule(
  intervalSeconds: number,
  anchorAt: Date,
  timezone: string
): string {
  const units: Array<[number, string]> = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  const [unitSeconds, unit] =
    units.find(([seconds]) => intervalSeconds % seconds === 0) ?? units[3];
  const count = Math.round(intervalSeconds / unitSeconds);
  const anchor = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(anchorAt);

  return `Every ${count} ${unit}${count === 1 ? "" : "s"} from ${anchor}`;
}

/** Cadence summary for schedule lists; null unless a fully-populated interval schedule. */
export function describeScheduleInterval(schedule: {
  scheduleType: string;
  intervalSeconds: number | null;
  anchorAt: Date | string | null;
  timezone: string;
}): string | null {
  if (
    schedule.scheduleType !== "interval" ||
    !schedule.intervalSeconds ||
    !schedule.anchorAt
  ) {
    return null;
  }
  return describeIntervalSchedule(
    schedule.intervalSeconds,
    new Date(schedule.anchorAt),
    schedule.timezone
  );
}
