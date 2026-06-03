import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the CNPG database-per-instance bootstrap (Unit 8).
 *
 * `pg` is mocked so no real Postgres is needed (the DDL is exercised against a
 * real container separately in the docker validation step). The k8s core client
 * is a plain fake exposing only `readNamespacedSecret`.
 */

// ── Mock `pg` ────────────────────────────────────────────────────────────────
// A recording fake Client: captures every query (text + values), lets a test
// stage `pg_database` existence, and tracks connect/end ordering. Created via
// vi.hoisted so the hoisted vi.mock factory can reference the shared state.
interface RecordedQuery {
  text: string;
  values?: unknown[];
}

const { pgState } = vi.hoisted(() => ({
  pgState: {
    queries: [] as RecordedQuery[],
    connected: false,
    ended: false,
    /** rowCount the next `SELECT 1 FROM pg_database` should report. */
    dbExists: false,
    /** When set, connect() rejects with this error. */
    connectError: null as Error | null,
  },
}));

vi.mock("pg", () => {
  class FakeClient {
    constructor(public readonly config: unknown) {}
    escapeIdentifier(id: string): string {
      return `"${id.replace(/"/g, '""')}"`;
    }
    escapeLiteral(s: string): string {
      return `'${s.replace(/'/g, "''")}'`;
    }
    async connect(): Promise<void> {
      if (pgState.connectError) throw pgState.connectError;
      pgState.connected = true;
    }
    async query(
      text: string,
      values?: unknown[],
    ): Promise<{ rowCount: number; rows: unknown[] }> {
      pgState.queries.push({ text, values });
      if (/FROM\s+pg_database/i.test(text)) {
        return pgState.dbExists
          ? { rowCount: 1, rows: [{ "?column?": 1 }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    async end(): Promise<void> {
      pgState.ended = true;
    }
  }
  return { Client: FakeClient };
});

import { bootstrapInstanceDatabase, instanceDbName } from "@/lib/instance-db";

// ── Fake k8s core client ─────────────────────────────────────────────────────
function makeClients(passwordPlaintext = "super-secret-pw") {
  const readNamespacedSecret = vi.fn(async () => ({
    data: { password: Buffer.from(passwordPlaintext, "utf8").toString("base64") },
  }));
  return {
    clients: { core: { readNamespacedSecret } } as never,
    readNamespacedSecret,
  };
}

const CNPG_ENV = {
  CNPG_CLUSTER_NAME: "rdv-pg",
  CNPG_RW_HOST: "rdv-pg-rw.cnpg-clusters.svc.cluster.local",
  CNPG_POOLER_HOST: "pooler-rdv-pg-rw.cnpg-clusters.svc.cluster.local",
  CNPG_POOLER_PORT: "5432",
  CNPG_SUPERUSER_SECRET_NAME: "rdv-pg-superuser",
  CNPG_SUPERUSER_SECRET_NAMESPACE: "cnpg-clusters",
};

const SAVED: Record<string, string | undefined> = {};
const ALL_KEYS = [
  ...Object.keys(CNPG_ENV),
  "CNPG_CLUSTER_NAMESPACE",
  "CNPG_DDL_SSL",
];

function setCnpgEnv(over: Partial<typeof CNPG_ENV> = {}): void {
  for (const [k, v] of Object.entries({ ...CNPG_ENV, ...over })) {
    process.env[k] = v;
  }
}

beforeEach(() => {
  for (const k of ALL_KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
  pgState.queries = [];
  pgState.connected = false;
  pgState.ended = false;
  pgState.dbExists = false;
  pgState.connectError = null;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ALL_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("instanceDbName", () => {
  it("prefixes rdv_ and normalizes dashes to underscores", () => {
    expect(instanceDbName("alpha")).toBe("rdv_alpha");
    expect(instanceDbName("my-cool-instance")).toBe("rdv_my_cool_instance");
  });
});

describe("bootstrapInstanceDatabase — SQLite path (no CNPG)", () => {
  it("returns null and is a complete no-op when CNPG_CLUSTER_NAME is unset", async () => {
    const { clients, readNamespacedSecret } = makeClients();
    const result = await bootstrapInstanceDatabase("alpha", clients);
    expect(result).toBeNull();
    // Never touched k8s or pg.
    expect(readNamespacedSecret).not.toHaveBeenCalled();
    expect(pgState.connected).toBe(false);
    expect(pgState.queries).toHaveLength(0);
  });
});

describe("bootstrapInstanceDatabase — Postgres path", () => {
  it("reads the superuser secret, connects to the RW host, and returns a strong role password", async () => {
    setCnpgEnv();
    const { clients, readNamespacedSecret } = makeClients();
    const password = await bootstrapInstanceDatabase("alpha", clients);

    expect(typeof password).toBe("string");
    expect(password!.length).toBeGreaterThan(20);
    expect(readNamespacedSecret).toHaveBeenCalledWith({
      name: "rdv-pg-superuser",
      namespace: "cnpg-clusters",
    });
    expect(pgState.connected).toBe(true);
    expect(pgState.ended).toBe(true);
  });

  it("issues CREATE ROLE (guarded) + CREATE DATABASE (when absent) + GRANT, with escaped identifiers", async () => {
    setCnpgEnv();
    const { clients } = makeClients();
    await bootstrapInstanceDatabase("my-app", clients);

    const all = pgState.queries.map((q) => q.text).join("\n---\n");
    // CREATE ROLE is guarded by a pg_roles check inside a DO block and uses
    // format(%I, %L) so the identifier is escaped and the password is a literal.
    // A DO block takes NO bind params, so the role name is an escaped literal.
    expect(all).toMatch(/pg_roles WHERE rolname = 'rdv_my_app'/);
    expect(all).toMatch(/CREATE ROLE %I WITH LOGIN PASSWORD %L/);
    // The password rides into format(%L) as an escaped literal — never an
    // identifier, never a bare interpolation. The role-creation DO block carries
    // no bind values.
    const roleQuery = pgState.queries.find((q) => /CREATE ROLE %I/.test(q.text));
    expect(roleQuery?.values).toBeUndefined();
    // The escaped role-name literal appears in the format() call args.
    expect(roleQuery?.text).toMatch(/format\('CREATE ROLE %I WITH LOGIN PASSWORD %L', 'rdv_my_app', '.+'\)/);

    // CREATE DATABASE uses the escaped identifier (dashes normalized to _).
    const createDb = pgState.queries.find((q) => /^CREATE DATABASE/.test(q.text));
    expect(createDb?.text).toBe('CREATE DATABASE "rdv_my_app" OWNER "rdv_my_app"');

    // GRANT CONNECT on the database to the role.
    const grant = pgState.queries.find((q) => /^GRANT CONNECT/.test(q.text));
    expect(grant?.text).toBe('GRANT CONNECT ON DATABASE "rdv_my_app" TO "rdv_my_app"');
  });

  it("is idempotent: skips CREATE DATABASE when pg_database already has the row", async () => {
    setCnpgEnv();
    pgState.dbExists = true; // simulate an existing database
    const { clients } = makeClients();
    await expect(bootstrapInstanceDatabase("alpha", clients)).resolves.toBeTruthy();

    // The pg_database guard ran, but no CREATE DATABASE was issued.
    expect(pgState.queries.some((q) => /FROM\s+pg_database/i.test(q.text))).toBe(true);
    expect(pgState.queries.some((q) => /^CREATE DATABASE/.test(q.text))).toBe(false);
    // CREATE ROLE (guarded) + GRANT still ran (idempotent re-run, no throw).
    expect(pgState.queries.some((q) => /CREATE ROLE %I/.test(q.text))).toBe(true);
    expect(pgState.queries.some((q) => /^GRANT CONNECT/.test(q.text))).toBe(true);
  });

  it("delivers the role password ONLY as an escaped %L literal and never leaks the superuser password into DDL", async () => {
    setCnpgEnv();
    const { clients } = makeClients("the-super-secret");
    const password = await bootstrapInstanceDatabase("alpha", clients);
    const allText = pgState.queries.map((q) => q.text).join("\n");
    // The superuser password is used ONLY to authenticate the connection — it
    // must never appear in any issued DDL.
    expect(allText).not.toContain("the-super-secret");
    // The generated role password appears ONLY inside the role-creation DO block,
    // wrapped as an escaped SQL literal ('...') passed to format(%L) — never as a
    // bare/identifier interpolation.
    const roleQuery = pgState.queries.find((q) => /CREATE ROLE %I/.test(q.text));
    expect(roleQuery?.text).toContain(`'${password}'`);
    // No OTHER query (CREATE DATABASE / GRANT / pg_database guard) contains it.
    const otherText = pgState.queries
      .filter((q) => !/CREATE ROLE %I/.test(q.text))
      .map((q) => q.text)
      .join("\n");
    expect(otherText).not.toContain(password!);
  });

  it("closes the pg client even when the DDL throws (finally)", async () => {
    setCnpgEnv();
    pgState.connectError = new Error("connection refused");
    const { clients } = makeClients();
    await expect(bootstrapInstanceDatabase("alpha", clients)).rejects.toThrow(
      "connection refused",
    );
    expect(pgState.ended).toBe(true);
  });

  it("throws a clear error when the superuser secret has no password key", async () => {
    setCnpgEnv();
    const readNamespacedSecret = vi.fn(async () => ({ data: {} }));
    const clients = { core: { readNamespacedSecret } } as never;
    await expect(bootstrapInstanceDatabase("alpha", clients)).rejects.toThrow(/password/);
  });

  it("throws when CNPG_CLUSTER_NAME is set but CNPG_RW_HOST is missing", async () => {
    setCnpgEnv({ CNPG_RW_HOST: undefined as unknown as string });
    delete process.env.CNPG_RW_HOST;
    const { clients } = makeClients();
    await expect(bootstrapInstanceDatabase("alpha", clients)).rejects.toThrow(/CNPG_RW_HOST/);
  });
});
