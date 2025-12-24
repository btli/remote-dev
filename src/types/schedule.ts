/**
 * Schedule Types - TypeScript definitions for scheduled command execution
 */

// =============================================================================
// Status Types
// =============================================================================

/**
 * Schedule lifecycle status
 */
export type ScheduleStatus = "active" | "paused" | "failed" | "completed";

/**
 * Execution status for schedules and commands
 */
export type ExecutionStatus = "success" | "failed" | "timeout";

// =============================================================================
// Core Entity Types
// =============================================================================

/**
 * Schedule configuration
 */
export interface SessionSchedule {
  id: string;
  userId: string;
  sessionId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  status: ScheduleStatus;
  maxRetries: number;
  retryDelaySeconds: number;
  timeoutSeconds: number;
  lastRunAt: Date | null;
  lastRunStatus: ExecutionStatus | null;
  nextRunAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schedule with session info for display
 */
export interface SessionScheduleWithSession extends SessionSchedule {
  session: {
    id: string;
    name: string;
    status: string;
    tmuxSessionName: string;
  };
}

/**
 * Individual command within a schedule
 */
export interface ScheduleCommand {
  id: string;
  scheduleId: string;
  command: string;
  order: number;
  delayBeforeSeconds: number;
  continueOnError: boolean;
  createdAt: Date;
}

/**
 * Schedule with commands
 */
export interface SessionScheduleWithCommands extends SessionSchedule {
  commands: ScheduleCommand[];
}

/**
 * Schedule execution record
 */
export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  commandCount: number;
  successCount: number;
  failureCount: number;
  errorMessage: string | null;
  output: string | null;
}

/**
 * Command execution record
 */
export interface CommandExecution {
  id: string;
  executionId: string;
  commandId: string;
  command: string;
  status: ExecutionStatus;
  exitCode: number | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  output: string | null;
  errorMessage: string | null;
}

/**
 * Execution with command details
 */
export interface ScheduleExecutionWithCommands extends ScheduleExecution {
  commandExecutions: CommandExecution[];
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Command input for schedule creation
 */
export interface ScheduleCommandInput {
  command: string;
  delayBeforeSeconds?: number;
  continueOnError?: boolean;
}

/**
 * Input for creating a new schedule
 */
export interface CreateScheduleInput {
  sessionId: string;
  name: string;
  cronExpression: string;
  timezone?: string;
  commands: ScheduleCommandInput[];
  enabled?: boolean;
  maxRetries?: number;
  retryDelaySeconds?: number;
  timeoutSeconds?: number;
}

/**
 * Input for updating an existing schedule
 */
export interface UpdateScheduleInput {
  name?: string;
  cronExpression?: string;
  timezone?: string;
  enabled?: boolean;
  status?: ScheduleStatus;
  maxRetries?: number;
  retryDelaySeconds?: number;
  timeoutSeconds?: number;
}

/**
 * Input for updating schedule commands
 */
export interface UpdateScheduleCommandsInput {
  commands: ScheduleCommandInput[];
}

// =============================================================================
// Context State Types
// =============================================================================

/**
 * Schedule context state
 */
export interface ScheduleState {
  schedules: SessionScheduleWithSession[];
  loading: boolean;
  error: string | null;
}

/**
 * Schedule context actions
 */
export type ScheduleAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; schedules: SessionScheduleWithSession[] }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "CREATE"; schedule: SessionScheduleWithSession }
  | { type: "UPDATE"; scheduleId: string; updates: Partial<SessionSchedule> }
  | { type: "DELETE"; scheduleId: string }
  | { type: "TOGGLE_ENABLED"; scheduleId: string; enabled: boolean };

// =============================================================================
// UI Types
// =============================================================================

/**
 * Common cron presets for UI
 */
export interface CronPreset {
  label: string;
  value: string;
  description: string;
}

/**
 * Cron presets for the UI
 */
export const CRON_PRESETS: CronPreset[] = [
  { label: "Every minute", value: "* * * * *", description: "Run every minute" },
  { label: "Every 5 minutes", value: "*/5 * * * *", description: "Run every 5 minutes" },
  { label: "Every 15 minutes", value: "*/15 * * * *", description: "Run every 15 minutes" },
  { label: "Every hour", value: "0 * * * *", description: "Run at the start of every hour" },
  { label: "Daily at midnight", value: "0 0 * * *", description: "Run at 12:00 AM every day" },
  { label: "Daily at 9 AM", value: "0 9 * * *", description: "Run at 9:00 AM every day" },
  { label: "Weekdays at 9 AM", value: "0 9 * * 1-5", description: "Run at 9:00 AM Monday through Friday" },
  { label: "Weekly on Monday", value: "0 9 * * 1", description: "Run at 9:00 AM every Monday" },
  { label: "Monthly on the 1st", value: "0 0 1 * *", description: "Run at midnight on the 1st of each month" },
];

/**
 * Common timezone options
 */
export interface TimezoneOption {
  value: string;
  label: string;
  offset: string;
}

/**
 * Common timezones for the UI
 */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/Los_Angeles", label: "Pacific Time", offset: "UTC-8/-7" },
  { value: "America/Denver", label: "Mountain Time", offset: "UTC-7/-6" },
  { value: "America/Chicago", label: "Central Time", offset: "UTC-6/-5" },
  { value: "America/New_York", label: "Eastern Time", offset: "UTC-5/-4" },
  { value: "Europe/London", label: "London", offset: "UTC+0/+1" },
  { value: "Europe/Paris", label: "Paris", offset: "UTC+1/+2" },
  { value: "Europe/Berlin", label: "Berlin", offset: "UTC+1/+2" },
  { value: "Asia/Tokyo", label: "Tokyo", offset: "UTC+9" },
  { value: "Asia/Shanghai", label: "Shanghai", offset: "UTC+8" },
  { value: "Asia/Singapore", label: "Singapore", offset: "UTC+8" },
  { value: "Australia/Sydney", label: "Sydney", offset: "UTC+10/+11" },
  { value: "UTC", label: "UTC", offset: "UTC+0" },
];
