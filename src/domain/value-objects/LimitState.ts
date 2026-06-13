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
import type { UsageDetectionSource } from "@/types/claude-limits";
import { UsageWindow } from "./UsageWindow";

export interface LimitStateProps {
  profileId: string;
  isLimited: boolean;
  windows: UsageWindow[];
  /** How this state was observed; null if never observed. */
  source: UsageDetectionSource | null;
  /** When the profile first became limited (only set while limited). */
  limitedSince: Date | null;
  /** When the state was last checked; null if never. */
  lastCheckedAt: Date | null;
}

export class LimitState {
  private readonly profileId: string;
  private readonly limited: boolean;
  private readonly windows: readonly UsageWindow[];
  private readonly source: UsageDetectionSource | null;
  private readonly limitedSince: Date | null;
  private readonly lastCheckedAt: Date | null;

  private constructor(props: LimitStateProps) {
    this.profileId = props.profileId;
    this.limited = props.isLimited;
    // Freeze a copy so external mutation of the input array can't leak in.
    this.windows = Object.freeze([...props.windows]);
    this.source = props.source;
    // Defensive copies so later mutation of the caller's Dates cannot leak in.
    this.limitedSince = props.limitedSince ? new Date(props.limitedSince.getTime()) : null;
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
      limitedSince: null,
      lastCheckedAt: opts?.lastCheckedAt ?? null,
    });
  }

  /** A limited state. `limitedSince` defaults to `lastCheckedAt` when omitted. */
  static limited(
    profileId: string,
    opts?: {
      windows?: UsageWindow[];
      source?: UsageDetectionSource | null;
      limitedSince?: Date | null;
      lastCheckedAt?: Date | null;
    }
  ): LimitState {
    const lastCheckedAt = opts?.lastCheckedAt ?? null;
    return LimitState.create({
      profileId,
      isLimited: true,
      windows: opts?.windows ?? [],
      source: opts?.source ?? null,
      limitedSince: opts?.limitedSince ?? lastCheckedAt,
      lastCheckedAt,
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

  getLimitedSince(): Date | null {
    return this.limitedSince ? new Date(this.limitedSince.getTime()) : null;
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

  equals(other: LimitState): boolean {
    if (
      this.profileId !== other.profileId ||
      this.limited !== other.limited ||
      this.source !== other.source ||
      timeOrNull(this.limitedSince) !== timeOrNull(other.limitedSince) ||
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
