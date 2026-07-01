# Off-LAN Cloudflare Access auth for the mobile API client

**Status:** Design — awaiting approval before implementation
**Date:** 2026-06-06
**Surfaced by:** user report "off the local network, mobile app still doing infinite loop"

## Problem

The homelab supervisor host `rdv.example.com` is **dual-path**:

| | Path | Edge gate | App credential | Result |
|---|---|---|---|---|
| **On-LAN** | DNS → Traefik VIP `172.16.1.200` → router → instance | none | OIDC session cookie | 200 |
| **Off-LAN** | DNS → Cloudflare → **CF Tunnel** → router → instance | **Cloudflare Access** | *(only OIDC cookie)* | **302** |

Off-LAN, the app's Dio API client carries the OIDC session cookie but **no `CF_Authorization`** (the Cloudflare-edge JWT), so **every** non-interactive API call is bounced with a `302 → cloudflareaccess.com` at the CF edge — it never reaches the instance (proven: on-LAN an unauthenticated push POST returns `401` + `x-rdv-instance: demo`; off-LAN it returns `302` with no instance header).

This manifested as the push-token registrar **retry-storming** (`[Push] register … failed: DioException 302`, ~every 2-3s) — see the companion loop fix below.

## Constraint (the architectural wrinkle)

`CF_Authorization` is minted at the **Cloudflare edge** after an interactive CF Access login. The app's `/auth/mobile-callback` runs **inside the tunnel** (behind the edge), so it can **never see/return** the edge cookie. The investigation confirmed the only component that can obtain `CF_Authorization` is the **WebView** (it can complete the interactive CF Access login at the edge). So the design must **harvest** `CF_Authorization` out of the WebView's cookie jar and share it with the Dio client.

(Existing cookie flow is one-way: store → WebView seed. We add the reverse: WebView → store harvest.)

## Design

1. **Auto-detect CF-Access-gated hosts.** `cf_auth_interceptor.dart` already detects a CF Access challenge (`302 → *.cloudflareaccess.com`). When it sees one for a host, flag that host as CF-Access-gated (runtime + persisted) and signal "needs CF_Authorization harvest". No new user-facing config.

2. **Harvest `CF_Authorization` from the WebView.** Add a harvester (reverse of `webview_cookie_seeder.dart`): after the session WebView loads the host origin and completes any CF Access challenge (`onLoadStop` / nav-committed to the host), read the host's `CF_Authorization` cookie — it is `HttpOnly`, readable via the native `CookieManager.getCookies(origin)` — and persist it through `MobileCredentialsStore.setHostAuthCookies` (host-scoped, path `/`, with the cookie's real expiry).

3. **Dio sends it.** No new send path needed — `cf_auth_interceptor` already attaches **host auth cookies** to every request. The harvested `CF_Authorization` (stored as a host auth cookie) is therefore sent on all Dio calls → passes the CF edge → tunnel → instance → the OIDC cookie authenticates there → 200.

4. **Expiry / re-harvest.** CF Access sessions expire. When Dio gets a CF `302` again, the interceptor flags the host for re-harvest; the next session-WebView load re-harvests. The background push registrar (no WebView) is best-effort: it succeeds while `CF_Authorization` is valid, and after expiry it **backs off** (loop fix) and re-succeeds once the user next opens a session (re-harvest) or returns on-LAN.

5. **Loop fix (ships regardless).**
   - `connectivity_plus_adapter.dart`: add `.distinct()` so the coarse online/offline stream only emits on genuine transitions (the cellular `onCapabilitiesChanged` flood was keeping `_retryQueued` set, so `_afterPass` did immediate re-runs and the 15s→5min backoff **never engaged**).
   - `push_token_registrar.dart`: ensure a persistent CF-`302` failure settles into the existing exponential backoff (no tight loop) rather than perpetual immediate retries.

## Files

- `mobile/lib/infrastructure/webview/webview_cookie_seeder.dart` (or a sibling harvester) — `harvestHostEdgeCookies(origin)` reading `CF_Authorization` via `CookieManager`.
- `mobile/lib/presentation/screens/session_view/session_view_screen.dart` — wire the harvest after the WebView loads the host.
- `mobile/lib/infrastructure/auth/mobile_credentials.dart` — persist the harvested cookie as a host auth cookie (setters already exist).
- `mobile/lib/infrastructure/api/cf_auth_interceptor.dart` — flag host CF-Access-gated on CF-`302`; expose a "needs re-harvest" signal.
- `mobile/lib/infrastructure/network/connectivity_plus_adapter.dart` — `.distinct()`.
- `mobile/lib/infrastructure/push/push_token_registrar.dart` — backoff engages on persistent failure.
- Tests: adapter de-dupe; registrar backoff-engages-under-event-flood; harvester reads + persists the edge cookie.

## Key assumption — validate on-device

**The session WebView completes the interactive CF Access login off-LAN**, so `CF_Authorization` is obtainable + harvestable. This is how OIDC already works in the WebView (remote-dev-8erx/gkuo); CF Access login is a similar interactive web flow. **Validation:** off-LAN on a real device — open a session, complete the CF Access login in the WebView, confirm `CF_Authorization` is harvested into the store, and that a subsequent Dio call (push re-registration) returns **200** through the tunnel.

## Risks / open questions

- WebView-off-LAN-CF-Access assumption (above) — the linchpin; validate first during implementation.
- Reading the `HttpOnly` `CF_Authorization` via `flutter_inappwebview`'s `CookieManager` (supported, but confirm on both platforms).
- CF Access session TTL → periodic re-harvest; acceptable since interactive use re-harvests and on-LAN doesn't need it.
- Scope guard: the loop fix is independent and low-risk; it can ship first/standalone if the larger feature needs more validation time.

## Outcome (2026-06-06)

Implemented + validated on-device (Pixel 10 Pro Fold, off-LAN on cellular): the WebView CF Access login → `CF_Authorization` harvest → Dio API calls pass the Cloudflare edge. Push re-registration reached BOTH demo+dev instances off-LAN (`push_token.updated_at` advanced through the tunnel), the session terminal works off-LAN, and the retry-storm is gone. Codex adversarial review: 3 findings (host-CF-wins precedence, setHostCfToken/authCookies sync, loadStop URL redaction) — all fixed. bd: remote-dev-4gxn.
