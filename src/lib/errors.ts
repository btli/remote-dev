/**
 * Consolidated service error classes
 *
 * Base error class with code and optional details for all services.
 * Each service extends this with its own class for instanceof checks.
 *
 * All service errors should be defined here for consistency and easier maintenance.
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

export class GitHubGraphQLError extends ServiceError {
  constructor(
    message: string,
    code: string = "GRAPHQL_ERROR",
    public readonly statusCode?: number
  ) {
    super(message, code, statusCode?.toString());
  }
}

export class GitHubStatsServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class TmuxServiceError extends ServiceError {}

export class WorktreeServiceError extends ServiceError {}

export class WorktreeTrashServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly trashItemId?: string
  ) {
    super(message, code, trashItemId);
  }
}

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

export class SplitServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly splitGroupId?: string
  ) {
    super(message, code, splitGroupId);
  }
}

export class TrashServiceError extends ServiceError {
  constructor(
    message: string,
    code: string,
    public readonly resourceId?: string
  ) {
    super(message, code, resourceId);
  }
}

export class CacheServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class AppearanceServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class AgentProfileServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class AgentConfigServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class TemplateServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class MCPDiscoveryError extends ServiceError {
  constructor(message: string, code: string = "MCP_DISCOVERY_ERROR") {
    super(message, code);
  }
}

export class MCPRegistryServiceError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class ActivityDashboardError extends ServiceError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}
