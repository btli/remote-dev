/**
 * TrackUsageLimitUseCase - Record a usage-limit observation for a profile.
 *
 * Builds a domain `LimitState` from a raw detection input and upserts it via
 * the repository with a staleness guard: a slower/older source must not
 * clobber a strictly-newer observation (the repo compares `lastCheckedAt`).
 * Returns the built state plus `wasNewlyLimited` — true only when this
 * observation flips the profile from not-limited (or never-observed) into
 * limited. Callers use that flag to fire relaunch handling exactly once per
 * limit episode (a repeat "still limited" observation must not re-relaunch).
 *
 * Depends only on ports + value objects — unit-tested with an in-memory fake.
 */

import { LimitState } from "@/domain/value-objects/LimitState";
import { UsageWindow } from "@/domain/value-objects/UsageWindow";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type { UsageDetectionSource } from "@/types/claude-limits";
import { createLogger } from "@/lib/logger";

const log = createLogger("TrackUsageLimit");

export interface TrackUsageLimitInput {
  profileId: string;
  userId: string;
  source: UsageDetectionSource;
  /** Whether the account is currently limited. Defaults to false. */
  isLimited?: boolean;
  resetAt5h?: Date | null;
  resetAt7d?: Date | null;
  window5hPct?: number | null;
  window7dPct?: number | null;
  /** Observation time; defaults to now. Drives the staleness guard. */
  observedAt?: Date;
}

/** The outcome of recording an observation. */
export interface TrackUsageLimitResult {
  /** The state built from this observation (the caller broadcasts it). */
  state: LimitState;
  /**
   * True when this observation transitions the profile INTO limited — i.e. the
   * prior stored state was absent, not-limited, OR limited-but-already-expired
   * (a brand-new limit episode after a previous one's reset passed). Used to
   * gate one-shot relaunch.
   */
  wasNewlyLimited: boolean;
  /**
   * Whether the repository actually persisted this write. False when the
   * staleness guard skipped the upsert because a strictly-newer row already
   * exists. Callers gate broadcast/relaunch on this so a dropped stale write
   * never fires a relaunch or announces a state the DB doesn't hold.
   */
  wrote: boolean;
}

export class TrackUsageLimitUseCase {
  constructor(
    private readonly stateRepository: UsageLimitStateRepository
  ) {}

  async execute(input: TrackUsageLimitInput): Promise<TrackUsageLimitResult> {
    const observedAt = input.observedAt ?? new Date();
    const isLimited = input.isLimited ?? false;

    // Read the prior state up front so we can tell whether this observation is
    // a NEW limit (off→on transition) vs. a repeat of an already-limited state.
    // `isLimited()` is the raw stored flag and is NOT time-aware, and nothing
    // flips an expired `limited` row back to available, so compare against
    // `isAvailableNow(observedAt)` instead: a prior limit whose reset has
    // already passed counts as available, making a fresh limit a NEW episode.
    const prior = await this.stateRepository.findByProfileId(input.profileId);
    const wasNewlyLimited =
      isLimited && (!prior || prior.isAvailableNow(observedAt));

    // Build usage windows only for the dimensions we actually observed. A
    // window with neither a percentage nor a reset carries no information, so
    // skip it (keeps `earliestResetAt` honest).
    const windows: UsageWindow[] = [];
    const w5h = buildWindow("5h", input.window5hPct, input.resetAt5h);
    if (w5h) windows.push(w5h);
    const w7d = buildWindow("7d", input.window7dPct, input.resetAt7d);
    if (w7d) windows.push(w7d);

    const state = isLimited
      ? LimitState.limited(input.profileId, {
          windows,
          source: input.source,
          lastCheckedAt: observedAt,
        })
      : LimitState.available(input.profileId, {
          windows,
          source: input.source,
          lastCheckedAt: observedAt,
        });

    // Staleness guard: a manual override (user action) is authoritative and
    // always wins; automated sources defer to a strictly-newer stored reading.
    const opts =
      input.source === "manual" ? undefined : { onlyIfNewer: observedAt };

    const wrote = await this.stateRepository.upsert(state, opts);

    log.debug("Tracked usage-limit observation", {
      profileId: input.profileId,
      source: input.source,
      isLimited,
      wasNewlyLimited,
      wrote,
      observedAt: observedAt.toISOString(),
    });

    return { state, wasNewlyLimited, wrote };
  }
}

/**
 * Build a UsageWindow when at least one dimension is known. A percentage is
 * required to construct the VO (0-100); when only a reset time is known we
 * record it at 100% (the account is limited, reset pending). Returns null when
 * nothing was observed for the window.
 */
function buildWindow(
  duration: "5h" | "7d",
  pct: number | null | undefined,
  resetAt: Date | null | undefined
): UsageWindow | null {
  const hasPct = typeof pct === "number" && Number.isFinite(pct);
  const hasReset = resetAt instanceof Date;
  if (!hasPct && !hasReset) return null;
  const utilization = hasPct ? clampPct(pct as number) : 100;
  return UsageWindow.create(duration, utilization, hasReset ? resetAt : null);
}

/**
 * Clamp a percentage into 0-100 AND round it to an integer. The DB pct columns
 * are `integer`, so an un-rounded float would diverge across backends
 * (PostgreSQL rounds on write, SQLite keeps the float) — round here so both
 * dialects persist the same value.
 */
function clampPct(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}
