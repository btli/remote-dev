/**
 * ClaudeCredentials - Value object for a profile's file-based Claude OAuth
 * credentials (the `claudeAiOauth` block of `.credentials.json`).
 *
 * Claude Code writes subscription OAuth credentials to `.credentials.json`
 * under `CLAUDE_CONFIG_DIR` (file-based on Linux/Windows; on macOS the file is
 * read as a fallback when it exists). The file's shape is:
 *
 *   {
 *     "claudeAiOauth": {
 *       "accessToken": "sk-ant-oat01-…",
 *       "refreshToken": "sk-ant-ort01-…",
 *       "expiresAt": 1750000000000,   // epoch MILLISECONDS
 *       "scopes": ["user:inference", "user:profile"],
 *       "subscriptionType": "max"      // pro | max | team | enterprise | …
 *     }
 *   }
 *
 * This VO parses that block, exposes expiry detection, and is the ONE place
 * that handles the raw token. It NEVER exposes a token via `toString()`/logging
 * helpers — `redacted()` returns a safe, token-free projection so callers can
 * log/serialize state without leaking secrets.
 *
 * Pure and immutable: no DB / fs / network. Mirrors the other value objects
 * (private ctor, static factory, `equals()`).
 */

import { InvalidValueError } from "../errors/DomainError";

/** Treat a token as "about to expire" within this window (ms). */
const DEFAULT_EXPIRY_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export interface ClaudeCredentialsProps {
  accessToken: string;
  /** Present for subscription OAuth; absent for some token kinds. */
  refreshToken: string | null;
  /** Epoch-ms when the access token expires, or null if not disclosed. */
  expiresAt: Date | null;
  scopes: readonly string[];
  /** e.g. "pro" | "max" | "team" | "enterprise"; null if not disclosed. */
  subscriptionType: string | null;
}

/** Token-free projection safe to log / serialize. */
export interface ClaudeCredentialsRedacted {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: number | null;
  scopes: string[];
  subscriptionType: string | null;
}

export class ClaudeCredentials {
  private readonly accessToken: string;
  private readonly refreshToken: string | null;
  private readonly expiresAt: Date | null;
  private readonly scopes: readonly string[];
  private readonly subscriptionType: string | null;

  private constructor(props: ClaudeCredentialsProps) {
    this.accessToken = props.accessToken;
    this.refreshToken = props.refreshToken;
    // Defensive copy so later mutation of the caller's Date cannot leak in.
    this.expiresAt = props.expiresAt
      ? new Date(props.expiresAt.getTime())
      : null;
    this.scopes = Object.freeze([...props.scopes]);
    this.subscriptionType = props.subscriptionType;
  }

  /**
   * Create from props.
   * @throws InvalidValueError if accessToken is empty.
   */
  static create(props: ClaudeCredentialsProps): ClaudeCredentials {
    if (!props.accessToken || typeof props.accessToken !== "string") {
      throw new InvalidValueError(
        "ClaudeCredentials.accessToken",
        "<redacted>",
        "Must be a non-empty string"
      );
    }
    return new ClaudeCredentials(props);
  }

  /**
   * Parse the JSON contents of a `.credentials.json` file. Accepts the raw
   * string or an already-parsed object. Returns null when the structure is
   * absent/invalid (a placeholder/empty file is a valid "not logged in yet"
   * state, not an error). NEVER throws on malformed input — login flows must
   * tolerate a half-written file.
   */
  static parse(raw: string | unknown): ClaudeCredentials | null {
    let obj: unknown = raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    if (!obj || typeof obj !== "object") return null;

    const oauth = (obj as Record<string, unknown>).claudeAiOauth;
    if (!oauth || typeof oauth !== "object") return null;
    const o = oauth as Record<string, unknown>;

    const accessToken = typeof o.accessToken === "string" ? o.accessToken : "";
    if (!accessToken) return null; // no usable token → treat as not-logged-in

    const refreshToken =
      typeof o.refreshToken === "string" && o.refreshToken
        ? o.refreshToken
        : null;

    // expiresAt is epoch MILLISECONDS in Claude Code's file format.
    const expiresAt =
      typeof o.expiresAt === "number" && Number.isFinite(o.expiresAt)
        ? new Date(o.expiresAt)
        : null;

    const scopes = Array.isArray(o.scopes)
      ? o.scopes.filter((s): s is string => typeof s === "string")
      : [];

    const subscriptionType =
      typeof o.subscriptionType === "string" && o.subscriptionType
        ? o.subscriptionType
        : null;

    return new ClaudeCredentials({
      accessToken,
      refreshToken,
      expiresAt,
      scopes,
      subscriptionType,
    });
  }

  /**
   * The OAuth access token. The ONLY token accessor — callers must keep it out
   * of logs (use {@link redacted} for anything observable).
   */
  getAccessToken(): string {
    return this.accessToken;
  }

  /** The OAuth refresh token, or null when none was issued. */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /** A defensive copy of the expiry timestamp (or null). */
  getExpiresAt(): Date | null {
    return this.expiresAt ? new Date(this.expiresAt.getTime()) : null;
  }

  getScopes(): string[] {
    return [...this.scopes];
  }

  getSubscriptionType(): string | null {
    return this.subscriptionType;
  }

  /** Whether a refresh token is available for a server-side refresh. */
  canRefresh(): boolean {
    return this.refreshToken !== null;
  }

  /**
   * Whether the access token is expired (or within `skewMs` of expiring) at
   * `now`. Unknown expiry → treated as NOT expired (we can't prove staleness;
   * the CLI refreshes on use, so leave it to the live call to detect 401).
   */
  isExpired(now: Date, skewMs: number = DEFAULT_EXPIRY_SKEW_MS): boolean {
    if (!this.expiresAt) return false;
    return this.expiresAt.getTime() - skewMs <= now.getTime();
  }

  /** Milliseconds until expiry at `now`; null if expiry unknown; 0 if past. */
  msUntilExpiry(now: Date): number | null {
    if (!this.expiresAt) return null;
    const delta = this.expiresAt.getTime() - now.getTime();
    return delta > 0 ? delta : 0;
  }

  /** Token-free projection safe to log / return over the wire. */
  redacted(): ClaudeCredentialsRedacted {
    return {
      hasAccessToken: this.accessToken.length > 0,
      hasRefreshToken: this.refreshToken !== null,
      expiresAt: this.expiresAt ? this.expiresAt.getTime() : null,
      scopes: [...this.scopes],
      subscriptionType: this.subscriptionType,
    };
  }

  equals(other: ClaudeCredentials): boolean {
    const thisExp = this.expiresAt ? this.expiresAt.getTime() : null;
    const otherExp = other.expiresAt ? other.expiresAt.getTime() : null;
    return (
      this.accessToken === other.accessToken &&
      this.refreshToken === other.refreshToken &&
      thisExp === otherExp &&
      this.subscriptionType === other.subscriptionType &&
      this.scopes.length === other.scopes.length &&
      this.scopes.every((s, i) => s === other.scopes[i])
    );
  }
}
