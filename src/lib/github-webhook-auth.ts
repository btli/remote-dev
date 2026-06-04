/**
 * GitHub event webhook auth + parsing (epic remote-dev-oyej.2).
 *
 * Reuses the SAME constant-time HMAC-SHA256 verifier as the deploy webhook
 * (`deploy-webhook-auth.ts`) — signature over the raw request body, header
 * `X-Hub-Signature-256: sha256=<hex>`. Adds a typed parser that normalizes the
 * GitHub event payload into the minimal shape the TriggerService matches on.
 */
export { verifySignature } from "@/lib/deploy-webhook-auth";

/** Normalized GitHub event the TriggerService matches against. */
export interface GithubEvent {
  /** X-GitHub-Event: pull_request | issues | check_suite | … */
  event: string;
  /** labeled | opened | completed | … */
  action?: string;
  /** owner/name */
  repoFullName?: string;
  /** PR head sha / check_suite head_sha — the per-run dedupe key. */
  headSha?: string;
  prNumber?: number;
  issueNumber?: number;
  /** Normalized label names (always an array). */
  labels: string[];
  /** check_suite/check_run conclusion: success | failure | … */
  conclusion?: string;
}

interface RawGithubBody {
  action?: unknown;
  repository?: { full_name?: unknown };
  pull_request?: {
    number?: unknown;
    head?: { sha?: unknown };
    labels?: Array<{ name?: unknown }>;
  };
  issue?: { number?: unknown };
  label?: { name?: unknown };
  check_suite?: { head_sha?: unknown; conclusion?: unknown };
  check_run?: { head_sha?: unknown; conclusion?: unknown };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Parse + normalize an inbound GitHub webhook into a {@link GithubEvent}.
 * Reads `X-GitHub-Event` for the event name and pulls the head SHA / labels /
 * numbers from whichever sub-object the event carries them in.
 */
export function parseGithubEvent(headers: Headers, body: unknown): GithubEvent {
  const b = (body ?? {}) as RawGithubBody;
  const event = headers.get("x-github-event") ?? "";

  const labels: string[] = Array.isArray(b.pull_request?.labels)
    ? b.pull_request!.labels!
        .map((l) => str(l?.name))
        .filter((n): n is string => !!n)
    : [];

  const headSha =
    str(b.pull_request?.head?.sha) ??
    str(b.check_suite?.head_sha) ??
    str(b.check_run?.head_sha);

  const conclusion =
    str(b.check_suite?.conclusion) ?? str(b.check_run?.conclusion);

  return {
    event,
    action: str(b.action),
    repoFullName: str(b.repository?.full_name),
    headSha,
    prNumber: num(b.pull_request?.number),
    issueNumber: num(b.issue?.number),
    labels,
    conclusion,
  };
}
