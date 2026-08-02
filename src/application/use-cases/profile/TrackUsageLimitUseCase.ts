/**
 * TrackUsageLimitUseCase - Record a usage-limit observation for an ACCOUNT.
 *
 * Builds a domain `LimitState` from a raw detection input and upserts it via
 * the repository with a staleness guard: a slower/older source must not
 * clobber a strictly-newer observation (the repo compares `lastCheckedAt`).
 * Returns the built state plus `wasNewlyLimited` — true only when this
 * observation flips the account from not-limited (or never-observed) into
 * limited. Callers use that flag to fire relaunch handling exactly once per
 * limit episode (a repeat "still limited" observation must not re-relaunch).
 *
 * Depends only on ports + value objects — unit-tested with an in-memory fake.
 */

import { LimitState } from "@/domain/value-objects/LimitState";
import { UsageWindow } from "@/domain/value-objects/UsageWindow";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type {
  UsageLimitWindow,
  UsageLimitWindowRepository,
} from "@/application/ports/UsageLimitWindowRepository";
import type { UsageDetectionSource } from "@/types/claude-limits";
import { createLogger } from "@/lib/logger";

const log = createLogger("TrackUsageLimit");

export interface TrackUsageLimitInput {
  accountId: string;
  userId: string;
  source: UsageDetectionSource;
  /** Whether the account is currently limited. Defaults to false. */
  isLimited?: boolean;
  resetAt5h?: Date | null;
  resetAt7d?: Date | null;
  window5hPct?: number | null;
  window7dPct?: number | null;
  /**
   * Every window the source reported, including per-model (`weekly_scoped`)
   * ones the 5h/7d rollup above cannot represent. When provided, it REPLACES
   * the account's stored windows. [remote-dev-n4x4.2]
   *
   * Omit it (undefined) when the source has no per-window detail — a reactive
   * output parse, say — so its narrower observation never wipes richer windows
   * a poll recorded. An explicit empty array DOES clear them (the endpoint
   * genuinely reported none).
   */
  windows?: UsageLimitWindow[];
  /** Observation time; defaults to now. Drives the staleness guard. */
  observedAt?: Date;
}

/** The outcome of recording an observation. */
export interface TrackUsageLimitResult {
  /** The state built from this observation (the caller broadcasts it). */
  state: LimitState;
  /**
   * True when this observation transitions the account INTO limited — i.e. the
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
    private readonly stateRepository: UsageLimitStateRepository,
    /**
     * Optional: when absent, per-window detail is simply not persisted and the
     * account-level rollup behaves exactly as before. Keeps the existing
     * single-argument construction (and its tests) valid. [remote-dev-n4x4.2]
     */
    private readonly windowRepository?: UsageLimitWindowRepository
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
    const prior = await this.stateRepository.findByAccountId(input.accountId);
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
      ? LimitState.limited(input.accountId, {
          windows,
          source: input.source,
          lastCheckedAt: observedAt,
        })
      : LimitState.available(input.accountId, {
          windows,
          source: input.source,
          lastCheckedAt: observedAt,
        });

    // Staleness guard: a manual override (user action) is authoritative and
    // always wins; automated sources defer to a strictly-newer stored reading.
    const opts =
      input.source === "manual" ? undefined : { onlyIfNewer: observedAt };

    // ── Write order is load-bearing [review G6] ────────────────────────────
    //
    // Per-window detail is written FIRST, and a failure aborts before the
    // rollup is touched. The two live in separate repositories over the same
    // `db`, so there is no single transaction spanning them; ordering is what
    // makes the divergence that matters impossible.
    //
    // The dangerous state is a FRESH rollup saying "available" sitting beside
    // STALE windows still saying a model is critical — selection would then
    // block a model the account has since got headroom for, with nothing to
    // correct it but a later successful poll. Writing windows first means that
    // state cannot arise: if windows fail, the rollup is never written and the
    // account keeps its previous (consistent) pair.
    //
    // The residual is the inverse — fresh windows beside a stale rollup — which
    // is strictly safer: windows only ever add blocking for one NAMED model,
    // and the elapsed-reset + staleness checks in the selection policy bound
    // how long that can matter. It self-heals on the next poll.
    if (input.windows !== undefined && this.windowRepository) {
      try {
        await this.windowRepository.replaceForAccount(
          input.accountId,
          input.windows,
          observedAt
        );
      } catch (error) {
        // Do NOT record the observation at all: a half-applied observation is
        // worse than a missed one, and the sweep runs again in ~10 minutes.
        log.warn("Aborting usage observation: window write failed", {
          accountId: input.accountId,
          error: String(error),
        });
        return { state, wasNewlyLimited: false, wrote: false };
      }
    }

    const wrote = await this.stateRepository.upsert(state, opts);

    log.debug("Tracked usage-limit observation", {
      accountId: input.accountId,
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
