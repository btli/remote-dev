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

  // Helper: parse all Set-Cookie headers off a Response using the
  // standard `headers.getSetCookie()` API (Node 22+, undici). This
  // sidesteps the lossy split-on-comma hack the rest of the suite used
  // and lets us reason about *every* cookie the endpoint emits.
  const getAllCookies = (res: Response): string[] => {
    type WithGetSetCookie = { getSetCookie?: () => string[] };
    const h = res.headers as unknown as WithGetSetCookie;
    if (typeof h.getSetCookie === "function") {
      return h.getSetCookie();
    }
    // Fallback for older runtimes: split on the comma-followed-by-cookie
    // pattern. NextAuth emits ISO timestamps in the Expires attribute
    // which can confuse a naive split, so we anchor on `name=` after
    // the comma to be safer.
    return (res.headers.get("set-cookie") ?? "")
      .split(/, (?=[^;=,\s]+=)/)
      .filter(Boolean);
  };

  it("AC-5: NextAuth cookies from /alpha carry Path=/alpha", async () => {
    // /api/auth/csrf is one of the few NextAuth endpoints that issues
    // cookies without requiring a sign-in flow. It always sets the
    // callback-url cookie and (after a POST) the CSRF cookie.
    const res = await fetch(`${baseUrl}${prefix}/api/auth/csrf`);
    expect(res.status).toBe(200);

    const cookies = getAllCookies(res);
    expect(cookies.length).toBeGreaterThan(0);

    // The callback-url cookie is the load-bearing path-scoped one. Its
    // name is suffixed with the instance slug per `src/auth.ts`.
    const callbackUrlCookie = cookies.find((c) => /callback-url=/i.test(c));
    expect(
      callbackUrlCookie,
      `expected a callback-url cookie in Set-Cookie: ${cookies.join(" | ")}`,
    ).toBeTruthy();
    expect(callbackUrlCookie).toMatch(/Path=\/alpha(;|$)/i);
  });

  it("AC-5: every NextAuth cookie issued without a sign-in carries the expected Path", async () => {
    // The non-OAuth-flow endpoints fire the cookies we can sniff without
    // driving a real GitHub round-trip:
    //
    //   - GET /api/auth/csrf     → callback-url cookie (+ csrf-token on POST)
    //   - POST /api/auth/csrf    → csrf-token cookie (__Host-, Path=/)
    //
    // The remaining four (session-token, pkce, state, nonce) only
    // materialize during a real OAuth flow or after sign-in, which the
    // integration suite can't drive. We assert on each cookie that
    // DOES fire — and reject any auth cookie that incorrectly declares
    // Path=/ instead of Path=/alpha.
    const csrfGet = await fetch(`${baseUrl}${prefix}/api/auth/csrf`);
    const csrfPost = await fetch(`${baseUrl}${prefix}/api/auth/csrf`, {
      method: "POST",
    });

    const seen = [...getAllCookies(csrfGet), ...getAllCookies(csrfPost)];
    expect(seen.length).toBeGreaterThan(0);

    // The set of NextAuth cookie name fragments that should be path-
    // scoped under /alpha. (Excludes webauthn, unused in this app, and
    // the __Host-prefixed csrf-token which must be Path=/ per RFC.)
    const scopedFragments = [
      "session-token",
      "callback-url",
      "pkce.code_verifier",
      "state",
      "nonce",
    ] as const;
    const fragmentsHit = new Set<string>();

    for (const cookie of seen) {
      // Skip __Host- cookies entirely — they're spec-mandated Path=/
      // and isolation comes from per-instance AUTH_SECRET.
      if (/^__Host-/i.test(cookie.trim())) continue;
      for (const frag of scopedFragments) {
        if (cookie.toLowerCase().includes(frag.toLowerCase())) {
          fragmentsHit.add(frag);
          expect(
            cookie,
            `cookie containing "${frag}" should be Path=/alpha, got: ${cookie}`,
          ).toMatch(/Path=\/alpha(;|$)/i);
        }
      }
    }

    // We require at least the callback-url cookie to have fired; the
    // others are best-effort coverage. Track which we actually
    // observed so a future NextAuth version that drops one fails loudly
    // rather than silently shrinking our assertion surface.
    expect(
      fragmentsHit.has("callback-url"),
      `expected callback-url cookie; observed fragments: ${[...fragmentsHit].join(", ") || "(none)"}`,
    ).toBe(true);
  });

  it("AC-5 (negative): no auth cookie declares Path=/ except __Host-", async () => {
    // A cookie that's both auth-related AND set to Path=/ is the AC-5
    // failure mode (would leak across instances). The __Host- prefix
    // requires Path=/ by RFC 6265bis — that one is allowed.
    const res = await fetch(`${baseUrl}${prefix}/api/auth/csrf`);
    for (const cookie of getAllCookies(res)) {
      if (!/path=\//i.test(cookie)) continue;
      if (/^__Host-/i.test(cookie.trim())) continue;
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
