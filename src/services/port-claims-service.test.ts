import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// The other service tests mock `@/db` with a hand-rolled stub. That works for
// pure mapping logic, but this service's behavior IS the SQL — upsert on a
// unique conflict, expiry-window filtering, prune counts. A stub can't verify
// any of that, so we mock `@/db` with a REAL in-memory libsql database wired to
// the real drizzle schema. Each test gets a fresh DB via `resetDb()`.
//
// We only create the `port_claim` table itself (FK targets aren't enforced —
// libsql leaves `foreign_keys` off by default — so referencing tables aren't
// needed for these unit tests).
let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

const CREATE_TABLE = `
  CREATE TABLE port_claim (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    port INTEGER NOT NULL,
    variable_name TEXT NOT NULL,
    is_listening INTEGER,
    pid INTEGER,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
const CREATE_UNIQUE_INDEX = `
  CREATE UNIQUE INDEX port_claim_session_port_unique
    ON port_claim (session_id, port);
`;

async function resetDb(): Promise<void> {
  client = createClient({ url: ":memory:" });
  testDb = drizzle(client, { schema });
  await client.execute(CREATE_TABLE);
  await client.execute(CREATE_UNIQUE_INDEX);
}

// Import after the mock is registered so the service binds to our `testDb`.
import {
  claimPortsForSession,
  releasePortsForSession,
  getActiveClaimsForUser,
  getActiveClaimsForInstance,
  pruneExpiredClaims,
  updateListeningStatus,
} from "./port-claims-service";

const SESSION = "session-1";
const USER = "user-1";
const PROJECT = "project-1";

describe("PortClaimsService", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("claimPortsForSession + read-back", () => {
    it("persists claims and reads them back for the user", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
        { port: 5432, variableName: "DB_PORT" },
      ]);

      const claims = await getActiveClaimsForUser(USER);
      expect(claims).toHaveLength(2);

      const byPort = new Map(claims.map((c) => [c.port, c]));
      expect(byPort.get(3000)?.variableName).toBe("PORT");
      expect(byPort.get(5432)?.variableName).toBe("DB_PORT");

      const claim = byPort.get(3000);
      expect(claim?.sessionId).toBe(SESSION);
      expect(claim?.userId).toBe(USER);
      expect(claim?.projectId).toBe(PROJECT);
      // Unprobed claims default to unknown listener status.
      expect(claim?.isListening).toBeNull();
      expect(claim?.pid).toBeNull();
      expect(claim?.expiresAt).toBeInstanceOf(Date);
      expect(claim?.claimedAt).toBeInstanceOf(Date);
      // expiresAt ~24h in the future.
      const ttl = claim!.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    });

    it("accepts a null projectId", async () => {
      await claimPortsForSession(SESSION, USER, null, [
        { port: 8080, variableName: "PORT" },
      ]);

      const [claim] = await getActiveClaimsForUser(USER);
      expect(claim.projectId).toBeNull();
    });

    it("is a no-op for an empty ports array", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, []);
      expect(await getActiveClaimsForUser(USER)).toHaveLength(0);
    });
  });

  describe("unique (sessionId, port) upsert behavior", () => {
    it("updates variableName/expiresAt instead of inserting a duplicate", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      const before = (await getActiveClaimsForUser(USER))[0];

      // Re-claim the same (session, port) with a new variable name.
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "WEB_PORT" },
      ]);

      const claims = await getActiveClaimsForUser(USER);
      expect(claims).toHaveLength(1);
      expect(claims[0].id).toBe(before.id); // same row, upserted
      expect(claims[0].variableName).toBe("WEB_PORT");
    });

    it("preserves listener status across a re-claim", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await updateListeningStatus([{ port: 3000, isListening: true, pid: 4242 }]);

      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);

      const [claim] = await getActiveClaimsForUser(USER);
      expect(claim.isListening).toBe(true);
      expect(claim.pid).toBe(4242);
    });

    it("allows the same port across different sessions", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await claimPortsForSession("session-2", USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);

      expect(await getActiveClaimsForUser(USER)).toHaveLength(2);
    });
  });

  describe("releasePortsForSession", () => {
    it("deletes every claim for the session", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
        { port: 5432, variableName: "DB_PORT" },
      ]);
      await claimPortsForSession("session-2", USER, PROJECT, [
        { port: 9000, variableName: "PORT" },
      ]);

      await releasePortsForSession(SESSION);

      const claims = await getActiveClaimsForUser(USER);
      expect(claims).toHaveLength(1);
      expect(claims[0].sessionId).toBe("session-2");
    });
  });

  describe("getActiveClaimsForInstance", () => {
    it("returns active claims across all users", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await claimPortsForSession("session-2", "user-2", null, [
        { port: 4000, variableName: "PORT" },
      ]);

      const claims = await getActiveClaimsForInstance();
      expect(claims).toHaveLength(2);
      expect(new Set(claims.map((c) => c.userId))).toEqual(
        new Set([USER, "user-2"])
      );
    });

    it("excludes expired claims", async () => {
      await insertExpiredClaim({ port: 1234 });
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);

      const claims = await getActiveClaimsForInstance();
      expect(claims).toHaveLength(1);
      expect(claims[0].port).toBe(3000);
    });
  });

  describe("pruneExpiredClaims", () => {
    it("deletes expired claims, keeps future ones, returns count", async () => {
      // Future claim (kept).
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      // Two past-expiry claims (pruned).
      await insertExpiredClaim({ port: 1111 });
      await insertExpiredClaim({ port: 2222 });

      const deleted = await pruneExpiredClaims();
      expect(deleted).toBe(2);

      const remaining = await getActiveClaimsForInstance();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].port).toBe(3000);
    });

    it("returns 0 when nothing is expired", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      expect(await pruneExpiredClaims()).toBe(0);
    });
  });

  describe("updateListeningStatus", () => {
    it("updates isListening and pid for the matching active claim", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);

      await updateListeningStatus([
        { port: 3000, isListening: true, pid: 1234 },
      ]);

      const [claim] = await getActiveClaimsForUser(USER);
      expect(claim.isListening).toBe(true);
      expect(claim.pid).toBe(1234);
    });

    it("leaves pid untouched when not provided", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await updateListeningStatus([{ port: 3000, isListening: true, pid: 99 }]);

      // Second update omits pid → pid should remain 99.
      await updateListeningStatus([{ port: 3000, isListening: false }]);

      const [claim] = await getActiveClaimsForUser(USER);
      expect(claim.isListening).toBe(false);
      expect(claim.pid).toBe(99);
    });

    it("updates every active claim sharing the same port", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await claimPortsForSession("session-2", USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);

      await updateListeningStatus([{ port: 3000, isListening: true }]);

      const claims = await getActiveClaimsForUser(USER);
      expect(claims).toHaveLength(2);
      expect(claims.every((c) => c.isListening === true)).toBe(true);
    });

    it("is a no-op for an empty updates array", async () => {
      await claimPortsForSession(SESSION, USER, PROJECT, [
        { port: 3000, variableName: "PORT" },
      ]);
      await updateListeningStatus([]);

      const [claim] = await getActiveClaimsForUser(USER);
      expect(claim.isListening).toBeNull();
    });
  });
});

/**
 * Insert a claim whose `expiresAt` is in the past (1 minute ago) directly via
 * drizzle, bypassing the service's fixed 24h TTL.
 */
async function insertExpiredClaim({ port }: { port: number }): Promise<void> {
  const past = new Date(Date.now() - 60 * 1000);
  await testDb.insert(schema.portClaims).values({
    sessionId: `expired-session-${port}`,
    userId: USER,
    projectId: PROJECT,
    port,
    variableName: "PORT",
    expiresAt: past,
    claimedAt: past,
    updatedAt: past,
  });
}
