/**
 * Tests for `src/lib/base-path.ts`.
 *
 * The module reads `process.env.RDV_BASE_PATH` once at load. To exercise
 * multiple env states we must clear vitest's module cache (`vi.resetModules`)
 * and re-`import()` the module after each env mutation. Static imports of
 * `../base-path` at the top of this file would freeze the first env state
 * and defeat the test, so we use dynamic imports throughout.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;
const ORIGINAL_INSTANCE_SLUG = process.env.RDV_INSTANCE_SLUG;

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

async function loadBasePath(env: {
  RDV_BASE_PATH?: string;
  RDV_INSTANCE_SLUG?: string;
}): Promise<typeof import("../base-path")> {
  vi.resetModules();
  // Set/clear env before re-import so the module's top-level reads pick it up.
  if ("RDV_BASE_PATH" in env) {
    if (env.RDV_BASE_PATH === undefined) delete process.env.RDV_BASE_PATH;
    else process.env.RDV_BASE_PATH = env.RDV_BASE_PATH;
  }
  if ("RDV_INSTANCE_SLUG" in env) {
    if (env.RDV_INSTANCE_SLUG === undefined) delete process.env.RDV_INSTANCE_SLUG;
    else process.env.RDV_INSTANCE_SLUG = env.RDV_INSTANCE_SLUG;
  }
  return await import("../base-path");
}

describe("base-path module", () => {
  afterEach(() => {
    restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
    restoreEnv("RDV_INSTANCE_SLUG", ORIGINAL_INSTANCE_SLUG);
    vi.resetModules();
  });

  it("empty RDV_BASE_PATH yields empty BASE_PATH and empty slug", async () => {
    const mod = await loadBasePath({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
    });
    expect(mod.BASE_PATH).toBe("");
    expect(mod.INSTANCE_SLUG).toBe("");
    expect(mod.COOKIE_PATH).toBe("/");
    expect(mod.WS_PATH_PREFIX).toBe("/ws");
  });

  it("single-segment prefix /alpha derives slug + paths", async () => {
    const mod = await loadBasePath({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
    });
    expect(mod.BASE_PATH).toBe("/alpha");
    expect(mod.INSTANCE_SLUG).toBe("alpha");
    expect(mod.COOKIE_PATH).toBe("/alpha");
    expect(mod.WS_PATH_PREFIX).toBe("/alpha/ws");
  });

  it("nested prefix /x/y derives slug as last segment", async () => {
    const mod = await loadBasePath({
      RDV_BASE_PATH: "/x/y",
      RDV_INSTANCE_SLUG: undefined,
    });
    expect(mod.BASE_PATH).toBe("/x/y");
    expect(mod.INSTANCE_SLUG).toBe("y");
    expect(mod.COOKIE_PATH).toBe("/x/y");
    expect(mod.WS_PATH_PREFIX).toBe("/x/y/ws");
  });

  it("explicit RDV_INSTANCE_SLUG overrides derived slug", async () => {
    const mod = await loadBasePath({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "custom-slug",
    });
    expect(mod.BASE_PATH).toBe("/alpha");
    expect(mod.INSTANCE_SLUG).toBe("custom-slug");
  });

  it("derives slug from BASE_PATH last segment when RDV_INSTANCE_SLUG is absent (standalone proxy)", async () => {
    // The Next standalone proxy realm has no runtime process.env.RDV_INSTANCE_SLUG
    // but DOES have BASE_PATH (build-inlined via the /rdvslug sentinel), so the
    // derive below covers it.
    const mod = await loadBasePath({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
    });
    expect(mod.INSTANCE_SLUG).toBe("alpha");
  });

  it("falls through to the derive when RDV_INSTANCE_SLUG is an empty string (|| guard)", async () => {
    // We use `||` not `??` so an explicitly-empty slug doesn't pin INSTANCE_SLUG
    // to "" — it falls back to the BASE_PATH last-segment derive.
    const mod = await loadBasePath({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "",
    });
    expect(mod.INSTANCE_SLUG).toBe("alpha");
  });

  it("rejects malformed prefix missing leading slash", async () => {
    await expect(
      loadBasePath({ RDV_BASE_PATH: "alpha", RDV_INSTANCE_SLUG: undefined }),
    ).rejects.toThrow(/Invalid RDV_BASE_PATH/);
  });

  it("rejects malformed prefix with trailing slash", async () => {
    await expect(
      loadBasePath({ RDV_BASE_PATH: "/alpha/", RDV_INSTANCE_SLUG: undefined }),
    ).rejects.toThrow(/Invalid RDV_BASE_PATH/);
  });

  it("rejects malformed prefix with double slash", async () => {
    await expect(
      loadBasePath({ RDV_BASE_PATH: "//alpha", RDV_INSTANCE_SLUG: undefined }),
    ).rejects.toThrow(/Invalid RDV_BASE_PATH/);
  });

  it("rejects prefix with uppercase characters", async () => {
    await expect(
      loadBasePath({ RDV_BASE_PATH: "/Alpha", RDV_INSTANCE_SLUG: undefined }),
    ).rejects.toThrow(/Invalid RDV_BASE_PATH/);
  });

  it("rejects prefix with underscore", async () => {
    await expect(
      loadBasePath({ RDV_BASE_PATH: "/a_b", RDV_INSTANCE_SLUG: undefined }),
    ).rejects.toThrow(/Invalid RDV_BASE_PATH/);
  });

  describe("prefixPath helper", () => {
    it("returns input unchanged when BASE_PATH is empty", async () => {
      const mod = await loadBasePath({
        RDV_BASE_PATH: "",
        RDV_INSTANCE_SLUG: undefined,
      });
      expect(mod.prefixPath("/api/foo")).toBe("/api/foo");
      expect(mod.prefixPath("/")).toBe("/");
    });

    it("prepends BASE_PATH to absolute paths", async () => {
      const mod = await loadBasePath({
        RDV_BASE_PATH: "/alpha",
        RDV_INSTANCE_SLUG: undefined,
      });
      expect(mod.prefixPath("/api/foo")).toBe("/alpha/api/foo");
      expect(mod.prefixPath("/login")).toBe("/alpha/login");
    });

    it("collapses root '/' to BASE_PATH itself (no trailing slash)", async () => {
      const mod = await loadBasePath({
        RDV_BASE_PATH: "/alpha",
        RDV_INSTANCE_SLUG: undefined,
      });
      expect(mod.prefixPath("/")).toBe("/alpha");
    });

    it("leaves non-absolute inputs alone", async () => {
      const mod = await loadBasePath({
        RDV_BASE_PATH: "/alpha",
        RDV_INSTANCE_SLUG: undefined,
      });
      expect(mod.prefixPath("api/foo")).toBe("api/foo");
      expect(mod.prefixPath("https://example.com/foo")).toBe(
        "https://example.com/foo",
      );
      expect(mod.prefixPath("")).toBe("");
    });
  });
});
