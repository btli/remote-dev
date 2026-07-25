import type { ScheduleTemplateCommand } from "@/types/schedule-template";

export const MAX_TEMPLATE_RETRIES = 10;
export const MAX_TEMPLATE_RETRY_DELAY_SECONDS = 3_600;
export const MAX_TEMPLATE_TIMEOUT_SECONDS = 86_400;

interface TemplateOptions {
  maxRetries?: unknown;
  retryDelaySeconds?: unknown;
  timeoutSeconds?: unknown;
}

function isIntegerInRange(
  value: unknown,
  maximum: number
): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

export function validateScheduleTemplateOptions(
  input: TemplateOptions
): string | null {
  if (
    input.maxRetries !== undefined &&
    !isIntegerInRange(input.maxRetries, MAX_TEMPLATE_RETRIES)
  ) {
    return `Max retries must be an integer between 0 and ${MAX_TEMPLATE_RETRIES}`;
  }
  if (
    input.retryDelaySeconds !== undefined &&
    !isIntegerInRange(
      input.retryDelaySeconds,
      MAX_TEMPLATE_RETRY_DELAY_SECONDS
    )
  ) {
    return `Retry delay must be an integer between 0 and ${MAX_TEMPLATE_RETRY_DELAY_SECONDS} seconds`;
  }
  if (
    input.timeoutSeconds !== undefined &&
    !isIntegerInRange(
      input.timeoutSeconds,
      MAX_TEMPLATE_TIMEOUT_SECONDS
    )
  ) {
    return `Timeout must be an integer between 0 and ${MAX_TEMPLATE_TIMEOUT_SECONDS} seconds`;
  }
  return null;
}

export function normalizeScheduleTemplateCommands(
  value: unknown
): ScheduleTemplateCommand[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const commands: ScheduleTemplateCommand[] = [];
  for (const [index, entry] of value.entries()) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("command" in entry) ||
      typeof entry.command !== "string" ||
      entry.command.trim().length === 0
    ) {
      return null;
    }

    const order = "order" in entry ? entry.order : undefined;
    if (order !== undefined && (!Number.isInteger(order) || (order as number) < 0)) {
      return null;
    }

    const delay =
      "delayBeforeSeconds" in entry ? entry.delayBeforeSeconds : undefined;
    if (
      delay !== undefined &&
      (!Number.isInteger(delay) ||
        (delay as number) < 0 ||
        (delay as number) > MAX_TEMPLATE_TIMEOUT_SECONDS)
    ) {
      return null;
    }

    const continueOnError =
      "continueOnError" in entry ? entry.continueOnError : undefined;
    if (
      continueOnError !== undefined &&
      typeof continueOnError !== "boolean"
    ) {
      return null;
    }

    commands.push({
      command: entry.command,
      order: index,
      delayBeforeSeconds: (delay as number | undefined) ?? 0,
      continueOnError: continueOnError ?? false,
    });
  }

  return commands;
}
