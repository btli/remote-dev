// @vitest-environment node
/**
 * Tests for the multi-email identity resolution helpers
 * (`src/lib/user-identity.ts`) and the deploy/boot backfill
 * (`src/db/backfill-user-emails.ts`).
 *
 * Rather than shallow call-assertions, these tests run the real helper logic
 * against an in-memory fake that emulates the slice of the Drizzle surface the
 * code uses (query.findFirst/findMany, insert().values().onConflictDoNothing()
 * / .returning(), and transaction()). The fake enforces the load-bearing
 * UNIQUE(email) constraint so the idempotency / race / fail-safe behavior is
 * actually exercised. `drizzle-orm`'s `eq` / `isNotNull` are mocked to emit
 * descriptor objects the fake interprets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Schema seam: column tokens the fake matches on -----------------------
// `__table` lets the insert() fake identify which table a token refers to.
// Defined inside the (hoisted) factory to satisfy vitest's mock-hoisting rules.
vi.mock("@/db/schema", () => ({
  users: { __table: "user", id: "users.id", email: "users.email" },
  userEmails: {
    __table: "user_email",
    email: "userEmails.email",
    userId: "userEmails.userId",
  },
}));

// --- drizzle-orm operators → descriptor objects the fake can read ---------
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ op: "eq", column, value }),
  isNotNull: (column: string) => ({ op: "isNotNull", column }),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// --- In-memory fake DB ----------------------------------------------------
interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
}
interface UserEmailRow {
  id: string;
  userId: string;
  email: string;
  isPrimary: boolean;
  createdAt: Date;
}

type WhereDesc =
  | { op: "eq"; column: string; value: unknown }
  | { op: "isNotNull"; column: string }
  | undefined;

let usersTable: UserRow[];
let userEmailTable: UserEmailRow[];
let idSeq: number;

function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function matchUsers(where: WhereDesc): UserRow[] {
  if (!where) return [...usersTable];
  if (where.op === "isNotNull" && where.column === "users.email") {
    return usersTable.filter((u) => u.email != null);
  }
  if (where.op === "eq" && where.column === "users.id") {
    return usersTable.filter((u) => u.id === where.value);
  }
  if (where.op === "eq" && where.column === "users.email") {
    return usersTable.filter((u) => u.email === where.value);
  }
  return [];
}

function matchUserEmails(where: WhereDesc): UserEmailRow[] {
  if (!where) return [...userEmailTable];
  if (where.op === "eq" && where.column === "userEmails.email") {
    return userEmailTable.filter((r) => r.email === where.value);
  }
  return [];
}

/**
 * Build a fake handle. `insert()` enforces UNIQUE(email) on user_email:
 * `.onConflictDoNothing()` swallows the dup; `.returning()` (used only for the
 * `user` insert) does not.
 */
function makeHandle() {
  const handle = {
    query: {
      users: {
        findFirst: async ({ where }: { where: WhereDesc }) =>
          matchUsers(where)[0],
        findMany: async ({ where }: { where: WhereDesc }) => matchUsers(where),
      },
      userEmails: {
        findFirst: async ({ where }: { where: WhereDesc }) =>
          matchUserEmails(where)[0],
        findMany: async () => [...userEmailTable],
      },
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const isUserEmail = (table as { __table?: string })?.__table === "user_email";
        const doInsert = (ignoreConflict: boolean) => {
          if (isUserEmail) {
            const email = values.email as string;
            if (userEmailTable.some((r) => r.email === email)) {
              if (ignoreConflict) return [];
              throw new Error(`UNIQUE constraint failed: user_email.email (${email})`);
            }
            const row: UserEmailRow = {
              id: (values.id as string) ?? nextId("ue"),
              userId: values.userId as string,
              email,
              isPrimary: Boolean(values.isPrimary),
              createdAt: new Date(),
            };
            userEmailTable.push(row);
            return [row];
          }
          // users insert
          const email = (values.email as string) ?? null;
          if (email != null && usersTable.some((u) => u.email === email)) {
            throw new Error(`UNIQUE constraint failed: user.email (${email})`);
          }
          const row: UserRow = {
            id: (values.id as string) ?? nextId("u"),
            email,
            name: (values.name as string) ?? null,
          };
          usersTable.push(row);
          return [row];
        };
        return {
          onConflictDoNothing: async () => doInsert(true),
          returning: async () => doInsert(false),
        };
      },
    }),
    // The fake runs the callback against the same arrays (no real isolation):
    // adequate because the helper re-reads inside the txn before inserting.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(handle),
  };
  return handle;
}

let fakeDb: ReturnType<typeof makeHandle>;

