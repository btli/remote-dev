// @vitest-environment node
/**
 * Multi-instance hosting integration test.
 *
 * Verifies acceptance criteria AC-2, AC-3, and AC-5 from
 * `docs/plans/multi-instance-basepath.md §1` against a real running
 * Next.js server. Booting a full `next build` + `next start` from inside
 * vitest is too slow for the unit-test budget (~60s per build), so this
 * test runs in two modes:
 *
 *   1. **Default (gate closed):** the entire suite is skipped. We do
 *      not silently regress AC coverage — the gate prints a clear note
 *      pointing to `scripts/smoke-basepath.sh`, which is the load-bearing
 *      integration verification path.
 *
 *   2. **Opt-in (RDV_INTEGRATION_URL=http://localhost:6001):** the suite
 *      runs against an already-booted server, exercising the same HTTP
 *      assertions the smoke script does plus a couple of extras that
 *      benefit from vitest's structured assertions (Set-Cookie parsing,
 *      JSON body shape).
 *
 * Booting a server inline would couple this file to `bun run rdv:prod`'s
 * port hardcoding (6001/6002), `next build` timing, and the worktree's
 * native-modules version drift (see comment in `scripts/smoke-basepath.sh`).
 * Gating on RDV_INTEGRATION_URL keeps the unit-test runner fast and
 * deterministic while still letting CI or a developer run the full
 * matrix on demand:
 *
 *     bash scripts/smoke-basepath.sh                  # baseline (60s + 60s build)
 *     RDV_INTEGRATION_URL=http://localhost:6001 \
 *       RDV_INTEGRATION_BASE_PATH=/alpha \
 *       bun run test:run src/integration/multi-instance.test.ts
 *
 * AC coverage in this file (when opt-in is active):
 *   - AC-2: prefixed /alpha/login returns 200 + HTML
 *   - AC-3: bare /login returns 404 or 308 when basePath is set
 *   - AC-5: NextAuth cookies from /alpha carry Path=/alpha (session
 *           and callback-url cookies); CSRF cookie remains Path=/ per
 *           the __Host- prefix rules — that's expected and the
 *           isolation boundary is the per-instance AUTH_SECRET.
 *
 * AC-6 (two independent SQLite DBs / sign-in state) is **not** covered
 * here: it requires two concurrent server processes plus a credentials
 * sign-in flow, which crosses the bun/tsx/standalone artifact boundary
 * in ways that the unit-test runner cannot drive reliably. The smoke
 * script provides the baseline; the spec's §2 manual command list
 * documents the AC-6 verification path.
 */
import { describe, it, expect } from "vitest";

const INTEGRATION_URL = process.env.RDV_INTEGRATION_URL;
const INTEGRATION_BASE_PATH = process.env.RDV_INTEGRATION_BASE_PATH ?? "/alpha";

// Gate closed → skip-the-suite. We emit a single descriptive `it.skip` so
// reporters surface the gate explicitly instead of an empty file.
const describeMaybe = INTEGRATION_URL ? describe : describe.skip;

describeMaybe("multi-instance hosting (live server)", () => {
  const baseUrl = INTEGRATION_URL ?? "";
  const prefix = INTEGRATION_BASE_PATH;

  it("AC-2: prefixed /alpha/login returns 200 with HTML", async () => {
    const res = await fetch(`${baseUrl}${prefix}/login`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("<html");
  });

  it("AC-3: bare /login returns 404 or 308 when basePath is set", async () => {
    const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
    // Next.js returns 308 when its router has a basePath and the request
    // arrives without it; some edge configs surface as 404. Both satisfy
    // AC-3 ("the bare prefix is the instance's only root").
    expect([404, 308]).toContain(res.status);
  });

  it("AC-5: NextAuth cookies from /alpha carry Path=/alpha", async () => {
    // /api/auth/csrf is one of the few NextAuth endpoints that issues
    // cookies without requiring a sign-in flow. It always sets the
    // callback-url cookie and (after a POST) the CSRF cookie.
    const res = await fetch(`${baseUrl}${prefix}/api/auth/csrf`);
    expect(res.status).toBe(200);

    const setCookieHeader = res.headers.get("set-cookie") ?? "";
    expect(setCookieHeader.length).toBeGreaterThan(0);

    // The callback-url cookie is the load-bearing path-scoped one. Its
    // name is suffixed with the instance slug per `src/auth.ts`.
    const callbackUrlCookie = setCookieHeader
      .split(/, (?=[^;]+=)/)
      .find((c) => /callback-url=/i.test(c));
    expect(
      callbackUrlCookie,
      `expected a callback-url cookie in Set-Cookie: ${setCookieHeader}`,
    ).toBeTruthy();
    expect(callbackUrlCookie).toMatch(/Path=\/alpha(;|$)/i);
  });

  it("AC-5 (negative): no NextAuth cookies declare Path=/ except __Host-", async () => {
    // A cookie that's both auth-related AND set to Path=/ is the AC-5
    // failure mode (would leak across instances). The __Host- prefix
    // requires Path=/ by RFC 6265bis — that one is allowed.
    const res = await fetch(`${baseUrl}${prefix}/api/auth/csrf`);
    const setCookieHeader = res.headers.get("set-cookie") ?? "";
    const cookies = setCookieHeader.split(/, (?=[^;]+=)/);

    for (const cookie of cookies) {
      if (!/path=\//i.test(cookie)) continue;
      // __Host- cookies are spec-mandated to Path=/. Skip them.
      if (/^__Host-/i.test(cookie.trim())) continue;
      // All other auth cookies must declare Path=/alpha.
      if (/(session-token|callback-url|pkce|state|nonce)/i.test(cookie)) {
        expect(
          cookie,
          `auth cookie should be Path=/alpha, got: ${cookie}`,
        ).toMatch(/Path=\/alpha(;|$)/i);
      }
    }
  });

  it("/api/config exposes basePath + instanceSlug (when authenticated)", async () => {
    // Without auth this returns 401 — that's S-3 in the spec. We assert
    // the surface, not the payload, since the test fixture may or may
    // not have a valid session.
    const res = await fetch(`${baseUrl}${prefix}/api/config`);
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as {
        basePath: string;
        instanceSlug: string;
        version: string;
      };
      expect(body.basePath).toBe(prefix);
      expect(body.instanceSlug).toBeTruthy();
      expect(typeof body.version).toBe("string");
    }
  });
});

// When the gate is closed, emit one explicit it.skip so the runner shows
// the intentional skip with rationale rather than an empty suite.
if (!INTEGRATION_URL) {
  describe("multi-instance hosting (live server)", () => {
    it.skip("requires RDV_INTEGRATION_URL — run scripts/smoke-basepath.sh for AC-2/3/5", () => {
      // Intentionally empty. See module-level docstring for the opt-in
      // invocation.
    });
  });
}
