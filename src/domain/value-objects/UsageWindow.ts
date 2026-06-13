/**
 * UsageWindow - Value object for one Claude usage window's utilization + reset.
 *
 * A subscription Claude account reports utilization for a rolling 5h window and
 * a rolling 7d window; an organization/credits dimension may also apply. Each
 * window has a percentage used (0-100) and, when known, a timestamp at which it
 * resets (becomes available again).
 *
 * Pure and immutable: no DB / fs / network. Mirrors the ProfileIsolation VO
 * style (private ctor, static factory, `equals()`).
 */

import { InvalidValueError } from "../errors/DomainError";

/** Which window this is. "org" covers org-wide / credit dimensions (api_key). */
export type WindowDuration = "5h" | "7d" | "org";

const VALID_DURATIONS: readonly WindowDuration[] = ["5h", "7d", "org"] as const;

export interface UsageWindowProps {
  duration: WindowDuration;
  /** Percent of the window consumed, 0-100 inclusive. */
  utilizationPct: number;
  /** When the window resets, or null if unknown. */
  resetAt: Date | null;
}

export class UsageWindow {
  private readonly duration: WindowDuration;
  private readonly utilizationPct: number;
  private readonly resetAt: Date | null;

  private constructor(props: UsageWindowProps) {
    this.duration = props.duration;
    this.utilizationPct = props.utilizationPct;
    // Defensive copy so later mutation of the caller's Date cannot leak in.
    this.resetAt = props.resetAt ? new Date(props.resetAt.getTime()) : null;
  }

  /**
   * Create a UsageWindow.
   * @throws InvalidValueError if duration is unknown or utilizationPct is out
   *   of the 0-100 range / not a finite number.
   */
  static create(
    duration: WindowDuration,
    utilizationPct: number,
    resetAt: Date | null
  ): UsageWindow {
    if (!VALID_DURATIONS.includes(duration)) {
      throw new InvalidValueError(
        "UsageWindow.duration",
        duration,
        `Must be one of: ${VALID_DURATIONS.join(", ")}`
      );
    }
    if (typeof utilizationPct !== "number" || !Number.isFinite(utilizationPct)) {
      throw new InvalidValueError(
        "UsageWindow.utilizationPct",
        utilizationPct,
        "Must be a finite number"
      );
    }
    if (utilizationPct < 0 || utilizationPct > 100) {
      throw new InvalidValueError(
        "UsageWindow.utilizationPct",
        utilizationPct,
        "Must be between 0 and 100 inclusive"
      );
    }
    return new UsageWindow({ duration, utilizationPct, resetAt });
  }

  getDuration(): WindowDuration {
    return this.duration;
  }

  getUtilizationPct(): number {
    return this.utilizationPct;
  }

  /** A defensive copy of the reset timestamp (or null). */
  getResetAt(): Date | null {
    return this.resetAt ? new Date(this.resetAt.getTime()) : null;
  }

  /** True once the window is fully consumed (>= 100%). */
  isExhausted(): boolean {
    return this.utilizationPct >= 100;
  }

  /**
   * Milliseconds from `now` until this window resets.
   * - null resetAt → null (unknown).
   * - reset in the future → positive ms.
   * - reset at or before now → 0 (never negative).
   */
  msUntilReset(now: Date): number | null {
    if (!this.resetAt) return null;
    const delta = this.resetAt.getTime() - now.getTime();
    return delta > 0 ? delta : 0;
  }

  equals(other: UsageWindow): boolean {
    const thisReset = this.resetAt ? this.resetAt.getTime() : null;
    const otherReset = other.resetAt ? other.resetAt.getTime() : null;
    return (
      this.duration === other.duration &&
      this.utilizationPct === other.utilizationPct &&
      thisReset === otherReset
    );
  }
}
