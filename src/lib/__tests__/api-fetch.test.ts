/**
 * Tests for `src/lib/api-fetch.ts`.
 *
 * Like `base-path.test.ts`, this exercises module-level env capture by
 * resetting modules between cases. The runtime basePath read on the client
 * comes from `window.__RDV_BASE_PATH__`, so we mutate that directly per
 * test rather than reloading the module.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;

// `Window.__RDV_BASE_PATH__` is declared globally in `src/types/window.d.ts`.

async function loadApiFetch(env: { RDV_BASE_PATH?: string }) {
  vi.resetModules();
  if ("RDV_BASE_PATH" in env) {
    if (env.RDV_BASE_PATH === undefined) delete process.env.RDV_BASE_PATH;
    else process.env.RDV_BASE_PATH = env.RDV_BASE_PATH;
  }
  return await import("../api-fetch");
}

describe("api-fetch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    delete window.__RDV_BASE_PATH__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_BASE_PATH === undefined) delete process.env.RDV_BASE_PATH;
    else process.env.RDV_BASE_PATH = ORIGINAL_BASE_PATH;
    vi.resetModules();
  });

  it("passes through paths unchanged when basePath is empty", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "" });
    await apiFetch("/api/sessions");
    expect(fetchSpy).toHaveBeenCalledWith("/api/sessions", undefined);
  });

  it("prepends runtime basePath to absolute paths", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    await apiFetch("/api/sessions");
    expect(fetchSpy).toHaveBeenCalledWith("/alpha/api/sessions", undefined);
  });

  it("prefers window.__RDV_BASE_PATH__ over import-time BASE_PATH", async () => {
    // Module captures BASE_PATH="/alpha" at load, but window says /beta.
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/beta";
    await apiFetch("/api/sessions");
    expect(fetchSpy).toHaveBeenCalledWith("/beta/api/sessions", undefined);
  });

  it("treats `/` as the basePath root", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    await apiFetch("/");
    expect(fetchSpy).toHaveBeenCalledWith("/alpha", undefined);
  });

  it("passes through full URLs", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    await apiFetch("https://github.com/api/foo");
    expect(fetchSpy).toHaveBeenCalledWith("https://github.com/api/foo", undefined);
  });

  it("passes through protocol-relative URLs unchanged", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    await apiFetch("//other-host/path");
    expect(fetchSpy).toHaveBeenCalledWith("//other-host/path", undefined);
  });

  it("passes through Request objects unchanged", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    const req = new Request("https://example.com/api/foo");
    await apiFetch(req);
    expect(fetchSpy).toHaveBeenCalledWith(req, undefined);
  });

  it("forwards init options", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    const init: RequestInit = { method: "POST", body: "x" };
    await apiFetch("/api/sessions", init);
    expect(fetchSpy).toHaveBeenCalledWith("/alpha/api/sessions", init);
  });

  it("prefixApiPath is a pure helper", async () => {
    const { prefixApiPath } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    expect(prefixApiPath("/api/foo")).toBe("/alpha/api/foo");
    expect(prefixApiPath("relative/path")).toBe("relative/path");
    expect(prefixApiPath("https://x/y")).toBe("https://x/y");
  });

  it("prefixApiPath is idempotent (no double-prefixing)", async () => {
    const { prefixApiPath } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    // Already-prefixed input passes through unchanged.
    expect(prefixApiPath("/alpha/api/foo")).toBe("/alpha/api/foo");
    // Exact match of the base passes through unchanged.
    expect(prefixApiPath("/alpha")).toBe("/alpha");
    // A path that merely shares a prefix-substring (no `/` boundary) is
    // NOT considered prefixed and must still be prefixed.
    expect(prefixApiPath("/alphabet")).toBe("/alpha/alphabet");
  });

  // Integration-shaped regression test for Phase 3: this is the test that
  // would have caught the original sweep gap. A session lifecycle call goes
  // through `apiFetch` and must hit `/{basePath}/api/...`, not the bare path.
  it("session lifecycle calls prepend basePath under /alpha", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "/alpha" });
    window.__RDV_BASE_PATH__ = "/alpha";
    await apiFetch("/api/sessions/123/suspend", { method: "POST" });
    expect(fetchSpy).toHaveBeenCalledWith("/alpha/api/sessions/123/suspend", {
      method: "POST",
    });
  });

  it("session lifecycle calls are unchanged when basePath is empty", async () => {
    const { apiFetch } = await loadApiFetch({ RDV_BASE_PATH: "" });
    window.__RDV_BASE_PATH__ = "";
    await apiFetch("/api/sessions/123/suspend", { method: "POST" });
    expect(fetchSpy).toHaveBeenCalledWith("/api/sessions/123/suspend", {
      method: "POST",
    });
  });
});
