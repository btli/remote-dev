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

// rdv-{uuid} pattern: rdv- followed by 36 character UUID
const TMUX_NAME_PATTERN = /^rdv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

    if (!TMUX_NAME_PATTERN.test(value)) {
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
    return this.value.slice(PREFIX.length);
  }

  /** Value equality */
  equals(other: TmuxSessionName): boolean {
    return this.value === other.value;
  }
}
