/**
 * Supervisor-router E2E smoke (spec §11 + §15 M5/M8 / bd remote-dev-jvcx.11).
 *
 * The CI regression-guard for the single-front-door router. Boots (via the
 * sibling docker-compose) the Supervisor control plane + the router + ≥1
 * slug-aware instance, then asserts END-TO-END **through the router only**
 * (ROUTER_BASE_URL, default http://localhost:6004 — we never talk to an upstream
 * directly):
 *
 *   1. router liveness (`/healthz`);
 *   2. the Supervisor login page is reachable at ROOT (`/login`) through the
 *      router (Option C: root → Supervisor dashboard) + static asset load;
 *   3. for each instance slug: the login page is reachable at `/<slug>/login`,
 *      its HTML references the MATERIALIZED `/<slug>/_next/...` asset prefix
 *      (proving the slug-aware basePath rewrite happened), and one of those
 *      hashed assets actually loads through the router (nav/asset surface);
 *   4. for each instance slug: a LIVE WebSocket terminal connects over
 *      `/<slug>/ws` through the router, creates a tmux-backed PTY, and echoes a
 *      sentinel back (bidirectional) — the §15 M5 exit criterion.
 *
 * The terminal WS auth is an HMAC(`sessionId:userId:timestamp`) signed with the
 * instance's AUTH_SECRET (see src/lib/ws-token.ts `generateWsToken`). The
 * terminal server validates the token and, given a fresh tmux name, CREATES the
 * session and attaches a PTY with no DB session row required — so the smoke
 * needs only the shared AUTH_SECRET, not a provisioned project/session.
 *
 * Runtime: `bun deploy/k8s/supervisor/e2e/smoke.ts`. Uses ONLY Bun built-ins
 * (fetch, WebSocket, node:crypto) so it runs with no node_modules.
 *
 * Exit code 0 = all assertions passed; non-zero = first failure (logged).
 */

import { createHmac, randomUUID } from "node:crypto";

// ── Config (env-overridable) ─────────────────────────────────────────────────

/** The router is the SINGLE entrypoint — every assertion goes through this base. */
const ROUTER_BASE_URL = (
  process.env.ROUTER_BASE_URL ?? "http://localhost:6004"
).replace(/\/$/, "");
/** ws:// base derived from the router HTTP base (http→ws, https→wss). */
const ROUTER_WS_BASE = ROUTER_BASE_URL.replace(/^http/, "ws");
/** Instance slugs to assert (must match the seeded + compose-aliased instances). */
const SLUGS = (process.env.E2E_SLUGS ?? "alpha,beta")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** The AUTH_SECRET shared by the instance containers (to mint the WS token). */
const INSTANCE_AUTH_SECRET =
  process.env.E2E_INSTANCE_AUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
/** Overall per-phase HTTP timeout. */
const HTTP_TIMEOUT_MS = Number(process.env.E2E_HTTP_TIMEOUT_MS ?? "15000");
/** WS open + first-message + echo deadline. */
const WS_TIMEOUT_MS = Number(process.env.E2E_WS_TIMEOUT_MS ?? "20000");

// ── Tiny assertion harness ───────────────────────────────────────────────────

let failures = 0;
let checks = 0;

function pass(name: string, detail?: string): void {
  checks++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  checks++;
  failures++;
  console.error(`  ✗ ${name} — ${detail}`);
}

function section(title: string): void {
  console.log(`\n▶ ${title}`);
}

async function httpGet(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${ROUTER_BASE_URL}${path}`, {
      ...init,
      redirect: "manual", // we assert on real status codes, not followed redirects
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      body,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── WS terminal token (mirrors src/lib/ws-token.ts generateWsToken) ──────────

function generateWsToken(
  sessionId: string,
  userId: string,
  secret: string,
): string {
  const timestamp = Date.now();
  const data = `${sessionId}:${userId}:${timestamp}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(`${data}:${hmac}`).toString("base64");
}

// ── Phase 1: router liveness ─────────────────────────────────────────────────

async function assertRouterHealth(): Promise<void> {
  section("Router liveness");
  try {
    const { status, body } = await httpGet("/healthz");
    if (status === 200 && body.includes("ok")) {
      pass("GET /healthz → 200 ok");
    } else {
      fail("GET /healthz", `status=${status} body=${body.slice(0, 120)}`);
    }
  } catch (err) {
    fail("GET /healthz", `request failed: ${String(err)}`);
  }
}

// ── Phase 2: Supervisor (root) reachable through the router ──────────────────

