import type { ScheduleType } from "@/types/schedule";

export interface ScheduleTemplateCommand {
  command: string;
  order: number;
  delayBeforeSeconds: number;
  continueOnError: boolean;
}

export interface ScheduleTemplate {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  intervalSeconds: number | null;
  timezone: string;
  maxRetries: number;
  retryDelaySeconds: number;
  timeoutSeconds: number;
  commands: ScheduleTemplateCommand[];
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleTemplateInput {
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  cronExpression?: string | null;
  intervalSeconds?: number | null;
  timezone?: string;
  maxRetries?: number;
  retryDelaySeconds?: number;
  timeoutSeconds?: number;
  commands: ScheduleTemplateCommand[];
}

export interface UpdateScheduleTemplateInput {
  name?: string;
  description?: string | null;
  scheduleType?: ScheduleType;
  cronExpression?: string | null;
  intervalSeconds?: number | null;
  timezone?: string;
  maxRetries?: number;
  retryDelaySeconds?: number;
  timeoutSeconds?: number;
  commands?: ScheduleTemplateCommand[];
}
