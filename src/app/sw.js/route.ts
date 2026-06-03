/**
 * `GET /sw.js` — service worker, served from a route handler so its cached
 * URLs are templated with the runtime `BASE_PATH`.
 *
 * Why a route instead of `public/sw.js`:
 *   Next.js bakes `basePath`/`assetPrefix` at BUILD time, but a single image
 *   must serve any slug chosen at RUNTIME (k3s) AND the default root
 *   (single-host prod). A static `public/sw.js` can't read the runtime prefix:
 *   hardcoding `/` breaks slug instances, and the build-time sentinel approach
 *   (used for the rest of the static tree) breaks root, because the container
 *   entrypoint materialization that rewrites the sentinel never runs on the
 *   single-host prod deploy. Serving the SW from this handler lets us
 *   interpolate the server-side `BASE_PATH` (read at process start by
 *   `@/lib/base-path`) so the cached URLs are correct in BOTH modes with no
 *   build-time baking and no boot-time rewrite:
 *     - root  (BASE_PATH === ""):     `/`, `/manifest.json`, `/icons/...`
 *     - slug  (BASE_PATH === "/alpha"): `/alpha/`, `/alpha/manifest.json`, ...
 *
 * Next automatically prefixes this route's PATH with the build `basePath`
 * (so it is served at `/sw.js` at root and `/alpha/sw.js` under a slug). The
 * registration component (`ServiceWorkerRegistration`) registers it at
 * `${runtimeBasePath()}/sw.js` with a matching `${prefix}/` scope.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_PATH } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sw.js");

// The SW body must be templated per-request from the runtime BASE_PATH; never
// statically optimized. (BASE_PATH is fixed for the process lifetime, but
// force-dynamic keeps the no-cache contract explicit and avoids any build-time
// snapshotting of the response.)
export const dynamic = "force-dynamic";

/**
 * Resolve a build identifier used to version the SW cache name. It must be:
 *   - unique per build (so a deploy yields a NEW cache name → `activate`
 *     purges the previous build's cache and the stale bundle is gone), and
 *   - stable across restarts of the SAME build (so a process restart does not
 *     needlessly bust caches and force every client to re-download).
 *
 * The Next.js build id (`.next/BUILD_ID`) satisfies both: it is a content-ish
 * id minted once per `next build` and read at runtime by the server. We resolve
 * its path relative to `process.cwd()` (the server's working dir is the app
 * root in every deploy shape) and fall back deterministically if it is missing
 * (e.g. `next dev`, or an unusual cwd):
 *   1. `.next/BUILD_ID`               (prod build — unique per deploy)
 *   2. `NEXT_PUBLIC_APP_VERSION`      (release version env, if set)
 *   3. `version` from `package.json`  (read via fs; coarse but deterministic)
 *   4. `"dev"`                        (last resort; never crash the route)
 *
 * Memoized: resolved at most once per process.
 *
 * The fs reader and env are injected (defaulting to the real ones) purely so
 * the unit test can exercise the fallback chain hermetically — production calls
 * `resolveBuildId()` with no args.
 */
let cachedBuildId: string | undefined;

/** Dependencies for `resolveBuildId`, injectable for hermetic testing. */
export interface BuildIdDeps {
  /** Reads a UTF-8 file; must throw on failure (matches `fs.readFileSync`). */
  readText: (path: string) => string;
  /** The release-version env value, if any. */
  appVersion: string | undefined;
}

const defaultBuildIdDeps: BuildIdDeps = {
  readText: (path) => readFileSync(path, "utf-8"),
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
};