vi.mock("@/db", () => ({
  // `db` is read lazily by the SUT at call time, so a getter lets each test's
  // freshly-built fake be picked up.
  get db() {
    return fakeDb;
  },
}));

// `index` re-exports `db` for the backfill module.
vi.mock("@/db/index", () => ({
  get db() {
    return fakeDb;
  },
}));

import {
  resolveUserIdByEmail,
  getOrCreateUserByEmail,
  ensurePrimaryUserEmail,
} from "@/lib/user-identity";
import { backfillUserEmails } from "@/db/backfill-user-emails";

beforeEach(() => {
  usersTable = [];
  userEmailTable = [];
  idSeq = 0;
  fakeDb = makeHandle();
});

afterEach(() => {
  vi.clearAllMocks();
});

function seedUser(id: string, email: string | null, name: string | null = null): void {
  usersTable.push({ id, email, name });
}
function seedUserEmail(userId: string, email: string, isPrimary: boolean): void {
  userEmailTable.push({ id: nextId("ue"), userId, email, isPrimary, createdAt: new Date() });
}

describe("resolveUserIdByEmail", () => {
  it("returns the userId for a known primary email", async () => {
    seedUser("u1", "a@example.com");
    seedUserEmail("u1", "a@example.com", true);
    await expect(resolveUserIdByEmail("a@example.com")).resolves.toBe("u1");
  });

  it("resolves a SECONDARY email to the same owning user", async () => {
    seedUser("u1", "a@example.com");
    seedUserEmail("u1", "a@example.com", true);
    seedUserEmail("u1", "b@example.com", false);
    await expect(resolveUserIdByEmail("b@example.com")).resolves.toBe("u1");
  });

  it("returns null for an unknown email", async () => {
    await expect(resolveUserIdByEmail("nobody@example.com")).resolves.toBeNull();
  });
});

describe("resolveUserIdByEmail — self-healing user.email fallback (legacy/unbackfilled)", () => {
  it("resolves a legacy user (user.email but NO user_email row) and self-heals the index", async () => {
    // Simulates a row that predates the feature, or one the backfill missed:
    // a `user` with an email but no `user_email` index row.
    seedUser("legacy-1", "legacy@example.com", "Legacy");

    const userId = await resolveUserIdByEmail("legacy@example.com");

    // Resolves to the SAME user — no new account.
    expect(userId).toBe("legacy-1");
    expect(usersTable).toHaveLength(1);
    // Side effect: the missing primary user_email row was lazily created.
    expect(userEmailTable).toHaveLength(1);
    expect(userEmailTable[0]).toMatchObject({
      userId: "legacy-1",
      email: "legacy@example.com",
      isPrimary: true,
    });
  });

  it("is a no-op on a second resolution (heal already done, fast path)", async () => {
    seedUser("legacy-1", "legacy@example.com", "Legacy");

    const first = await resolveUserIdByEmail("legacy@example.com");
    const second = await resolveUserIdByEmail("legacy@example.com");

    expect(first).toBe("legacy-1");
    expect(second).toBe("legacy-1");
    // Still exactly one healed row — no duplicate from the repeat call.
    expect(userEmailTable).toHaveLength(1);
  });

  it("getOrCreateUserByEmail resolves (and heals) a legacy user instead of re-creating", async () => {
    // THE regression the security review flagged: without the fallback this
    // would attempt a create and hit the user.email UNIQUE constraint, 500-ing
    // the user during the transition. With it, the legacy user is returned.
    seedUser("legacy-1", "legacy@example.com", "Legacy");

    const user = await getOrCreateUserByEmail("legacy@example.com");

    expect(user.id).toBe("legacy-1");
    expect(user.name).toBe("Legacy");
    // No new user row, and the index row was healed (exactly one).
    expect(usersTable).toHaveLength(1);
    expect(userEmailTable).toHaveLength(1);
    expect(userEmailTable[0]).toMatchObject({
      userId: "legacy-1",
      email: "legacy@example.com",
      isPrimary: true,
    });
  });

  it("still returns null when neither user_email NOR user.email matches", async () => {
    seedUser("u1", "someone@example.com");
    seedUserEmail("u1", "someone@example.com", true);
    await expect(resolveUserIdByEmail("stranger@example.com")).resolves.toBeNull();
  });
});

