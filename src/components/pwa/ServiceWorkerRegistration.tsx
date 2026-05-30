"use client";

import { useEffect } from "react";
import { runtimeBasePath } from "@/lib/api-fetch";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

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

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
        .then((registration) => {
          console.log("SW registered:", registration.scope);

          // Check for updates periodically
          intervalId = setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000); // Every hour
        })
        .catch((error) => {
          console.error("SW registration failed:", error);
        });
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return null;
}
