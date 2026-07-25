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