async function assertSupervisorRoot(): Promise<void> {
  section("Supervisor dashboard at ROOT through the router (Option C)");

  // The Supervisor login page must be reachable unauthenticated at `/login`.
  try {
    const { status, body } = await httpGet("/login");
    if (status === 200 && /<html/i.test(body)) {
      pass("GET /login → 200 HTML (Supervisor login reachable at root)");
    } else {
      fail("GET /login", `status=${status} (expected 200 HTML)`);
    }
  } catch (err) {
    fail("GET /login", `request failed: ${String(err)}`);
  }

  // The dashboard root `/`: in insecure-auth dev mode the Supervisor serves it
  // (200) or redirects to `/login` (3xx) — either proves the router fronts the
  // Supervisor at root (it is NOT a 404 from the router / an instance).
  try {
    const { status } = await httpGet("/");
    if (status === 200 || (status >= 300 && status < 400)) {
      pass("GET / → Supervisor dashboard (200 or redirect to login)", `status=${status}`);
    } else {
      fail("GET /", `status=${status} (expected 200 or 3xx, got a non-Supervisor response)`);
    }
  } catch (err) {
    fail("GET /", `request failed: ${String(err)}`);
  }

  // A Supervisor static asset must load through the router (root asset surface).
  await assertStaticAssetLoads("", "/login");
}

// ── Phase 3: each instance slug reachable + materialized through the router ──

/**
 * Pull the login HTML for `basePath` (""=root, "/alpha"=slug), extract a hashed
 * `<prefix>/_next/static/...` asset URL from it, and fetch that asset through
 * the router — proving (a) the page renders and (b) its asset prefix resolves.
 */
async function assertStaticAssetLoads(
  basePath: string,
  loginPath: string,
): Promise<void> {
  const label = basePath === "" ? "root" : basePath;
  let html: string;
  try {
    const res = await httpGet(`${basePath}${loginPath}`);
    if (res.status !== 200) {
      fail(`[${label}] asset discovery`, `login fetch status=${res.status}`);
      return;
    }
    html = res.body;
  } catch (err) {
    fail(`[${label}] asset discovery`, `login fetch failed: ${String(err)}`);
    return;
  }

  // Next emits `${basePath}/_next/static/...` references for chunks/css. Find one.
  const assetRe = new RegExp(
    `${escapeRegExp(basePath)}/_next/static/[^"'\\\\\\s)]+`,
    "g",
  );
  const matches = html.match(assetRe);
  if (!matches || matches.length === 0) {
    fail(
      `[${label}] _next asset prefix`,
      `no '${basePath}/_next/static/...' reference in login HTML (materialization likely incomplete)`,
    );
    return;
  }
  pass(
    `[${label}] login HTML references ${basePath}/_next/static (materialized asset prefix)`,
    `${matches.length} refs`,
  );

  // Fetch the first concrete asset through the router; it must 200.
  const assetUrl = decodeHtmlEntities(matches[0]);
  try {
    const res = await httpGet(assetUrl);
    if (res.status === 200) {
      pass(`[${label}] GET ${truncate(assetUrl)} → 200 (asset loads through router)`);
    } else {
      fail(`[${label}] static asset`, `GET ${assetUrl} → ${res.status}`);
    }
  } catch (err) {
    fail(`[${label}] static asset`, `GET ${assetUrl} failed: ${String(err)}`);
  }
}

async function assertInstanceHttp(slug: string): Promise<void> {
  section(`Instance /${slug} through the router`);

  // Login page reachable at /<slug>/login (unauthenticated, slug-scoped).
  try {
    const { status, body } = await httpGet(`/${slug}/login`);
    if (status === 200 && /<html/i.test(body)) {
      pass(`GET /${slug}/login → 200 HTML (instance login reachable through router)`);
    } else {
      fail(`GET /${slug}/login`, `status=${status} (expected 200 HTML)`);
    }
  } catch (err) {
    fail(`GET /${slug}/login`, `request failed: ${String(err)}`);
  }

  // Materialized asset prefix + a real asset load.
  await assertStaticAssetLoads(`/${slug}`, "/login");
}

// ── Phase 4: live WebSocket terminal through the router ──────────────────────

interface WsTerminalResult {
  created: boolean;
  echoed: boolean;
  error?: string;
}

/**
 * Open `wss://router/<slug>/ws?token=...`, expect a `session_created` (or
 * `session_attached`) control frame, write a sentinel via `{type:"input"}`, and
 * wait for it to come back in an `{type:"output"}` frame — proving the router
 * forwarded the upgrade + Sec-WebSocket-* headers AND a bidirectional PTY is
 * live behind it.
 */
