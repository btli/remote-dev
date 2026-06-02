/**
 * Tests for `src/lib/runtime-env.ts` — the proxy runtime-env bridge.
 *
 * The module reads `process.env` live (no module-load caching), so unlike
 * base-path/auth-cookies these tests don't need `vi.resetModules()`; they just
 * mutate `process.env` and `globalThis.__RDV_RUNTIME_ENV` directly.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  RUNTIME_ENV_KEYS,
  captureRuntimeEnv,
  runtimeEnv,
} from "../runtime-env";

const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of RUNTIME_ENV_KEYS) SAVED[key] = process.env[key];
});

afterEach(() => {
  for (const key of RUNTIME_ENV_KEYS) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key]!;
  }
  delete globalThis.__RDV_RUNTIME_ENV;
});

describe("runtimeEnv", () => {
  it("prefers a populated process.env value over the global snapshot", () => {
    process.env.AUTH_SECRET = "from-process";
    globalThis.__RDV_RUNTIME_ENV = { AUTH_SECRET: "from-global" };
    expect(runtimeEnv("AUTH_SECRET")).toBe("from-process");
  });

  it("falls back to the global snapshot when process.env is undefined", () => {
    delete process.env.AUTH_SECRET;
    globalThis.__RDV_RUNTIME_ENV = { AUTH_SECRET: "from-global" };
    expect(runtimeEnv("AUTH_SECRET")).toBe("from-global");
  });

  it("falls back to the global snapshot when process.env is empty string", () => {
    // The empty-string case is the crux of the standalone-middleware bug: the
    // proxy saw "" (not undefined) for AUTH_SECRET. Treat "" as absent.
    process.env.AUTH_SECRET = "";
    globalThis.__RDV_RUNTIME_ENV = { AUTH_SECRET: "from-global" };
    expect(runtimeEnv("AUTH_SECRET")).toBe("from-global");
  });

  it("returns undefined when neither source has a value", () => {
    delete process.env.AUTH_SECRET;
    delete globalThis.__RDV_RUNTIME_ENV;
    expect(runtimeEnv("AUTH_SECRET")).toBeUndefined();
  });

  it("returns undefined when process.env is empty and no global is set", () => {
    process.env.AUTH_SECRET = "";
    delete globalThis.__RDV_RUNTIME_ENV;
    // Identical to a bare process.env read of an unset var — preserves AC-1.
    expect(runtimeEnv("AUTH_SECRET")).toBeUndefined();
  });
});

describe("captureRuntimeEnv", () => {
  it("snapshots non-empty runtime-env keys into globalThis", () => {
    process.env.AUTH_SECRET = "s3cr3t";
    process.env.AUTH_URL = "https://host/dev";
    process.env.RDV_INSTANCE_SLUG = "dev";
    delete process.env.NEXTAUTH_URL;

    captureRuntimeEnv();

    expect(globalThis.__RDV_RUNTIME_ENV).toEqual({
      AUTH_SECRET: "s3cr3t",
      AUTH_URL: "https://host/dev",
      RDV_INSTANCE_SLUG: "dev",
    });
    // NEXTAUTH_URL was unset → omitted (not stored as undefined/"").
    expect(globalThis.__RDV_RUNTIME_ENV).not.toHaveProperty("NEXTAUTH_URL");
  });

  it("omits empty-string values so they don't shadow a later real value", () => {
    process.env.AUTH_SECRET = "";
    process.env.AUTH_URL = "https://host/dev";
    captureRuntimeEnv();
    expect(globalThis.__RDV_RUNTIME_ENV).not.toHaveProperty("AUTH_SECRET");
    expect(globalThis.__RDV_RUNTIME_ENV?.AUTH_URL).toBe("https://host/dev");
  });

  it("captured snapshot then powers runtimeEnv fallback after process.env is cleared", () => {
    // End-to-end of the production timeline: capture at startup (env present),
    // then the proxy reads with process.env emptied (standalone middleware).
    process.env.AUTH_SECRET = "startup-secret";
    process.env.AUTH_URL = "https://host/dev";
    process.env.RDV_INSTANCE_SLUG = "dev";
    captureRuntimeEnv();

    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_URL;
    delete process.env.RDV_INSTANCE_SLUG;

    expect(runtimeEnv("AUTH_SECRET")).toBe("startup-secret");
    expect(runtimeEnv("AUTH_URL")).toBe("https://host/dev");
    expect(runtimeEnv("RDV_INSTANCE_SLUG")).toBe("dev");
  });

  it("is idempotent — a second capture overwrites with the current env", () => {
    process.env.AUTH_SECRET = "first";
    captureRuntimeEnv();
    expect(runtimeEnv("AUTH_SECRET")).toBe("first");

    process.env.AUTH_SECRET = "second";
    captureRuntimeEnv();
    // process.env wins here anyway, but assert the snapshot also updated by
    // clearing process.env afterward.
    delete process.env.AUTH_SECRET;
    expect(runtimeEnv("AUTH_SECRET")).toBe("second");
  });
});