describe("getOrCreateUserByEmail — CF Access / credentials resolution", () => {
  it("resolves a SECONDARY email to the EXISTING user (not a new account)", async () => {
    // Primary A + secondary B both point at u1.
    seedUser("u1", "a@example.com", "Alice");
    seedUserEmail("u1", "a@example.com", true);
    seedUserEmail("u1", "b@example.com", false);

    const user = await getOrCreateUserByEmail("b@example.com");

    expect(user.id).toBe("u1");
    expect(user.name).toBe("Alice");
    // No new user and no new email row were created.
    expect(usersTable).toHaveLength(1);
    expect(userEmailTable).toHaveLength(2);
  });

  it("creates a new user AND a primary user_email row for an unknown email", async () => {
    const user = await getOrCreateUserByEmail("new@example.com");

    expect(usersTable).toHaveLength(1);
    expect(usersTable[0].id).toBe(user.id);
    expect(usersTable[0].email).toBe("new@example.com");
    // Default name derives from the local part.
    expect(usersTable[0].name).toBe("new");

    expect(userEmailTable).toHaveLength(1);
    expect(userEmailTable[0]).toMatchObject({
      userId: user.id,
      email: "new@example.com",
      isPrimary: true,
    });
  });

  it("preserves a preset id (JWT id) when creating the missing user", async () => {
    const user = await getOrCreateUserByEmail("jwt@example.com", "JWT User", "jwt-id-123");
    expect(user.id).toBe("jwt-id-123");
    expect(usersTable[0].id).toBe("jwt-id-123");
    expect(userEmailTable[0].userId).toBe("jwt-id-123");
  });

  it("matching by user.email lookup still works post-change (resolves via index)", async () => {
    // A user whose primary email is already indexed must resolve to themselves,
    // returning the SAME id rather than minting a new account.
    seedUser("legacy-1", "legacy@example.com", "Legacy");
    seedUserEmail("legacy-1", "legacy@example.com", true);

    const user = await getOrCreateUserByEmail("legacy@example.com");
    expect(user.id).toBe("legacy-1");
    expect(usersTable).toHaveLength(1);
    expect(userEmailTable).toHaveLength(1);
  });

  it("is idempotent: a second resolve of a freshly-created email returns the same user", async () => {
    const first = await getOrCreateUserByEmail("dup@example.com");
    const second = await getOrCreateUserByEmail("dup@example.com");
    expect(second.id).toBe(first.id);
    expect(usersTable).toHaveLength(1);
    expect(userEmailTable).toHaveLength(1);
  });

  it("fails safe when the email is already claimed by another user (no reassignment)", async () => {
    // Email belongs to u1 already; a create attempt must return u1, not steal it.
    seedUser("u1", "shared@example.com", "Owner");
    seedUserEmail("u1", "shared@example.com", true);

    const user = await getOrCreateUserByEmail("shared@example.com");
    expect(user.id).toBe("u1");
    expect(userEmailTable.filter((r) => r.email === "shared@example.com")).toHaveLength(1);
  });
});

describe("ensurePrimaryUserEmail — adapter createUser seam", () => {
  it("creates a primary row for a user that has none", async () => {
    seedUser("u1", "a@example.com");
    await ensurePrimaryUserEmail("u1", "a@example.com");
    expect(userEmailTable).toHaveLength(1);
    expect(userEmailTable[0]).toMatchObject({ userId: "u1", email: "a@example.com", isPrimary: true });
  });

  it("is a no-op (idempotent) when the email row already exists", async () => {
    seedUser("u1", "a@example.com");
    seedUserEmail("u1", "a@example.com", true);
    await ensurePrimaryUserEmail("u1", "a@example.com");
    expect(userEmailTable).toHaveLength(1);
  });
});

describe("backfillUserEmails — deploy/boot backfill", () => {
  it("creates one primary row for every user missing one", async () => {
    seedUser("u1", "a@example.com");
    seedUser("u2", "b@example.com");
    seedUser("u3", null); // no email → skipped

    const result = await backfillUserEmails();

    expect(result.created).toBe(2);
    expect(result.alreadyPresent).toBe(0);
    expect(userEmailTable).toHaveLength(2);
    expect(userEmailTable.every((r) => r.isPrimary)).toBe(true);
    const byEmail = Object.fromEntries(userEmailTable.map((r) => [r.email, r.userId]));
    expect(byEmail["a@example.com"]).toBe("u1");
    expect(byEmail["b@example.com"]).toBe("u2");
  });

  it("running twice is a no-op and does not duplicate rows", async () => {
    seedUser("u1", "a@example.com");
    seedUser("u2", "b@example.com");

    const first = await backfillUserEmails();
    expect(first.created).toBe(2);

    const second = await backfillUserEmails();
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(userEmailTable).toHaveLength(2);
  });

  it("leaves already-indexed users alone (mixed state)", async () => {
    seedUser("u1", "a@example.com");
    seedUserEmail("u1", "a@example.com", true); // already indexed
    seedUser("u2", "b@example.com"); // needs backfill

    const result = await backfillUserEmails();
    expect(result.created).toBe(1);
    expect(result.alreadyPresent).toBe(1);
    expect(userEmailTable).toHaveLength(2);
  });
});
