import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

// --- Mocks -----------------------------------------------------------------
// Control the CF Access layer and the DB user resolution so the auth wrapper
// can be exercised without a cluster or a database.

const cfState: { configured: boolean; email: string | null } = {
  configured: false,
  email: null,
};

vi.mock("@/lib/cf-access", () => ({
  isCfAccessConfigured: () => cfState.configured,
  getAccessToken: () => "test-token",
  validateAccessJWT: async () =>
    cfState.email ? { email: cfState.email, sub: "sub-1" } : null,
}));

// DB seam: `existingUser` models a row already present in the table.
//   - findFirst returns it (or undefined for first-sight).
//   - the upsert (insert ... onConflictDoUpdate) is modelled faithfully: if a
//     row already exists for the email, RETURNING yields the EXISTING row
//     (role preserved — the C2 invariant), otherwise the freshly-inserted row.
//   - `inserted` captures the VALUES the insert was called with, so tests can
//     assert what role the insert *attempted* and that no clobber occurred.
//   - `returningEmpty` forces RETURNING to come back empty so the defensive
//     re-query path is exercised.
type UserRow = { id: string; email: string; role: Role };
const dbState: {
  existingUser: UserRow | undefined;
  inserted: UserRow | null;
  returningEmpty: boolean;
} = {
  existingUser: undefined,
  inserted: null,
  returningEmpty: false,
};

vi.mock("@/db", () => ({
  db: {
    query: {
      supervisorUser: {
        findFirst: async () => dbState.existingUser,
      },
    },
    insert: () => ({
      values: (vals: { email: string; role: Role }) => {
        const attempted: UserRow = {
          id: `id-${vals.email}`,
          email: vals.email,
          role: vals.role,
        };
        dbState.inserted = attempted;
        const resolveRow = () => {
          if (dbState.returningEmpty) return [] as UserRow[];
          // Conflict: preserve the existing row (role NOT clobbered).
          if (dbState.existingUser) return [dbState.existingUser];
          return [attempted];
        };
        return {
          returning: async () => resolveRow(),
          onConflictDoUpdate: () => ({
            returning: async () => resolveRow(),
          }),
        };
      },
    }),
  },
}));

// Import AFTER mocks are registered.
import {
  withSupervisorAuth,
  resolveAuthenticatedEmail,
  resolveSupervisorUser,
} from "@/lib/auth";

function req(): Request {
  return new Request("https://sup.example.com/api/test");
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined): void {
  // NODE_ENV is readonly in the Node typings; assign through a cast.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  cfState.configured = false;
  cfState.email = null;
  dbState.existingUser = undefined;
  dbState.inserted = null;
  dbState.returningEmpty = false;
  delete process.env.SUPERVISOR_ADMIN_EMAIL;
  delete process.env.SUPERVISOR_ALLOW_INSECURE_AUTH;
  setNodeEnv(ORIGINAL_NODE_ENV);
});

