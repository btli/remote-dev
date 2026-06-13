/**
 * poll-config - Shared gate for the proactive Anthropic usage poller.
 *
 * The proactive poll path (the `UsageEndpointPoller` gateway + the periodic
 * `usage-poll-sweep`) is OFF by default and only runs when
 * `RDV_CLAUDE_USAGE_POLL_ENABLED === "1"`. Both consumers read the flag through
 * this single helper so the gate can't drift between them.
 */

/** Whether the proactive usage poller is enabled (default OFF). */
export function isUsagePollEnabled(): boolean {
  return process.env.RDV_CLAUDE_USAGE_POLL_ENABLED === "1";
}
