/**
 * UpdatePolicy - Value object encapsulating auto-update configuration.
 *
 * Reads from environment variables with sensible defaults.
 * Immutable after construction.
 */

export interface UpdatePolicyProps {
  enabled: boolean;
  delayMinutes: number;
  drainTimeoutSeconds: number;
  drainPollIntervalSeconds: number;
}

const DEFAULT_DELAY_MINUTES = 5;
const DEFAULT_DRAIN_TIMEOUT_SECONDS = 60;
const DEFAULT_DRAIN_POLL_INTERVAL_SECONDS = 10;

export class UpdatePolicy {
  private constructor(private readonly props: UpdatePolicyProps) {}

  /**
   * Create an UpdatePolicy from environment variables.
   *
   * - AUTO_UPDATE_ENABLED: "true" to enable auto-updates (default: false)
   * - AUTO_UPDATE_DELAY_MINUTES: minutes to wait after detection before applying (default: 5)
   * - AUTO_UPDATE_DRAIN_TIMEOUT_SECONDS: max seconds to wait for sessions to drain (default: 60)
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): UpdatePolicy {
    const enabled = env.AUTO_UPDATE_ENABLED === "true";

    const delayMinutes = parseInt(env.AUTO_UPDATE_DELAY_MINUTES ?? "", 10);
    const drainTimeout = parseInt(env.AUTO_UPDATE_DRAIN_TIMEOUT_SECONDS ?? "", 10);

    return new UpdatePolicy({
      enabled,
      delayMinutes: isNaN(delayMinutes) || delayMinutes < 0 ? DEFAULT_DELAY_MINUTES : delayMinutes,
      drainTimeoutSeconds: isNaN(drainTimeout) || drainTimeout < 0 ? DEFAULT_DRAIN_TIMEOUT_SECONDS : drainTimeout,
      drainPollIntervalSeconds: DEFAULT_DRAIN_POLL_INTERVAL_SECONDS,
    });
  }

  /**
   * Create an UpdatePolicy with explicit values (for testing).
   */
  static create(props: Partial<UpdatePolicyProps> = {}): UpdatePolicy {
    return new UpdatePolicy({
      enabled: props.enabled ?? false,
      delayMinutes: props.delayMinutes ?? DEFAULT_DELAY_MINUTES,
      drainTimeoutSeconds: props.drainTimeoutSeconds ?? DEFAULT_DRAIN_TIMEOUT_SECONDS,
      drainPollIntervalSeconds: props.drainPollIntervalSeconds ?? DEFAULT_DRAIN_POLL_INTERVAL_SECONDS,
    });
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get delayMinutes(): number {
    return this.props.delayMinutes;
  }

  get delayMs(): number {
    return this.props.delayMinutes * 60 * 1000;
  }

  get drainTimeoutSeconds(): number {
    return this.props.drainTimeoutSeconds;
  }

  get drainTimeoutMs(): number {
    return this.props.drainTimeoutSeconds * 1000;
  }

  get drainPollIntervalSeconds(): number {
    return this.props.drainPollIntervalSeconds;
  }

  get drainPollIntervalMs(): number {
    return this.props.drainPollIntervalSeconds * 1000;
  }

  equals(other: UpdatePolicy): boolean {
    return (
      this.props.enabled === other.props.enabled &&
      this.props.delayMinutes === other.props.delayMinutes &&
      this.props.drainTimeoutSeconds === other.props.drainTimeoutSeconds &&
      this.props.drainPollIntervalSeconds === other.props.drainPollIntervalSeconds
    );
  }

  toString(): string {
    return `UpdatePolicy(enabled=${this.props.enabled}, delay=${this.props.delayMinutes}m, drain=${this.props.drainTimeoutSeconds}s)`;
  }
}