function assertWsTerminal(slug: string): Promise<WsTerminalResult> {
  return new Promise<WsTerminalResult>((resolve) => {
    // sessionId MUST be a UUID: the terminal server derives the tmux name as
    // `rdv-<sessionId>` and gates it with validateSessionName, which requires
    // EXACTLY `rdv-<uuid-v4>`. (The WS token HMAC accepts any sessionId, but the
    // tmux-name validator does not.) A fresh UUID also guarantees the CREATE
    // branch (no pre-existing tmux session → no DB row needed).
    const sessionId = randomUUID();
    const userId = "smoke-user";
    const token = generateWsToken(sessionId, userId, INSTANCE_AUTH_SECRET);
    const sentinel = `RDV_SMOKE_${slug.toUpperCase()}_${Math.floor(
      Math.random() * 1e6,
    )}`;
    // Let the server derive the tmux name (`rdv-<sessionId>`); don't pass
    // tmuxSession explicitly so it stays in lockstep with the validated format.
    const url =
      `${ROUTER_WS_BASE}/${slug}/ws` +
      `?token=${encodeURIComponent(token)}` +
      `&cols=80&rows=24&terminalType=shell`;

    const result: WsTerminalResult = { created: false, echoed: false };
    let settled = false;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      finish({ ...result, error: "timed out waiting for created+echo" });
    }, WS_TIMEOUT_MS);

    function finish(r: WsTerminalResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(r);
    }

    ws.addEventListener("open", () => {
      // Nothing to send yet — wait for the server's session_created control frame
      // before writing input (so the PTY is attached).
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: { type?: string; data?: string; message?: string };
      try {
        msg = JSON.parse(
          typeof event.data === "string" ? event.data : String(event.data),
        );
      } catch {
        return; // ignore non-JSON frames
      }
      if (msg.type === "error") {
        finish({ ...result, error: `server error frame: ${msg.message}` });
        return;
      }
      if (msg.type === "session_created" || msg.type === "session_attached") {
        result.created = true;
        // Drive the PTY: echo the sentinel. `\r` (not `\n`) submits in a TTY.
        ws.send(JSON.stringify({ type: "input", data: `echo ${sentinel}\r` }));
        return;
      }
      if (msg.type === "output" && typeof msg.data === "string") {
        // The shell echoes the typed command AND its output; either contains the
        // sentinel. Guard against matching only the keystroke echo by requiring
        // the sentinel to appear on its own (the command line has `echo `+sentinel,
        // the output line has just the sentinel) — a plain includes() is enough
        // and robust to terminal control codes around it.
        if (msg.data.includes(sentinel)) {
          result.echoed = true;
          finish(result);
        }
      }
    });

    ws.addEventListener("error", () => {
      // The browser-style WebSocket error event carries no detail; the close
      // event (or the timeout) reports the real reason.
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (!result.echoed) {
        finish({
          ...result,
          error:
            result.error ??
            `socket closed before echo (code=${event.code} reason=${
              event.reason || "n/a"
            })`,
        });
      }
    });
  });
}

async function assertInstanceWs(slug: string): Promise<void> {
  section(`Live WS terminal /${slug}/ws through the router (§15 M5)`);
  if (!INSTANCE_AUTH_SECRET) {
    fail(
      `[${slug}] WS terminal`,
      "E2E_INSTANCE_AUTH_SECRET / AUTH_SECRET not set — cannot mint a WS token",
    );
    return;
  }
  const r = await assertWsTerminal(slug);
  if (r.created) {
    pass(`[${slug}] WS upgrade through router → tmux PTY created`);
  } else {
    fail(`[${slug}] WS upgrade`, r.error ?? "no session_created frame");
  }
  if (r.echoed) {
    pass(`[${slug}] live terminal echoed sentinel (bidirectional through router)`);
  } else {
    fail(`[${slug}] live terminal echo`, r.error ?? "sentinel never returned");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(s: string): string {
  // Next.js HTML-escapes `&` in URLs as `&amp;`; undo just that for the fetch.
  return s.replace(/&amp;/g, "&");
}

function truncate(s: string, n = 64): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Supervisor-router E2E smoke");
  console.log(`  router:  ${ROUTER_BASE_URL}`);
  console.log(`  slugs:   ${SLUGS.join(", ")}`);

  await assertRouterHealth();
  await assertSupervisorRoot();
  for (const slug of SLUGS) {
    await assertInstanceHttp(slug);
  }
  for (const slug of SLUGS) {
    await assertInstanceWs(slug);
  }

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"}: ${checks - failures}/${checks} checks passed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke: FATAL:", err);
  process.exit(1);
});
