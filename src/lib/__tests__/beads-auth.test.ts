// @vitest-environment node
/**
 * Tests for `validateProjectPath` (`src/lib/beads-auth.ts`).
 *
 * The regression these guard against: `validateProjectPath` used to also gate
 * on the presence of a `.beads/` directory, returning `null` (→ HTTP 403) for
 * any authorized path that simply had no beads installed. That conflated
 * "unauthorized" with "no beads", so the sidebar surfaced a scary
 * "Invalid or unauthorized project path" error instead of the friendly
 * "not set up" state. Authorization must now validate path OWNERSHIP only.
 *
 * Like the other lib tests in this repo (see `user-identity.test.ts`), these
 * run the real helper against an in-memory fake that emulates the slice of the
 * Drizzle surface the code uses (query.findFirst / query.findMany), with
 * `drizzle-orm`'s `eq` / `and` mocked to descriptor objects the fake reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

// --- Schema seam: column tokens the fake matches on -----------------------
vi.mock("@/db/schema", () => ({
  userSettings: { __table: "user_settings", userId: "userSettings.userId" },
  projects: { __table: "project", userId: "projects.userId" },
  nodePreferences: {
    __table: "node_preference",
    userId: "nodePreferences.userId",
    ownerType: "nodePreferences.ownerType",
  },
}));

// --- drizzle-orm operators → descriptor objects the fake can read ---------
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ op: "eq", column, value }),
  and: (...clauses: unknown[]) => ({ op: "and", clauses }),
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
interface UserSettingsRow {
  userId: string;
  defaultWorkingDirectory: string | null;
}
interface ProjectRow {
  id: string;
  userId: string;
}
interface NodePreferenceRow {
  userId: string;
  ownerId: string;
  ownerType: string;
  defaultWorkingDirectory: string | null;
}

type Desc = { op: "eq"; column: string; value: unknown } | { op: "and"; clauses: Desc[] };

let userSettingsTable: UserSettingsRow[];
let projectsTable: ProjectRow[];
let nodePreferencesTable: NodePreferenceRow[];

/** Flatten an `and(...)` / `eq(...)` descriptor into a list of eq predicates. */
function eqPredicates(where: Desc | undefined): { column: string; value: unknown }[] {
  if (!where) return [];
  if (where.op === "eq") return [{ column: where.column, value: where.value }];
  return where.clauses.flatMap((c) => eqPredicates(c));
}

function matches<T extends object>(
  row: T,
  preds: { column: string; value: unknown }[],
  columnMap: Record<string, keyof T & string>
): boolean {
  return preds.every((p) => {
    const field = columnMap[p.column];
    // A predicate referencing a column we don't map is treated as non-matching
    // to keep the fake honest rather than silently passing.
    if (field === undefined) return false;
    return row[field] === p.value;
  });
}

function makeDb() {
  return {
    query: {
      userSettings: {
        findFirst: async ({ where }: { where?: Desc }) =>
          userSettingsTable.find((r) =>
            matches(r, eqPredicates(where), { "userSettings.userId": "userId" })
          ),
      },
      projects: {
        findMany: async ({ where }: { where?: Desc }) =>
          projectsTable.filter((r) =>
            matches(r, eqPredicates(where), { "projects.userId": "userId" })
          ),
      },
      nodePreferences: {
        findMany: async ({ where }: { where?: Desc }) =>
          nodePreferencesTable.filter((r) =>
            matches(r, eqPredicates(where), {
              "nodePreferences.userId": "userId",
              "nodePreferences.ownerType": "ownerType",
            })
          ),
      },
    },
  };
}

let fakeDb: ReturnType<typeof makeDb>;

vi.mock("@/db", () => ({
  get db() {
    return fakeDb;
  },
}));

import { validateProjectPath } from "@/lib/beads-auth";

beforeEach(() => {
  userSettingsTable = [];
  projectsTable = [];
  nodePreferencesTable = [];
  fakeDb = makeDb();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("validateProjectPath — authorization", () => {
  it("returns null for an unowned / unauthorized path", async () => {
    // User owns nothing matching /some/other/dir.
    userSettingsTable.push({ userId: "u1", defaultWorkingDirectory: "/home/u1/work" });
    await expect(validateProjectPath("u1", "/some/other/dir")).resolves.toBeNull();
  });

  it("authorizes a path matching the user's global defaultWorkingDirectory", async () => {
    userSettingsTable.push({ userId: "u1", defaultWorkingDirectory: "/home/u1/work" });
    await expect(validateProjectPath("u1", "/home/u1/work")).resolves.toBe(
      resolve("/home/u1/work")
    );
  });

  it("authorizes a path matching a per-project defaultWorkingDirectory", async () => {
    projectsTable.push({ id: "p1", userId: "u1" });
    nodePreferencesTable.push({
      userId: "u1",
      ownerId: "p1",
      ownerType: "project",
      defaultWorkingDirectory: "/home/u1/projects/app",
    });
    await expect(validateProjectPath("u1", "/home/u1/projects/app")).resolves.toBe(
      resolve("/home/u1/projects/app")
    );
  });

  it("does NOT authorize a project preference that belongs to a different user", async () => {
    // Preference row points at a project the user does not own.
    projectsTable.push({ id: "p-other", userId: "u2" });
    nodePreferencesTable.push({
      userId: "u1",
      ownerId: "p-other",
      ownerType: "project",
      defaultWorkingDirectory: "/home/u2/secret",
    });
    await expect(validateProjectPath("u1", "/home/u2/secret")).resolves.toBeNull();
  });
});

describe("validateProjectPath — beads existence is NOT an auth concern (regression)", () => {
  it("authorizes an owned path even though it has NO .beads directory", async () => {
    // The home directory: an authorized working dir with no beads installed.
    // Previously this returned null (→ 403) because validateProjectPath gated
    // on existsSync(.beads). It must now resolve, leaving the
    // "{ initialized: false }" reporting to the route layer.
    userSettingsTable.push({ userId: "u1", defaultWorkingDirectory: "/home/u1" });

    // Note: no fs mock — the function no longer touches the filesystem for the
    // .beads check, so a real /home/u1 (which won't have .beads here) is fine.
    await expect(validateProjectPath("u1", "/home/u1")).resolves.toBe(resolve("/home/u1"));
  });
});