describe("withSupervisorAuth — unauthenticated (401)", () => {
  it("401 when no CF Access and no SUPERVISOR_ADMIN_EMAIL", async () => {
    const handler = withSupervisorAuth(
      "viewer",
      async () => Response.json({ ok: true }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("401 in prod when CF token does not validate", async () => {
    cfState.configured = true;
    cfState.email = null; // token invalid
    const handler = withSupervisorAuth(
      "viewer",
      async () => Response.json({ ok: true }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(401);
  });
});

describe("withSupervisorAuth — local dev admin seeding", () => {
  it("seeds SUPERVISOR_ADMIN_EMAIL as admin and allows admin-gated routes", async () => {
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
    dbState.existingUser = undefined; // first sight → insert

    const handler = withSupervisorAuth(
      "admin",
      async (_r, { user }) =>
        Response.json({ email: user.email, role: user.role }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("boss@example.com");
    expect(body.role).toBe("admin");
    expect(dbState.inserted?.role).toBe("admin");
  });

  it("a non-admin email seen for the first time is seeded as viewer", async () => {
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
    cfState.configured = true;
    cfState.email = "newcomer@example.com";
    dbState.existingUser = undefined;

    const handler = withSupervisorAuth(
      "viewer",
      async (_r, { user }) => Response.json({ role: user.role }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(dbState.inserted?.role).toBe("viewer");
  });
});

describe("withSupervisorAuth — role gate (403)", () => {
  it("403 when a viewer hits an operator-gated route", async () => {
    cfState.configured = true;
    cfState.email = "viewer@example.com";
    dbState.existingUser = {
      id: "id-viewer",
      email: "viewer@example.com",
      role: "viewer",
    };

    const handler = withSupervisorAuth(
      "operator",
      async () => Response.json({ ok: true }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("allows when the user meets the required role", async () => {
    cfState.configured = true;
    cfState.email = "op@example.com";
    dbState.existingUser = {
      id: "id-op",
      email: "op@example.com",
      role: "operator",
    };

    const handler = withSupervisorAuth(
      "viewer",
      async (_r, { user }) => Response.json({ id: user.id }) as never,
    );
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("id-op");
  });
});

describe("resolveAuthenticatedEmail — production fail-closed (C1)", () => {
  it("returns null in production when CF Access is NOT configured (no admin-email fallback)", async () => {
    setNodeEnv("production");
    cfState.configured = false;
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";

    expect(await resolveAuthenticatedEmail(req())).toBeNull();
  });

  it("the SUPERVISOR_ALLOW_INSECURE_AUTH=1 escape hatch re-enables the fallback in prod", async () => {
    setNodeEnv("production");
    cfState.configured = false;
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
    process.env.SUPERVISOR_ALLOW_INSECURE_AUTH = "1";

    expect(await resolveAuthenticatedEmail(req())).toBe("boss@example.com");
  });

  it("still trusts the admin-email fallback in non-production (dev)", async () => {
    setNodeEnv("development");
    cfState.configured = false;
    process.env.SUPERVISOR_ADMIN_EMAIL = "dev@example.com";

    expect(await resolveAuthenticatedEmail(req())).toBe("dev@example.com");
  });

  it("uses the validated CF email in production when CF Access IS configured", async () => {
    setNodeEnv("production");
    cfState.configured = true;
    cfState.email = "cf@example.com";

    expect(await resolveAuthenticatedEmail(req())).toBe("cf@example.com");
  });
});

describe("resolveSupervisorUser — idempotent upsert (C2)", () => {
  it("a racing insert does NOT downgrade an existing admin (role preserved)", async () => {
    // The email is the configured admin, but a concurrent request already
    // created the row as admin. Our insert would compute role=admin here, but
    // the invariant is: even if it computed viewer, the existing role wins.
    process.env.SUPERVISOR_ADMIN_EMAIL = "other@example.com"; // so computed role = viewer
    dbState.existingUser = {
      id: "id-admin",
      email: "admin@example.com",
      role: "admin",
    };
    // Force the first-sight path (findFirst miss) then conflict on insert.
    const findFirstSpy = vi
      .spyOn(
        (await import("@/db")).db.query.supervisorUser,
        "findFirst",
      )
      .mockResolvedValueOnce(undefined as never);

    const resolved = await resolveSupervisorUser("admin@example.com");
    expect(resolved.role).toBe("admin"); // NOT downgraded to viewer
    // The insert attempted role=viewer (computed), proving the preserve came
    // from the conflict path, not the computed value.
    expect(dbState.inserted?.role).toBe("viewer");
    findFirstSpy.mockRestore();
  });

  it("returns the existing row on the no-RETURNING defensive path", async () => {
    dbState.existingUser = {
      id: "id-x",
      email: "x@example.com",
      role: "operator",
    };
    dbState.returningEmpty = true; // force empty RETURNING → re-query
    const db = (await import("@/db")).db;
    const findFirstSpy = vi
      .spyOn(db.query.supervisorUser, "findFirst")
      // first call (initial findFirst) misses; re-query returns the row.
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(dbState.existingUser as never);

    const resolved = await resolveSupervisorUser("x@example.com");
    expect(resolved.role).toBe("operator");
    findFirstSpy.mockRestore();
  });

  it("returns the existing row immediately when findFirst hits (no insert)", async () => {
    dbState.existingUser = {
      id: "id-hit",
      email: "hit@example.com",
      role: "viewer",
    };
    const resolved = await resolveSupervisorUser("hit@example.com");
    expect(resolved.id).toBe("id-hit");
    expect(dbState.inserted).toBeNull(); // never attempted an insert
  });
});
