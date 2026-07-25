export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 30 * 24 * 60 * 60;

export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || timezone.length === 0) return false;

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
