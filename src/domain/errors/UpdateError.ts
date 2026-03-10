/**
 * Update-specific domain errors.
 */

import { DomainError } from "./DomainError";

export class UpdateError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class NetworkError extends UpdateError {
  constructor(
    public readonly url: string,
    public readonly statusCode?: number
  ) {
    super(
      `Network error fetching ${url}${statusCode ? ` (HTTP ${statusCode})` : ""}`,
      "UPDATE_NETWORK_ERROR"
    );
  }
}

export class ChecksumMismatchError extends UpdateError {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `Checksum mismatch: expected ${expected.slice(0, 16)}..., got ${actual.slice(0, 16)}...`,
      "UPDATE_CHECKSUM_MISMATCH"
    );
  }
}

export class ExtractionError extends UpdateError {
  constructor(public readonly detail: string) {
    super(
      `Failed to extract update: ${detail}`,
      "UPDATE_EXTRACTION_ERROR"
    );
  }
}

export class RestartError extends UpdateError {
  constructor(public readonly detail: string) {
    super(
      `Failed to restart service: ${detail}`,
      "UPDATE_RESTART_ERROR"
    );
  }
}

export class UpdateInProgressError extends UpdateError {
  constructor() {
    super(
      "An update operation is already in progress",
      "UPDATE_IN_PROGRESS"
    );
  }
}

export class NoUpdateAvailableError extends UpdateError {
  constructor() {
    super(
      "No update is available to apply",
      "NO_UPDATE_AVAILABLE"
    );
  }
}
