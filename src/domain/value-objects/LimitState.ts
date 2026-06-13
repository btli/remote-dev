/**
 * LimitState - Value object for a Claude profile's authoritative limit status.
 *
 * Aggregates the usage windows observed for a profile plus whether the account
 * is currently limited, where the observation came from, and when it was made.
 * A limited profile becomes available again only once its earliest window reset
 * has passed (`isAvailableNow`).
 *
 * Pure and immutable: no DB / fs / network. Mirrors the ProfileIsolation VO
 * style (private ctor, static factories, `equals()`).
 */

import { InvalidValueError } from "../errors/DomainError";
import type {
  ClaudeLimitStatus,
  UsageDetectionSource,
} from "@/types/claude-limits";
import { UsageWindow } from "./UsageWindow";

export interface LimitStateProps {
  profileId: string;
  isLimited: boolean;
  windows: UsageWindow[];
  /** How this state was observed; null if never observed. */
  source: UsageDetectionSource | null;
  /** When the state was last checked; null if never. */
  lastCheckedAt: Date | null;
}

/**
 * The common derived projection of a LimitState, shared by every consumer that
 * needs to render it (DB columns, API wire shape). Timestamps are Dates; the
 * API consumer converts them to epoch-ms. Deriving this once keeps the
 * `limitStatus` rule and the 5h/7d window lookup in a single place.
 */
export interface LimitStateSnapshot {
  limitStatus: ClaudeLimitStatus;
  /** 0-100, or null if that window has not been observed. */
  window5hPct: number | null;
  window7dPct: number | null;
  resetAt5h: Date | null;
  resetAt7d: Date | null;
  /** min(resetAt5h, resetAt7d): soonest the account is available again. */
  effectiveResetAt: Date | null;
  detectionSource: UsageDetectionSource | null;
  lastCheckedAt: Date | null;
}

export class LimitState {
  private readonly profileId: string;
  private readonly limited: boolean;
  private readonly windows: readonly UsageWindow[];
  private readonly source: UsageDetectionSource | null;
  private readonly lastCheckedAt: Date | null;

  private constructor(props: LimitStateProps) {
    this.profileId = props.profileId;
    this.limited = props.isLimited;
    // Freeze a copy so external mutation of the input array can't leak in.
    this.windows = Object.freeze([...props.windows]);
    this.source = props.source;
    // Defensive copy so later mutation of the caller's Date cannot leak in.
    this.lastCheckedAt = props.lastCheckedAt ? new Date(props.lastCheckedAt.getTime()) : null;
  }

  /**
   * Create a LimitState directly from props.
   * @throws InvalidValueError if profileId is empty.
   */
  static create(props: LimitStateProps): LimitState {
    if (!props.profileId || typeof props.profileId !== "string") {
      throw new InvalidValueError(
        "LimitState.profileId",
        props.profileId,
        "Must be a non-empty string"
      );
    }
    return new LimitState(props);
  }

  /** An available (not limited) state. */
  static available(
    profileId: string,
    opts?: {
      windows?: UsageWindow[];
      source?: UsageDetectionSource | null;
      lastCheckedAt?: Date | null;
    }
  ): LimitState {
    return LimitState.create({
      profileId,
      isLimited: false,
      windows: opts?.windows ?? [],
      source: opts?.source ?? null,
      lastCheckedAt: opts?.lastCheckedAt ?? null,
    });
  }

  /** A limited state. */
  static limited(
    profileId: string,
    opts?: {
      windows?: UsageWindow[];
      source?: UsageDetectionSource | null;
      lastCheckedAt?: Date | null;
    }
  ): LimitState {
    return LimitState.create({
      profileId,
      isLimited: true,
      windows: opts?.windows ?? [],
      source: opts?.source ?? null,
      lastCheckedAt: opts?.lastCheckedAt ?? null,
    });
  }

  getProfileId(): string {
    return this.profileId;
  }

  isLimited(): boolean {
    return this.limited;
  }

  /** A copy of the usage windows (the internal array stays frozen). */
  getWindows(): UsageWindow[] {
    return [...this.windows];
  }

  getSource(): UsageDetectionSource | null {
    return this.source;
  }

  getLastCheckedAt(): Date | null {
    return this.lastCheckedAt ? new Date(this.lastCheckedAt.getTime()) : null;
  }

  /**
   * The soonest reset timestamp across all windows that carry one, or null if
   * no window has a known reset. This is when the account next frees up.
   */
  earliestResetAt(_now?: Date): Date | null {
    let earliest: number | null = null;
    for (const window of this.windows) {
      const reset = window.getResetAt();
      if (!reset) continue;
      const time = reset.getTime();
      if (earliest === null || time < earliest) {
        earliest = time;
      }
    }
    return earliest === null ? null : new Date(earliest);
  }

  /**
   * Whether the profile can be used right now.
   * - Not limited → always available.
   * - Limited with a known earliest reset → available once that reset is at or
   *   before `now` (reset exactly == now counts as available).
   * - Limited with no known reset → not available (stay limited until cleared).
   */
  isAvailableNow(now: Date): boolean {
    if (!this.limited) return true;
    const reset = this.earliestResetAt(now);
    if (!reset) return false;
    return reset.getTime() <= now.getTime();
  }

  /**
   * Derive the common projection used by every renderer (DB write, API wire).
   * Centralizes the `limitStatus` rule (limited → "limited"; not limited with
   * no source observed → "unknown"; else "available") and the 5h/7d window
   * lookup so the two consumers can't drift. Timestamps stay as Dates (the API
   * consumer converts to epoch-ms).
   */
  toSnapshot(): LimitStateSnapshot {
    const windows = this.getWindows();
    const w5h = windows.find((w) => w.getDuration() === "5h");
    const w7d = windows.find((w) => w.getDuration() === "7d");

    const limitStatus: ClaudeLimitStatus = this.limited
      ? "limited"
      : this.source === null
        ? "unknown"
        : "available";

    return {
      limitStatus,
      window5hPct: w5h?.getUtilizationPct() ?? null,
      window7dPct: w7d?.getUtilizationPct() ?? null,
      resetAt5h: w5h?.getResetAt() ?? null,
      resetAt7d: w7d?.getResetAt() ?? null,
      effectiveResetAt: this.earliestResetAt(),
      detectionSource: this.source,
      lastCheckedAt: this.getLastCheckedAt(),
    };
  }

  equals(other: LimitState): boolean {
    if (
      this.profileId !== other.profileId ||
      this.limited !== other.limited ||
      this.source !== other.source ||
      timeOrNull(this.lastCheckedAt) !== timeOrNull(other.lastCheckedAt) ||
      this.windows.length !== other.windows.length
    ) {
      return false;
    }
    return this.windows.every((window, i) => window.equals(other.windows[i]));
  }
}

function timeOrNull(date: Date | null): number | null {
  return date ? date.getTime() : null;
}
