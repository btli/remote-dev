/**
 * TmuxSessionName - Value object for validated tmux session names.
 *
 * Tmux session names have constraints:
 * - Cannot contain colons (:) or periods (.)
 * - Should be reasonably short
 * - Must be non-empty
 *
 * This project uses the format: rdv-{uuid}
 * where rdv stands for "remote dev" and uuid is a valid UUID v4.
 */

import { InvalidValueError } from "../errors/DomainError";
import { randomUUID } from "crypto";

// Allowed tmux session name patterns:
// - rdv-{uuid} - Original pattern for web UI sessions
// - rdv-session-{uuid} - Sessions created via rdv CLI
// - rdv-task-{uuid} - Task sessions from rdv CLI
// - rdv-folder-{name} - Folder orchestrator sessions (name or uuid)
// - rdv-master-control - Master Control orchestrator
const RDV_SESSION_PATTERNS = [
  /^rdv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^rdv-session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^rdv-task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^rdv-folder-[a-z0-9_-]+$/i, // Folder names can be slugs or UUIDs
];
const SPECIAL_NAMES = ["rdv-master-control"];
const TMUX_NAME_PATTERN = (value: string): boolean =>
  RDV_SESSION_PATTERNS.some((pattern) => pattern.test(value)) ||
  SPECIAL_NAMES.includes(value);
const PREFIX = "rdv-";

export class TmuxSessionName {
  private constructor(private readonly value: string) {}

  /**
   * Create a TmuxSessionName from an existing string value.
   * @throws InvalidValueError if the value doesn't match expected format
   */
  static fromString(value: string): TmuxSessionName {
    if (!value || typeof value !== "string") {
      throw new InvalidValueError(
        "TmuxSessionName",
        value,
        "Must be a non-empty string"
      );
    }

    if (!TMUX_NAME_PATTERN(value)) {
      throw new InvalidValueError(
        "TmuxSessionName",
        value,
        `Must match pattern 'rdv-{uuid}' (e.g., rdv-123e4567-e89b-12d3-a456-426614174000)`
      );
    }

    return new TmuxSessionName(value);
  }

  /**
   * Generate a new unique TmuxSessionName.
   * This is the primary way to create names for new sessions.
   */
  static generate(): TmuxSessionName {
    const uuid = randomUUID();
    return new TmuxSessionName(`${PREFIX}${uuid}`);
  }

  /**
   * Create a TmuxSessionName from a session ID (UUID).
   * Useful when you already have a session ID and need to construct the tmux name.
   */
  static fromSessionId(sessionId: string): TmuxSessionName {
    return TmuxSessionName.fromString(`${PREFIX}${sessionId}`);
  }

  /** Get the string value */
  toString(): string {
    return this.value;
  }

  /** Extract the UUID portion (session ID) */
  getSessionId(): string {
    // Handle different prefixes: rdv-, rdv-session-, rdv-task-, rdv-folder-
    const prefixes = ["rdv-session-", "rdv-task-", "rdv-folder-", "rdv-"];
    for (const prefix of prefixes) {
      if (this.value.startsWith(prefix)) {
        return this.value.slice(prefix.length);
      }
    }
    // Fallback for special names
    return this.value.slice(PREFIX.length);
  }

  /** Value equality */
  equals(other: TmuxSessionName): boolean {
    return this.value === other.value;
  }
}
