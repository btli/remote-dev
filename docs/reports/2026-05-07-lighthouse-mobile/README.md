# Lighthouse Mobile Perf Measurement (Phase 7)

**Date:** 2026-05-07
**Branch:** `perf/phase7-lighthouse-measure`
**Beads:** `remote-dev-k583`
**Previous attempt:** blocked on `remote-dev-unpj` (worktree node_modules tooling), now unblocked by `scripts/worktree-warm.sh`.

## Setup

- **Build:** `bun run build` against the worktree (Next.js 16.1, Turbopack, output: standalone). Cold start to a successful build via `worktree-warm.sh`: ~33 s clone + build.
- **Servers:** Next.js on `:8001`, terminal server on `:8002`. Both started with `bun run start` / `bun run start:terminal` and `NODE_ENV` set by `dotenv -e .env.local`. Note: `next start` warns that it does not work with `output: standalone` — for these measurements it still served the routes correctly because the Next.js compiled bundles are present in `.next/`. For a maximally faithful production run, future passes should use `node .next/standalone/server.js`.
- **Auth:** localhost-only NextAuth credentials. Cookie obtained via:
  1. `GET /api/auth/csrf` to grab the token.
  2. `POST /api/auth/callback/credentials` with `csrfToken` + `email=you@example.com` + `callbackUrl=…` + `json=true`. Response sets `authjs.session-token`.
  3. Cookie passed to Lighthouse via `--extra-headers='{"Cookie":"authjs.session-token=…"}'`.
- **Tool:** `bunx lighthouse@latest`, headless Chrome (Lighthouse-bundled), `--throttling-method=simulate`, `--screenEmulation.mobile`, `--form-factor=mobile`. Performance category only.

## Routes Measured

The mobile app is **not URL-routed** — `MobileViewportSwitch` swaps to `MobileApp` (with sessions/notifications/channels/profile tabs) below the Tailwind `md` breakpoint based on viewport, not pathname. Tabs are local React state with no `searchParams` plumbing. Lighthouse therefore measures one mobile entry: `/`. The login page is also covered for completeness (every user hits it cold).

A single-session `/sessions/<id>` deep-link route does not exist in this codebase — there is no `src/app/sessions/[id]/` segment. Skipped accordingly.

| Route | Form factor | Auth | Perf | FCP | LCP | TBT | CLS | Verdict |
|-------|-------------|------|------|-----|-----|-----|-----|---------|
| `/login` | mobile | – | **82** | 1.1 s | 5.0 s | 10 ms | 0.032 | sub-90 ❌ |
| `/` (mobile, run 1) | mobile | yes | **72** | 1.1 s | 6.6 s | 250 ms | 0.001 | sub-90 ❌ |
| `/` (mobile, run 2) | mobile | yes | **73** | 1.1 s | 7.2 s | 220 ms | 0.001 | sub-90 ❌ |
| `/` (desktop, ref) | desktop | yes | **64** | 1.1 s | 6.7 s | 260 ms | 0    | sub-90 ❌ |

Numbers are stable across the two mobile runs (±1 score, ±0.6 s LCP).

## Top Opportunity (every route)

`unused-javascript`: **~1.95 s of potential savings on `/`**, ~150 ms on `/login`.

Breakdown of unused bytes on the authenticated home (mobile):
- `_next/static/chunks/709807f2ce7f7be7.js`: **340.8 KB unused / 470.4 KB total (72 % unused)**
- `_next/static/chunks/06074651d1dbb678.js`: 24.7 KB / 68.6 KB (36 % unused)

The 470 KB chunk is the page-level bundle. It is shipped to mobile users despite `MobileViewportSwitch` only mounting `<MobileApp>` on small viewports — the desktop `<SessionManager>` and its dependency graph are still part of the same client component tree, so they ship in the initial page bundle. The mobile user pays the parse / compile cost for code that will never render.

LCP element on `/` is `p.text-[22px]` (welcome / branding copy). `lcp-breakdown-insight` shows TTFB = 23 ms but `elementRenderDelay` = 236 ms (per the synthetic trace) — the *simulated* LCP of 6.6 s is dominated by main-thread parse of the giant JS chunk, not by network or paint.

Other audits are healthy: FCP 1.1 s, Speed Index 1.1 s, CLS ≈ 0, TBT 220–260 ms (under the 300 ms threshold), no render-blocking resources, fonts already use `font-display`, no missing image dimensions, no obvious preconnect candidates (everything is same-origin).

## Trivial fixes considered

Per the bead's brief, I checked for one-line wins:

- **Image dimensions:** no flagged images on either route (CLS ≈ 0 on home; the 0.032 on `/login` comes from the form layout, not images).
- **`<link rel="preconnect">`:** all critical resources are same-origin (`localhost:8001`); no third-party CDN to preconnect to.
- **`font-display: swap`:** `unminified-font-display` audit not flagged.

There is no quick fix that lifts this above 90. The path forward is bundle splitting.

## Recommendation

Lift the perf-≥90 acceptance via a `MobileApp` code-split: dynamic `import()` `MobileViewportSwitch`'s desktop branch (`SessionManager` and friends) so mobile viewports never download or parse it on first paint, and vice-versa. That should knock most of the 340 KB unused chunk off the mobile critical path. Filed as a follow-up bead.

## Files

Raw outputs per route (JSON + HTML):
- `login.report.{json,html}`
- `home.report.{json,html}` — primary mobile authenticated run
- `home-mobile-run2.report.{json,html}` — stability check
- `home-desktop.report.{json,html}` — desktop reference

Auth cookie + helper script lived in `/tmp/lighthouse-k583/` (intentionally outside the repo).