function readBuildIdFile(deps: BuildIdDeps): string | undefined {
  try {
    const id = deps.readText(join(process.cwd(), ".next", "BUILD_ID")).trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

function readPackageVersion(deps: BuildIdDeps): string | undefined {
  try {
    const parsed = JSON.parse(deps.readText(join(process.cwd(), "package.json"))) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function resolveBuildId(deps: BuildIdDeps = defaultBuildIdDeps): string {
  if (cachedBuildId !== undefined) return cachedBuildId;

  const fromFile = readBuildIdFile(deps);
  if (fromFile) {
    cachedBuildId = fromFile;
    return cachedBuildId;
  }

  if (deps.appVersion) {
    cachedBuildId = deps.appVersion;
    log.warn(".next/BUILD_ID unreadable; falling back to NEXT_PUBLIC_APP_VERSION", {
      buildId: cachedBuildId,
    });
    return cachedBuildId;
  }

  const fromPkg = readPackageVersion(deps);
  if (fromPkg) {
    cachedBuildId = fromPkg;
    log.warn(".next/BUILD_ID and NEXT_PUBLIC_APP_VERSION unavailable; using package.json version", {
      buildId: cachedBuildId,
    });
    return cachedBuildId;
  }

  cachedBuildId = "dev";
  log.warn("No build identifier available for SW cache versioning; using 'dev'");
  return cachedBuildId;
}

/**
 * Test-only: clear the memoized build id so a test can exercise the resolution
 * chain from a clean state. Not used in production (the id is process-stable).
 */
export function __resetBuildIdCacheForTests(): void {
  cachedBuildId = undefined;
}

/**
 * Reduce an arbitrary build identifier to a safe `[A-Za-z0-9_-]` token for use
 * inside the cache name. Defense-in-depth on top of the `JSON.stringify` escape
 * boundary used when embedding it into the emitted JS source.
 */
function sanitizeBuildId(buildId: string): string {
  const token = buildId.replace(/[^A-Za-z0-9_-]/g, "-");
  return token || "dev";
}

/**
 * Build the service-worker source with `BASE_PATH`-prefixed cache URLs.
 * `BASE_PATH` is "" at root or e.g. "/alpha" under a slug, so `${BASE_PATH}/`
 * is "/" or "/alpha/" — exactly the app shell URL the SW should cache and use
 * as the offline-navigation fallback.
 *
 * Exported (and parameterized on `basePath` + `buildId`) so the unit test can
 * assert the emitted cache URLs for root and slug, and the per-build cache
 * name, without spinning up a request.
 *
 * `buildId` versions the cache name so each deploy mints a fresh cache;
 * `activate` (which deletes caches != CACHE_NAME) then purges the previous
 * build's cache, evicting stale bundles.
 */
export function serviceWorkerSource(basePath: string, buildId: string): string {
  // JSON.stringify is the escape boundary for embedding the prefix/buildId into
  // JS source — basePath is validated upstream (`/[a-z0-9-]` segments) and the
  // buildId is reduced to a `[A-Za-z0-9_-]` token, but we never
  // string-concatenate either raw into emitted code.
  const PREFIX = JSON.stringify(basePath);
  const CACHE_ID = JSON.stringify(sanitizeBuildId(buildId));
  return `// Service worker — generated by src/app/sw.js/route.ts.
// Cache URLs are templated from the server-side runtime BASE_PATH so the SW is
// correct at root (single-host prod) AND under a slug (k3s) with no build-time
// baking. BASE_PREFIX is "" at root or e.g. "/alpha" under a slug.
const BASE_PREFIX = ${PREFIX};
// Per-build cache name: a new deploy → new CACHE_NAME → \`activate\` purges the
// previous build's cache, so stale bundles are evicted automatically.
const CACHE_NAME = 'remote-dev-' + ${CACHE_ID};
const STATIC_ASSETS = [
  \`\${BASE_PREFIX}/\`,
  \`\${BASE_PREFIX}/manifest.json\`,
  \`\${BASE_PREFIX}/icons/icon-192x192.png\`,
  \`\${BASE_PREFIX}/icons/icon-512x512.png\`,
];

// Install: cache static assets.
//
// NOTE: no unconditional self.skipWaiting() here. An UPDATED worker must WAIT
// (stay in the 'installed'/waiting state) so the page keeps using the old
// worker until the user opts in via the reload toast (which posts SKIP_WAITING
// below). The very first install still activates promptly because there is no
// controlling worker to wait behind — there is no prior client to disrupt.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Allow the page to tell a waiting worker to activate immediately (user clicked
// "Reload" in the update toast). Pairs with the client's controllerchange
// handler, which reloads once the new worker takes control.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API/WebSocket, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip WebSocket and API requests - these must be online
  if (
    request.url.includes('/api/') ||
    request.url.startsWith('ws://') ||
    request.url.startsWith('wss://')
  ) {
    return;
  }

  // For navigation requests, try network first, fall back to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful navigation responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          // Offline: try to serve from cache, falling back to the app shell.
          // \`\${BASE_PREFIX}/\` is the instance's app-shell URL.
          const cached = await caches.match(request);
          return cached || caches.match(\`\${BASE_PREFIX}/\`);
        })
    );
    return;
  }

  // For static assets, use cache-first strategy
  if (
    request.destination === 'image' ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Return cached, but update in background
          fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, response);
                });
              }
            })
            .catch(() => {
              // Network error during background update, ignore silently
            });
          return cached;
        }
        // Not cached, fetch and cache
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
`;
}

export function GET(): Response {
  return new Response(serviceWorkerSource(BASE_PATH, resolveBuildId()), {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // SW updates must propagate quickly; never let a CDN/browser pin a stale
      // worker. The browser still byte-compares on its hourly update check.
      "Cache-Control": "no-cache",
    },
  });
}
