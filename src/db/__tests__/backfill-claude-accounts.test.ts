// @vitest-environment node
/**
 * Tests for the profile→account backfill [remote-dev-n4x4.6].
 *
 * Exercises the data-migration contract: no claude-capable profile of an
 * account-less user is left without an account, existing accounts are never
 * duplicated or overwritten, project primaries get linked to an account, and
 * repeated runs are no-ops. Since remote-dev-ifcl the profile pass also SKIPS
 * any user who already has account rows — the backfill runs on every deploy,
 * and "Add account" rows carry `profile_id` NULL, so the old profile-keyed
 * check re-created token-less duplicates the user had deleted.
 * The DB is a small in-memory fake — no real database is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;

const profiles: Row[] = [];
const accounts: Row[] = [];
const links: Row[] = [];

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown): Pred => (row) => row[col] === value,
  inArray:
    (col: string, values: unknown[]): Pred =>
    (row) => values.includes(row[col]),
  isNull: (col: string): Pred => (row) => row[col] == null,
  isNotNull: (col: string): Pred => (row) => row[col] != null,
}));

vi.mock("@/db/schema", () => ({
  agentProfiles: { id: "id", provider: "provider" },
  claudeAccounts: { id: "id", profileId: "profileId" },
  projectProfileLinks: { projectId: "projectId", accountId: "accountId" },
}));

vi.mock("../index", () => ({
  db: {
    query: {
      agentProfiles: {
        findMany: async ({ where }: { where?: Pred }) =>
          profiles.filter((r) => (where ? where(r) : true)),
      },
      claudeAccounts: {
        findMany: async ({ where }: { where?: Pred }) =>
          accounts.filter((r) => (where ? where(r) : true)),
      },
      projectProfileLinks: {
        findMany: async ({ where }: { where?: Pred }) =>
          links.filter((r) => (where ? where(r) : true)),
      },
    },
    insert: () => ({
      values: async (vals: Row) => {
        accounts.push({ ...vals });
      },
    }),
    update: () => ({
      set: (vals: Row) => ({
        where: async (pred: Pred) => {
          for (const link of links) {
            if (pred(link)) Object.assign(link, vals);
          }
        },
      }),
    }),
  },
}));

import { backfillClaudeAccounts } from "../backfill-claude-accounts";

beforeEach(() => {
  profiles.length = 0;
  accounts.length = 0;
  links.length = 0;
});

describe("backfillClaudeAccounts", () => {
  it("creates a standalone account for every claude-capable profile that lacks one", async () => {
    profiles.push(
      { id: "p-claude", userId: "u1", name: "Claude A", provider: "claude" },
      { id: "p-all", userId: "u1", name: "Everything", provider: "all" }
    );

    const result = await backfillClaudeAccounts();

    expect(result.profilesScanned).toBe(2);
    expect(result.accountsCreated).toBe(2);
    expect(result.accountsAlreadyPresent).toBe(0);
    expect(accounts).toHaveLength(2);

    const migrated = accounts.find((a) => a.profileId === "p-claude")!;
    // The origin profile is retained as a breadcrumb (not as identity)…
    expect(migrated.profileId).toBe("p-claude");
    expect(migrated.userId).toBe("u1");
    // …the profile name seeds a recognizable alias…
    expect(migrated.alias).toBe("Claude A");
    // …and no credential is invented: the Keychain token can't be recovered.
    expect(migrated.authHealthy).toBe(false);
    expect(migrated.oauthTokenEncrypted).toBeUndefined();
  });

  it("ignores non-Claude profiles", async () => {
    profiles.push({ id: "p-codex", userId: "u1", name: "Codex", provider: "codex" });

    const result = await backfillClaudeAccounts();

    expect(result.profilesScanned).toBe(0);
    expect(accounts).toHaveLength(0);
  });

  it("preserves an existing account instead of duplicating or overwriting it", async () => {
    profiles.push({ id: "p1", userId: "u1", name: "Renamed Profile", provider: "claude" });
    accounts.push({
      id: "acct-existing",
      userId: "u1",
      profileId: "p1",
      alias: "My Max Account",
      authHealthy: true,
    });

    const result = await backfillClaudeAccounts();

    expect(result.accountsCreated).toBe(0);
    expect(result.accountsAlreadyPresent).toBe(1);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].alias).toBe("My Max Account");
    expect(accounts[0].authHealthy).toBe(true);
  });

  // ── Per-user skip rule [remote-dev-ifcl] ───────────────────────────────────

  it("does NOT re-create placeholders for a user who already has accounts", async () => {
    // The live regression: the user added real accounts via "Add account"
    // (profile_id NULL), deleted the auto-created "Not signed in" duplicates,
    // and the next deploy's backfill re-created them because the check was
    // keyed on profile_id alone.
    profiles.push(
      { id: "p1", userId: "u1", name: "Claude A", provider: "claude" },
      { id: "p2", userId: "u1", name: "Claude B", provider: "claude" }
    );
    accounts.push({
      id: "acct-added",
      userId: "u1",
      profileId: null, // "Add account" rows never carry a profile origin.
      alias: "Personal Max",
      authHealthy: true,
    });

    const result = await backfillClaudeAccounts();

    expect(result.accountsCreated).toBe(0);
    expect(result.profilesSkippedUserHasAccounts).toBe(2);
    expect(accounts).toHaveLength(1);
  });

  it("still migrates a zero-account user while skipping an account-holding one", async () => {
    profiles.push(
      // u1: true migration case — every claude-capable profile gets an account.
      { id: "p1", userId: "u1", name: "Claude A", provider: "claude" },
      { id: "p2", userId: "u1", name: "Everything", provider: "all" },
      // u2: already in the account-first world — no placeholder.
      { id: "p3", userId: "u2", name: "Claude C", provider: "claude" }
    );
    accounts.push({
      id: "acct-u2",
      userId: "u2",
      profileId: null,
      authHealthy: true,
    });

    const result = await backfillClaudeAccounts();

    expect(result.accountsCreated).toBe(2);
    expect(result.profilesSkippedUserHasAccounts).toBe(1);
    // u2's account never blocks u1's migration, and both u1 profiles land in
    // the SAME run (the skip set is built from pre-existing rows only).
    expect(accounts.filter((a) => a.userId === "u1")).toHaveLength(2);
    expect(accounts.filter((a) => a.userId === "u2")).toHaveLength(1);
  });

  it("still creates the placeholder for a PINNED profile of a user with accounts, and fills the link", async () => {
    // The carve-out: without it, the per-user skip would leave this profile
    // with no origin account, so the link fill would have nothing to write and
    // project_profile_link.account_id would stay NULL forever — no rotation,
    // no limit attribution for that project.
    profiles.push({ id: "p-pinned", userId: "u1", name: "Pinned", provider: "claude" });
    accounts.push({
      id: "acct-added",
      userId: "u1",
      profileId: null, // "Add account" row — triggers the per-user skip.
      authHealthy: true,
    });
    links.push({ projectId: "proj-1", profileId: "p-pinned", accountId: null });

    const result = await backfillClaudeAccounts();

    expect(result.accountsCreated).toBe(1);
    expect(result.profilesSkippedUserHasAccounts).toBe(0);
    expect(result.projectLinksLinked).toBe(1);
    const placeholder = accounts.find((a) => a.profileId === "p-pinned")!;
    expect(placeholder).toBeDefined();
    expect(placeholder.authHealthy).toBe(false);
    expect(links[0].accountId).toBe(placeholder.id);
  });

  it("keeps skipping a NON-pinned profile of that same user (no placeholder churn)", async () => {
    profiles.push(
      { id: "p-pinned", userId: "u1", name: "Pinned", provider: "claude" },
      { id: "p-loose", userId: "u1", name: "Loose", provider: "claude" }
    );
    accounts.push({
      id: "acct-added",
      userId: "u1",
      profileId: null,
      authHealthy: true,
    });
    links.push({ projectId: "proj-1", profileId: "p-pinned", accountId: null });

    const result = await backfillClaudeAccounts();

    // Only the pinned profile escapes the skip; the loose one stays skipped.
    expect(result.accountsCreated).toBe(1);
    expect(result.profilesSkippedUserHasAccounts).toBe(1);
    expect(accounts.find((a) => a.profileId === "p-loose")).toBeUndefined();
  });

  it("stays idempotent under the skip rule: a re-run after migration creates nothing", async () => {
    profiles.push({ id: "p1", userId: "u1", name: "Claude A", provider: "claude" });

    const first = await backfillClaudeAccounts();
    expect(first.accountsCreated).toBe(1);

    const second = await backfillClaudeAccounts();
    // The migrated account is profile-linked, so it counts as "already
    // present" (not as a user-level skip) — and nothing new appears.
    expect(second.accountsCreated).toBe(0);
    expect(second.accountsAlreadyPresent).toBe(1);
    expect(second.profilesSkippedUserHasAccounts).toBe(0);
    expect(accounts).toHaveLength(1);
  });

  it("links a project's primary profile to that profile's account", async () => {
    profiles.push({ id: "p1", userId: "u1", name: "Claude A", provider: "claude" });
    links.push({ projectId: "proj-1", profileId: "p1", accountId: null });

    const result = await backfillClaudeAccounts();

    expect(result.projectLinksLinked).toBe(1);
    expect(links[0].accountId).toBe(accounts[0].id);
  });

  it("leaves an already-linked project alone", async () => {
    profiles.push({ id: "p1", userId: "u1", name: "Claude A", provider: "claude" });
    links.push({ projectId: "proj-1", profileId: "p1", accountId: "acct-pinned" });

    const result = await backfillClaudeAccounts();

    expect(result.projectLinksLinked).toBe(0);
    expect(links[0].accountId).toBe("acct-pinned");
  });

  it("skips a link whose primary profile has no Claude account", async () => {
    links.push({ projectId: "proj-1", profileId: "p-codex", accountId: null });

    const result = await backfillClaudeAccounts();

    expect(result.projectLinksLinked).toBe(0);
    expect(links[0].accountId).toBeNull();
  });

  it("is idempotent: a second run creates nothing", async () => {
    profiles.push({ id: "p1", userId: "u1", name: "Claude A", provider: "claude" });
    links.push({ projectId: "proj-1", profileId: "p1", accountId: null });

    await backfillClaudeAccounts();
    const afterFirst = accounts.map((a) => a.id);

    const second = await backfillClaudeAccounts();

    expect(second.accountsCreated).toBe(0);
    expect(second.projectLinksLinked).toBe(0);
    expect(accounts.map((a) => a.id)).toEqual(afterFirst);
  });
});
