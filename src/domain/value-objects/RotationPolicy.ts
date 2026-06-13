/**
 * RotationPolicy - Pure profile-selection strategy for pool rotation.
 *
 * Given a set of candidate profiles (each with a rotation priority and current
 * limit state), pick the one to use: the available profile with the lowest
 * priority value (lower = higher priority / earlier in rotation). Returns null
 * when every candidate is currently limited.
 *
 * A single strategy ships here; there is intentionally NO user-facing strategy
 * enum (add only on demand). Pure and immutable — no DB / fs / network.
 */

import { InvalidValueError } from "../errors/DomainError";
import { LimitState } from "./LimitState";

export interface RotationCandidate {
  profileId: string;
  /** Lower = higher priority / earlier in rotation. */
  priority: number;
  limitState: LimitState;
}

export class RotationPolicy {
  // No instance state; the policy is a stateless strategy. A private ctor keeps
  // the VO shape consistent with the other value objects.
  private constructor() {}

  /** Create the (stateless) rotation policy. */
  static create(): RotationPolicy {
    return new RotationPolicy();
  }

  /**
   * Select the available candidate with the lowest priority value.
   *
   * Ties on priority are broken by input order (stable). Skips any candidate
   * whose limit state is not available at `now`. Returns the chosen profileId,
   * or null if no candidate is available (all limited).
   *
   * @throws InvalidValueError if a candidate has a non-finite priority.
   */
  static select(candidates: RotationCandidate[], now: Date): string | null {
    let best: RotationCandidate | null = null;
    for (const candidate of candidates) {
      if (typeof candidate.priority !== "number" || !Number.isFinite(candidate.priority)) {
        throw new InvalidValueError(
          "RotationPolicy.candidate.priority",
          candidate.priority,
          "Must be a finite number"
        );
      }
      if (!candidate.limitState.isAvailableNow(now)) continue;
      // Strictly-less keeps the FIRST candidate on a priority tie (stable).
      if (best === null || candidate.priority < best.priority) {
        best = candidate;
      }
    }
    return best ? best.profileId : null;
  }

  /** Instance form of {@link RotationPolicy.select}. */
  select(candidates: RotationCandidate[], now: Date): string | null {
    return RotationPolicy.select(candidates, now);
  }
}
