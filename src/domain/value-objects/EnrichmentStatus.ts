/**
 * EnrichmentStatus - Value object representing the state of project metadata enrichment.
 *
 * State machine:
 *   pending → enriching → enriched
 *   pending → failed
 *   enriching → enriched
 *   enriching → failed
 *   enriched → stale
 *   stale → enriching → enriched
 *   failed → enriching (retry)
 *
 * The enrichment lifecycle:
 * 1. pending: Initial state when metadata record created
 * 2. enriching: Detection/analysis in progress
 * 3. enriched: Successfully analyzed, metadata populated
 * 4. stale: Data exists but is older than staleness threshold
 * 5. failed: Enrichment attempt failed (retryable)
 */

import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

const VALID_STATUSES = ["pending", "enriching", "enriched", "stale", "failed"] as const;
type StatusValue = (typeof VALID_STATUSES)[number];

// Valid state transitions map
const ALLOWED_TRANSITIONS: Record<StatusValue, StatusValue[]> = {
  pending: ["enriching", "failed"],
  enriching: ["enriched", "failed"],
  enriched: ["stale", "enriching"], // enriching for manual refresh
  stale: ["enriching"],
  failed: ["enriching"], // retry
};

export class EnrichmentStatus {
  private constructor(private readonly value: StatusValue) {}

  /**
   * Create an EnrichmentStatus from a string value.
   * @throws InvalidValueError if the value is not a valid status
   */
  static fromString(value: string): EnrichmentStatus {
    if (!VALID_STATUSES.includes(value as StatusValue)) {
      throw new InvalidValueError(
        "EnrichmentStatus",
        value,
        `Must be one of: ${VALID_STATUSES.join(", ")}`
      );
    }
    return new EnrichmentStatus(value as StatusValue);
  }

  /** Create a pending status (initial state) */
  static pending(): EnrichmentStatus {
    return new EnrichmentStatus("pending");
  }

  /** Create an enriching status (analysis in progress) */
  static enriching(): EnrichmentStatus {
    return new EnrichmentStatus("enriching");
  }

  /** Create an enriched status (successfully analyzed) */
  static enriched(): EnrichmentStatus {
    return new EnrichmentStatus("enriched");
  }

  /** Create a stale status (needs refresh) */
  static stale(): EnrichmentStatus {
    return new EnrichmentStatus("stale");
  }

  /** Create a failed status */
  static failed(): EnrichmentStatus {
    return new EnrichmentStatus("failed");
  }

  /** Get the string value of this status */
  toString(): StatusValue {
    return this.value;
  }

  /** Check if this status is pending */
  isPending(): boolean {
    return this.value === "pending";
  }

  /** Check if this status is enriching */
  isEnriching(): boolean {
    return this.value === "enriching";
  }

  /** Check if this status is enriched */
  isEnriched(): boolean {
    return this.value === "enriched";
  }

  /** Check if this status is stale */
  isStale(): boolean {
    return this.value === "stale";
  }

  /** Check if this status is failed */
  isFailed(): boolean {
    return this.value === "failed";
  }

  /** Check if enrichment can be started */
  canStartEnrichment(): boolean {
    return this.value === "pending" || this.value === "stale" || this.value === "failed";
  }

  /** Check if data is available (enriched or stale) */
  hasData(): boolean {
    return this.value === "enriched" || this.value === "stale";
  }

  /** Check if refresh is needed */
  needsRefresh(): boolean {
    return this.value === "stale" || this.value === "failed" || this.value === "pending";
  }

  /**
   * Check if a transition to the target status is valid.
   */
  canTransitionTo(target: EnrichmentStatus): boolean {
    return ALLOWED_TRANSITIONS[this.value].includes(target.value);
  }

  /**
   * Validate that a transition to the target status is allowed.
   * @throws InvalidStateTransitionError if the transition is not valid
   */
  validateTransitionTo(target: EnrichmentStatus, action: string): void {
    if (!this.canTransitionTo(target)) {
      throw new InvalidStateTransitionError(
        action,
        this.value,
        ALLOWED_TRANSITIONS[this.value]
      );
    }
  }

  /** Value equality */
  equals(other: EnrichmentStatus): boolean {
    return this.value === other.value;
  }
}
