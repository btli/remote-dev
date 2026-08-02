/**
 * poll-config - Shared gate for the proactive Anthropic usage poller.
 *
 * The proactive poll path (the `UsageEndpointPoller` gateway + the periodic
 * `usage-poll-sweep`) requires an EXPLICIT POSITIVE opt-in. Unset, empty, or
 * anything unrecognized means OFF. [remote-dev-n4x4.4, review G7]
 *
 * ## Why opt-in rather than default-on
 *
 * The original reason for default-off is gone: the old adapter POSTed a real
 * `/v1/messages` probe per poll, burning quota on the very accounts the feature
 * exists to conserve, and [remote-dev-n4x4.1] replaced it with a plain
 * `GET /api/oauth/usage` — no message send, no tokens, no quota consumed.
 *
 * But "free" is not the same as "unconditional". Enabling it makes the server
 * contact Anthropic every ~10 minutes for every account, using stored OAuth
 * tokens. `docs/SETUP.md` ships a bare `RDV_CLAUDE_USAGE_POLL_ENABLED=` line,
 * so a permissive default would have started that outbound traffic on an
 * unchanged config file, with no operator having chosen it. Network activity
 * against a third party with a user's credentials should be opted into, not
 * defaulted into.
 *
 * Both consumers read the flag through this single helper so the gate can't
 * drift between them.
 */

/** The values that turn the poller ON. Everything else — including unset,
 * empty, and typos — leaves it off. */
const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);

/**
 * Whether the proactive usage poller is enabled. Default OFF; requires an
 * explicit positive value.
 */
export function isUsagePollEnabled(): boolean {
  const raw = process.env.RDV_CLAUDE_USAGE_POLL_ENABLED;
  if (typeof raw !== "string") return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}
