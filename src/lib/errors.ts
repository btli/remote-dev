/**
 * Consolidated service error classes
 *
 * Base error class with code and optional details for all services.
 * Each service extends this with its own class for instanceof checks.
 */

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SessionServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly sessionId?: string
  ) {
    super(message, code, sessionId);
  }
}

export class GitHubServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number
  ) {
    super(message, code, statusCode?.toString());
  }
}

export class TmuxServiceError extends ServiceError {}

export class WorktreeServiceError extends ServiceError {}

export class PreferencesServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class ApiKeyServiceError extends ServiceError {}

export class ScheduleServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly scheduleId?: string
  ) {
    super(message, code, scheduleId);
  }
}

export class SecretsServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly provider?: string
  ) {
    super(message, code, provider);
  }
}
