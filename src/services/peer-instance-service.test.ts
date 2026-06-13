// @vitest-environment node
/**
 * PeerInstanceService tests — encryption round-trip of stored credentials,
 * masked views (plaintext never escapes), and the verifyPeer capability
 * probe (peerFetch stubbed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.AUTH_SECRET = "peer-instance-test-secret";

import { createTestDb, type TestDbHandle } from "./__tests__/migration-test-db";

let handle: TestDbHandle;

vi.mock("@/db", () => ({
  get db() {
    return handle.db;
  },
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
// Only peerFetch is stubbed; readPeerJson (the response→error mapper) is the
// real implementation so verifyPeer's error messages are exercised end-to-end.
vi.mock("@/lib/peer-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/peer-fetch")>();
  return { ...actual, peerFetch: vi.fn() };
});

import {
  createPeer,
  updatePeer,
  deletePeer,
  listPeers,
  getPeer,
  getPeerRow,
  verifyPeer,
  maskApiKey,
} from "./peer-instance-service";
import { peerFetch } from "@/lib/peer-fetch";
import { decrypt } from "@/lib/encryption";
import { users, peerInstances } from "@/db/schema";

const USER = "peer-user-1";
const API_KEY = "rdv_live_abcdef1234567890";
const CF_SECRET = "cf-secret-value-0001";

const mockedPeerFetch = vi.mocked(peerFetch);

describe("PeerInstanceService", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    await handle.db.insert(users).values({ id: USER, email: "peer@example.com" });
    mockedPeerFetch.mockReset();
  });

  afterEach(() => {
    handle.cleanup();
  });

  it("encrypts credentials at rest and round-trips through decrypt", async () => {
    const view = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com/",
      apiKey: API_KEY,
      cfAccessClientId: "client-id.access",
      cfAccessSecret: CF_SECRET,
    });

    const row = await getPeerRow(USER, view.id);
    expect(row).not.toBeNull();
    // Stored ciphertext, not plaintext…
    expect(row!.encryptedApiKey).not.toContain(API_KEY);
    expect(row!.encryptedCfAccessSecret).not.toContain(CF_SECRET);
    // …that decrypts back to the original values.
    expect(decrypt(row!.encryptedApiKey)).toBe(API_KEY);
    expect(decrypt(row!.encryptedCfAccessSecret!)).toBe(CF_SECRET);
    // Trailing slash trimmed.
    expect(row!.baseUrl).toBe("https://rdv.example.com");
  });

  it("masks the API key in every API-facing view", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    // Create response gets a real prefix+last4 mask, never the key itself.
    expect(created.apiKeyMasked).toBe("rdv_…7890");
    expect(JSON.stringify(created)).not.toContain(API_KEY);

    // Reads cannot recover plaintext by design → generic mask, no secrets.
    const listed = await listPeers(USER);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(API_KEY);
    expect(listed[0].hasCfAccessSecret).toBe(false);
    const fetched = await getPeer(USER, created.id);
    expect(JSON.stringify(fetched)).not.toContain(API_KEY);
  });

  it("maskApiKey shows prefix + last 4 and fully masks short keys", () => {
    expect(maskApiKey("rdv_live_abcdef1234567890")).toBe("rdv_…7890");
    expect(maskApiKey("plainlongtoken9999")).toBe("plai…9999");
    expect(maskApiKey("short")).toBe("••••");
  });

  it("re-encrypts on update and resets cached capabilities", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    await handle.db
      .update(peerInstances)
      .set({ capabilities: '{"version":1}', lastSeenAt: new Date() })
      .where(eq(peerInstances.id, created.id));

    const updated = await updatePeer(USER, created.id, { apiKey: "rdv_new_key_0042" });
    expect(updated?.apiKeyMasked).toBe("rdv_…0042");
    expect(updated?.capabilities).toBeNull();
    expect(updated?.lastSeenAt).toBeNull();

    const row = await getPeerRow(USER, created.id);
    expect(decrypt(row!.encryptedApiKey)).toBe("rdv_new_key_0042");
  });

  it("scopes reads/deletes by owner", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    expect(await getPeer("intruder", created.id)).toBeNull();
    expect(await deletePeer("intruder", created.id)).toBe(false);
    expect(await deletePeer(USER, created.id)).toBe(true);
    expect(await getPeer(USER, created.id)).toBeNull();
  });

  it("verifyPeer caches capabilities + lastSeenAt on success", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    mockedPeerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ version: 1, maxChunkBytes: 67108864, appVersion: "0.3.18" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const capabilities = await verifyPeer(USER, created.id);
    expect(capabilities).toEqual({
      version: 1,
      maxChunkBytes: 67108864,
      appVersion: "0.3.18",
    });
    expect(mockedPeerFetch).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      "/api/migration/capabilities",
      { method: "GET" },
    );

    const row = await getPeerRow(USER, created.id);
    expect(JSON.parse(row!.capabilities!)).toEqual(capabilities);
    expect(row!.lastSeenAt).not.toBeNull();

    const view = await getPeer(USER, created.id);
    expect(view?.capabilities?.appVersion).toBe("0.3.18");
  });

  it("verifyPeer surfaces auth failures without caching", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    mockedPeerFetch.mockResolvedValue(new Response("nope", { status: 401 }));

    // readPeerJson maps 401 to an actionable "rejected the API key" message.
    await expect(verifyPeer(USER, created.id)).rejects.toThrow(
      /rejected the API key \(401\)/,
    );
    const row = await getPeerRow(USER, created.id);
    expect(row!.capabilities).toBeNull();
    expect(row!.lastSeenAt).toBeNull();
  });

  it("verifyPeer maps a Cloudflare-Access redirect to a service-token hint", async () => {
    const created = await createPeer(USER, {
      name: "homelab",
      baseUrl: "https://rdv.example.com",
      apiKey: API_KEY,
    });
    mockedPeerFetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/cdn-cgi/access/login" } }),
    );

    await expect(verifyPeer(USER, created.id)).rejects.toThrow(
      /unexpected redirect.*Cloudflare Access/,
    );
    const row = await getPeerRow(USER, created.id);
    expect(row!.capabilities).toBeNull();
  });

  it("rejects non-http base URLs", async () => {
    await expect(
      createPeer(USER, { name: "bad", baseUrl: "ftp://nope", apiKey: API_KEY }),
    ).rejects.toThrow(/baseUrl/);
  });
});
