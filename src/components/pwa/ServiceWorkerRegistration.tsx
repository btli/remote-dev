"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { runtimeBasePath } from "@/lib/api-fetch";

// Module-scoped guard so this tab reloads at most once after the user adopts an
// update — never a double reload, even if the effect re-runs (StrictMode).
let refreshing = false;

// De-dupe the update toast by the *waiting worker instance* (not an effect-local
// boolean), so a remount/StrictMode re-run doesn't stack a second toast for the
// same pending update, while a genuinely new update (a different waiting worker)
// still surfaces a fresh toast.
let toastedWorker: ServiceWorker | null = null;

export function ServiceWorkerRegistration() {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Show the "new version" toast for a waiting worker, then drive the reload
    // from THAT worker's activation — so only the tab whose user clicks Reload
    // reloads. We never listen to the global `controllerchange` event: with
    // `clients.claim()` in the SW, controllerchange fires on first install AND
    // in every open tab when any one tab activates the worker, which would
    // spuriously reload new visitors and force-reload all tabs.
    const promptReload = (registration: ServiceWorkerRegistration) => {
      const waiting = registration.waiting;
      if (!waiting || toastedWorker === waiting) return;
      toastedWorker = waiting;
      toast("A new version is available", {
        description: "Reload to update.",
        action: {
          label: "Reload",
          onClick: () => {
            if (refreshing) return;
            const w = registration.waiting;
            // Worker already activated (e.g. another tab triggered it): just
            // reload this tab now.
            if (!w) {
              refreshing = true;
              window.location.reload();
              return;
            }
            // Reload only once THIS worker activates — scoped to this tab, so
            // other tabs are never force-reloaded.
            w.addEventListener("statechange", () => {
              if (w.state === "activated" && !refreshing) {
                refreshing = true;
                window.location.reload();
              }
            });
            w.postMessage({ type: "SKIP_WAITING" });
          },
        },
        // Persistent: don't auto-dismiss. The user can still dismiss it
        // manually; clicking Reload drives the SKIP_WAITING → activated → reload
        // path for this tab only.
        duration: Infinity,
      });
    };

    // Slug-aware registration.
    //
    // The SW is served from a route handler (`src/app/sw.js/route.ts`) whose
    // cached URLs are templated with the runtime `BASE_PATH`, so it is correct
    // both at root (single-host prod) and under a slug (k3s) with no build-time
    // baking. Register it at `${basePath}/sw.js` with a matching `${basePath}/`
    // scope: "" at root → `/sw.js` scope `/` (today's prod behavior); `/alpha`
    // under a slug → `/alpha/sw.js` scope `/alpha/`. `basePath` is read from
    // the SSR-injected `window.__RDV_BASE_PATH__` (same source as apiFetch).
    const basePath = runtimeBasePath();

    navigator.serviceWorker
      .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
      .then((registration) => {
        // A worker may already be waiting (it finished installing in a prior
        // session and is parked behind the active worker). Surface the toast
        // immediately so the user can adopt it. The controller check ensures
        // this is an update to an already-controlled page, not a first install.
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptReload(registration);
        }

        // Detect updates that install while this page is open. On 'installed'
        // with an existing controller it's an UPDATE (not a first install), so
        // prompt the user. First install (no controller) activates silently.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promptReload(registration);
            }
          });
        });

        // Check for updates periodically. The browser byte-compares the SW
        // (served no-cache) and fires `updatefound` when the bundle changed.
        intervalId = setInterval(
          () => {
            registration.update();
          },
          60 * 60 * 1000
        ); // Every hour
      })
      .catch((error) => {
        console.error("SW registration failed:", error);
      });

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return null;
}
