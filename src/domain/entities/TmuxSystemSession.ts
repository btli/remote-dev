/**
 * TmuxSystemSession - Domain entity representing a raw tmux session on the system.
 *
 * This is distinct from the Session entity which represents database-tracked sessions.
 * TmuxSystemSession represents the actual tmux process state, which may or may not
 * be tracked in our database (orphaned sessions are tmux sessions without a DB record).
 *
 * Invariants:
 * - A tmux session must have a valid name
 * - Created timestamp must be valid
 */

import { InvalidValueError } from "../errors/DomainError";

/** Prefix used by app-managed tmux sessions */
export const TMUX_SESSION_PREFIX = "rdv-";

export interface TmuxSystemSessionProps {
  name: string;
  windowCount: number;
  created: Date;
  attached: boolean;
}

export class TmuxSystemSession {
  private constructor(private readonly props: TmuxSystemSessionProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.name || typeof this.props.name !== "string") {
      throw new InvalidValueError(
        "TmuxSystemSession.name",
        this.props.name,
        "Must be a non-empty string"
      );
    }
    if (typeof this.props.windowCount !== "number" || this.props.windowCount < 0) {
      throw new InvalidValueError(
        "TmuxSystemSession.windowCount",
        this.props.windowCount,
        "Must be a non-negative number"
      );
    }
    if (!(this.props.created instanceof Date) || isNaN(this.props.created.getTime())) {
      throw new InvalidValueError(
        "TmuxSystemSession.created",
        this.props.created,
        "Must be a valid Date"
      );
    }
  }

  /**
   * Create a TmuxSystemSession from tmux list-sessions output.
   */
  static create(props: TmuxSystemSessionProps): TmuxSystemSession {
    return new TmuxSystemSession({
      name: props.name,
      windowCount: props.windowCount,
      created: props.created,
      attached: props.attached,
    });
  }

  // Getters
  get name(): string {
    return this.props.name;
  }

  get windowCount(): number {
    return this.props.windowCount;
  }

  get created(): Date {
    return this.props.created;
  }

  get attached(): boolean {
    return this.props.attached;
  }

  // Query methods

  /**
   * Check if this session uses the rdv- prefix (managed by our app).
   */
  isAppManaged(): boolean {
    return this.props.name.startsWith(TMUX_SESSION_PREFIX);
  }

  /**
   * Extract the session ID from rdv- prefixed names.
   * Returns null if not an app-managed session.
   */
  getSessionId(): string | null {
    if (!this.isAppManaged()) {
      return null;
    }
    return this.props.name.slice(TMUX_SESSION_PREFIX.length);
  }

  /**
   * Check equality by name (tmux session names are unique).
   */
  equals(other: TmuxSystemSession): boolean {
    return this.props.name === other.props.name;
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): TmuxSystemSessionProps {
    return { ...this.props };
  }
}
