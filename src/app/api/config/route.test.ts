// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";

const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;
const ORIGINAL_INSTANCE_SLUG = process.env.RDV_INSTANCE_SLUG;
const ORIGINAL_PACKAGE_VERSION = process.env.npm_package_version;

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

async function loadRoute(env: {
  RDV_BASE_PATH?: string;
  RDV_INSTANCE_SLUG?: string;
  npm_package_version?: string;
}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("./route");
}

describe("GET /api/config", () => {
  beforeEach(() => {
    vi.mocked(getAuthSession).mockReset();
    vi.mocked(ApiKeyService.validateApiKey).mockReset();
  });

  afterEach(() => {
    restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
    restoreEnv("RDV_INSTANCE_SLUG", ORIGINAL_INSTANCE_SLUG);
    restoreEnv("npm_package_version", ORIGINAL_PACKAGE_VERSION);
    vi.resetModules();
  });

  it("returns 401 when there is no session and no API key", async () => {
    vi.mocked(getAuthSession).mockResolvedValue(null);

    const { GET } = await loadRoute({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "",
      npm_package_version: "0.3.18",
    });
    const response = await GET(new Request("http://localhost/api/config"));
    expect(response.status).toBe(401);
  });

  it("returns config for an authenticated session", async () => {
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-1" },
    } as unknown as Awaited<ReturnType<typeof getAuthSession>>);

    const { GET } = await loadRoute({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "alpha",
      npm_package_version: "0.3.18",
    });
    const response = await GET(new Request("http://localhost/alpha/api/config"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      basePath: "/alpha",
      instanceSlug: "alpha",
      version: "0.3.18",
    });
  });

  it("returns empty basePath and slug when env is unset", async () => {
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-1" },
    } as unknown as Awaited<ReturnType<typeof getAuthSession>>);

    const { GET } = await loadRoute({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "",
      npm_package_version: "0.3.18",
    });
    const response = await GET(new Request("http://localhost/api/config"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      basePath: "",
      instanceSlug: "",
      version: "0.3.18",
    });
  });

  it("returns config for a valid API key (Bearer auth)", async () => {
    vi.mocked(getAuthSession).mockResolvedValue(null);
    vi.mocked(ApiKeyService.validateApiKey).mockResolvedValue({
      keyId: "key-1",
      userId: "user-1",
    } as unknown as Awaited<ReturnType<typeof ApiKeyService.validateApiKey>>);

    const { GET } = await loadRoute({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "alpha",
      npm_package_version: "0.3.18",
    });
    const response = await GET(
      new Request("http://localhost/alpha/api/config", {
        headers: { authorization: "Bearer test-key" },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      basePath: "/alpha",
      instanceSlug: "alpha",
    });
  });

  it("falls back to 'unknown' when npm_package_version is missing", async () => {
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-1" },
    } as unknown as Awaited<ReturnType<typeof getAuthSession>>);

    const { GET } = await loadRoute({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "",
      npm_package_version: undefined,
    });
    const response = await GET(new Request("http://localhost/api/config"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: "unknown",
    });
  });
});
