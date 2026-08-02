/**
 * poll-config - Shared gate for the proactive Anthropic usage poller.
 *
 * The proactive poll path (the `UsageEndpointPoller` gateway + the periodic
 * `usage-poll-sweep`) is ON by default as of [remote-dev-n4x4.4].
 *
 * ## Why the default flipped
 *
 * It used to be OFF because the old adapter POSTed a real `/v1/messages` probe
 * per poll — a per-account, per-sweep quota burn on the very accounts the
 * feature exists to conserve. [remote-dev-n4x4.1] replaced that with a plain
 * `GET /api/oauth/usage`: no message send, no tokens, no quota consumed. With
 * the cost gone, the objection to polling by default went with it — and the
 * feature only works if it actually runs, since per-model `weekly_scoped`
 * windows are visible ONLY through this endpoint.
 *
 * The flag stays as a kill switch: set `RDV_CLAUDE_USAGE_POLL_ENABLED=0` (or
 * `false`/`off`/`no`) to disable. Both consumers read it through this single
 * helper so the gate can't drift between them.
 */

/** Values that explicitly disable the poller. Everything else leaves it on. */
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * Whether the proactive usage poller is enabled.
 *
 * Default ON — an unset or unrecognized value means enabled. Only an explicit
 * opt-out disables it, so a typo'd value fails toward the working behavior
 * rather than silently switching the feature off.
 */
export function isUsagePollEnabled(): boolean {
  const raw = process.env.RDV_CLAUDE_USAGE_POLL_ENABLED;
  if (raw === undefined) return true;
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
}
