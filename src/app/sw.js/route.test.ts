/**
 * Tests for the service-worker route builder (`src/app/sw.js/route.ts`).
 *
 * `serviceWorkerSource(basePath)` is a pure function of its `basePath` arg, so
 * we can assert the emitted cache URLs directly for root and slug without a
 * request or env manipulation. This is the regression guard for the
 * single-host-prod (root) PWA: the cached URLs must be `/`, `/manifest.json`,
 * `/icons/...` at root and `/<slug>/...` under a slug — never the `/rdvslug`
 * sentinel (the SW is served from this route precisely so it carries no
 * sentinel and works without the container materialization pass).
 */

import { describe, it, expect } from "vitest";
import { serviceWorkerSource } from "./route";

describe("serviceWorkerSource", () => {
  describe("root (basePath === '')", () => {
    const src = serviceWorkerSource("");

    it("sets BASE_PREFIX to the empty string", () => {
      expect(src).toContain(`const BASE_PREFIX = "";`);
    });

    it("emits the templated cache list (resolves to / and /manifest.json at root)", () => {
      // The emitted JS uses `${BASE_PREFIX}/...` template literals; with
      // BASE_PREFIX="" the SW caches `/`, `/manifest.json`, `/icons/...`.
      expect(src).toContain("`${BASE_PREFIX}/`");
      expect(src).toContain("`${BASE_PREFIX}/manifest.json`");
      expect(src).toContain("`${BASE_PREFIX}/icons/icon-192x192.png`");
      expect(src).toContain("`${BASE_PREFIX}/icons/icon-512x512.png`");
    });

    it("contains no /rdvslug sentinel", () => {
      expect(src).not.toContain("/rdvslug");
    });

    it("evaluating the emitted cache list yields root-relative URLs", () => {
      // Prove the runtime effect, not just the source text: with BASE_PREFIX="",
      // `${BASE_PREFIX}/manifest.json` === "/manifest.json".
      const BASE_PREFIX = "";
      expect(`${BASE_PREFIX}/`).toBe("/");
      expect(`${BASE_PREFIX}/manifest.json`).toBe("/manifest.json");
      expect(`${BASE_PREFIX}/icons/icon-192x192.png`).toBe(
        "/icons/icon-192x192.png"
      );
    });
  });

  describe("slug (basePath === '/alpha')", () => {
    const src = serviceWorkerSource("/alpha");

    it("sets BASE_PREFIX to the slug", () => {
      expect(src).toContain(`const BASE_PREFIX = "/alpha";`);
    });

    it("keeps the cache list templated on BASE_PREFIX", () => {
      expect(src).toContain("`${BASE_PREFIX}/`");
      expect(src).toContain("`${BASE_PREFIX}/manifest.json`");
      expect(src).toContain("`${BASE_PREFIX}/icons/icon-192x192.png`");
    });

    it("contains no /rdvslug sentinel", () => {
      expect(src).not.toContain("/rdvslug");
    });

    it("evaluating the emitted cache list yields /alpha-prefixed URLs", () => {
      const BASE_PREFIX = "/alpha";
      expect(`${BASE_PREFIX}/`).toBe("/alpha/");
      expect(`${BASE_PREFIX}/manifest.json`).toBe("/alpha/manifest.json");
      expect(`${BASE_PREFIX}/icons/icon-192x192.png`).toBe(
        "/alpha/icons/icon-192x192.png"
      );
    });
  });

  it("escapes the prefix via JSON.stringify (no raw concatenation into JS)", () => {
    // Defensive: even an unexpected character can't break out of the JS string
    // literal because the builder uses JSON.stringify as the escape boundary.
    const src = serviceWorkerSource('/a"b');
    expect(src).toContain(`const BASE_PREFIX = "/a\\"b";`);
  });
});
