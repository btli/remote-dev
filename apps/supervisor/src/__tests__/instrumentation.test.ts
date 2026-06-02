import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fail-closed startup guard (now OIDC-aware) + migrate-on-boot ordering.
 *
 * `register()` must `process.exit(1)` in production when NEITHER Cloudflare
 * Access NOR native OIDC is configured, and must NOT exit when at least one is
 * configured. It must also run migrations before the admin seed.
 *
 * We mock the migrate + db + schema seams so the function runs without a real
 * database, and spy on `process.exit` (made to throw a sentinel so execution
 * halts exactly as a real exit would).
 */

const migrateState = { calls: 0 };
vi.mock("@/db/migrate", () => ({
  runMigrations: async () => {
    migrateState.calls += 1;
  },
}));

// A fake db whose admin lookup returns an existing admin row → the seed path is
// a benign no-op (no insert/update). `findFirst` records that migrate ran first.
const order: string[] = [];
vi.mock("@/db", () => ({
  db: {
    query: {
      supervisorUser: {
        findFirst: async () => {
          order.push("seed-query");
          return { id: "a1", email: "boss@example.com", role: "admin" };
        },
      },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  supervisorUser: { email: "email", id: "id" },
}));

import { register } from "@/instrumentation";

class ExitSignal extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

const OIDC_KEYS = [
  "SUPERVISOR_OIDC_ISSUER",
  "SUPERVISOR_OIDC_CLIENT_ID",
  "SUPERVISOR_OIDC_CLIENT_SECRET",
] as const;

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  migrateState.calls = 0;
  order.length = 0;
  process.env.NEXT_RUNTIME = "nodejs";
  delete process.env.SUPERVISOR_CF_ACCESS_AUD;
  delete process.env.SUPERVISOR_CF_ACCESS_TEAM;
  for (const k of OIDC_KEYS) delete process.env[k];
  delete process.env.AUTH_SECRET;
  delete process.env.SUPERVISOR_ALLOW_INSECURE_AUTH;
  process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code);
  }) as never);
});

afterEach(() => {
  exitSpy.mockRestore();
  setNodeEnv(ORIGINAL_NODE_ENV);
  delete process.env.NEXT_RUNTIME;
});

describe("supervisor instrumentation — fail-closed (OIDC-aware)", () => {
  it("exits in production when NEITHER CF Access NOR OIDC is configured", async () => {
    setNodeEnv("production");
    await expect(register()).rejects.toBeInstanceOf(ExitSignal);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(migrateState.calls).toBe(0); // guard trips before migrate
  });

  it("does NOT exit in production when ONLY OIDC is configured", async () => {
    setNodeEnv("production");
    process.env.SUPERVISOR_OIDC_ISSUER = "https://idp.example.com";
    process.env.SUPERVISOR_OIDC_CLIENT_ID = "client-123";
    process.env.SUPERVISOR_OIDC_CLIENT_SECRET = "secret-xyz";
    process.env.AUTH_SECRET = "auth-secret";

    await register();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(migrateState.calls).toBe(1);
  });

  it("does NOT exit in production when ONLY CF Access is configured", async () => {
    setNodeEnv("production");
    process.env.SUPERVISOR_CF_ACCESS_AUD = "aud-123";
    process.env.SUPERVISOR_CF_ACCESS_TEAM = "team-x";

    await register();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(migrateState.calls).toBe(1);
  });

  it("does NOT exit in development even with no auth configured", async () => {
    setNodeEnv("development");
    await register();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("runs migrate-on-boot BEFORE the admin seed", async () => {
    setNodeEnv("development");
    await register();
    expect(migrateState.calls).toBe(1);
    // migrate ran, then the seed queried the admin row.
    expect(order).toEqual(["seed-query"]);
  });
});
