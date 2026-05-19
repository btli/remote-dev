/**
 * `GET /api/config` — runtime configuration probe.
 *
 * Returns the deployment's `basePath`, `instanceSlug`, and the package
 * version. Used by external tooling (k8s probes, ops scripts) and by the
 * smoke tests in `docs/plans/multi-instance-basepath.md §2` to confirm
 * the right pod answered.
 *
 * Auth: gated through `withApiAuth` (session OR API-key) to satisfy
 * security requirement S-3 in the spec: a bare-anon GET would leak the
 * `instanceSlug`, which is part of the cookie name and could simplify
 * brute-forcing cookie identifiers across instances.
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { BASE_PATH, INSTANCE_SLUG } from "@/lib/base-path";

// `npm_package_version` is set automatically by every package manager
// (npm, bun, yarn) when scripts run. In standalone production builds
// without a wrapping script, fall back to the build-time-injected value
// from `package.json` via `process.env` lookup — but we keep this simple:
// "unknown" is acceptable for a sanity probe.
const VERSION = process.env.npm_package_version ?? "unknown";

export const GET = withApiAuth(async () => {
  return NextResponse.json({
    basePath: BASE_PATH,
    instanceSlug: INSTANCE_SLUG,
    version: VERSION,
  });
});
