// @vitest-environment node
/**
 * Tests for SshConnectionService — focused on the parts that can be
 * exercised without a live database: filesystem helpers, encryption
 * round-trips, and ed25519 keypair generation. CRUD against the DB is
 * covered by integration tests against the libsql backend (out of scope
 * for this unit suite).
 */

import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const execFileAsync = promisify(execFile);

async function hasSshKeygen(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("which", ["ssh-keygen"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// Pin the SSH dir into a tmp location so the suite never touches the
// user's real ~/.remote-dev. Must be set before importing the service.
let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "rdv-ssh-test-"));
  process.env.RDV_DATA_DIR = tmpRoot;
  process.env.AUTH_SECRET = "test-auth-secret-for-ssh-suite";
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
});

describe("SshConnectionService — filesystem helpers", () => {
  it("getConnectionDir returns a path under the data dir", async () => {
    const mod = await import("../ssh-connection-service");
    const dir = mod.getConnectionDir("abc-123");
    expect(dir).toContain(tmpRoot);
    expect(dir).toMatch(/ssh\/abc-123$/);
  });

  it("writeKey writes a private key with mode 0600 and appends a trailing newline", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "key-mode-test";
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nDEADBEEF\n-----END OPENSSH PRIVATE KEY-----";
    await mod.writeKey(id, pem);

    const path = mod.getPrivateKeyPath(id);
    const st = await stat(path);
    // Lower 9 bits should equal 0o600.
    expect(st.mode & 0o777).toBe(0o600);
    const contents = await readFile(path, "utf8");
    expect(contents.endsWith("\n")).toBe(true);
    expect(contents).toContain("DEADBEEF");
  });

  it("writeKey writes the public key sibling at mode 0644", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "pub-mode-test";
    await mod.writeKey(id, "PRIV", "ssh-ed25519 AAAA test@example");
    const pubPath = mod.getPublicKeyPath(id);
    const st = await stat(pubPath);
    expect(st.mode & 0o777).toBe(0o644);
    const contents = await readFile(pubPath, "utf8");
    expect(contents).toContain("ssh-ed25519");
  });

  it("generateKeypair produces a valid OpenSSH ed25519 public key", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "gen-test";
    const result = await mod.generateKeypair(id);
    expect(result.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ /);

    // Both the private and public files must exist with correct modes.
    const privPath = mod.getPrivateKeyPath(id);
    const pubPath = mod.getPublicKeyPath(id);
    const privStat = await stat(privPath);
    const pubStat = await stat(pubPath);
    expect(privStat.mode & 0o777).toBe(0o600);
    expect(pubStat.mode & 0o777).toBe(0o644);

    // The OpenSSH public-key wire format encodes the algo string at the
    // start of the base64 blob — sanity-check that we wrote the right thing.
    const b64 = result.publicKey.split(" ")[1];
    const decoded = Buffer.from(b64, "base64");
    // 4-byte length + "ssh-ed25519" (11 bytes) + 4-byte length + 32-byte key
    expect(decoded.length).toBeGreaterThanOrEqual(4 + 11 + 4 + 32);
    const algoLen = decoded.readUInt32BE(0);
    expect(algoLen).toBe(11);
    const algoStr = decoded.subarray(4, 4 + algoLen).toString("utf8");
    expect(algoStr).toBe("ssh-ed25519");
  });

  it("generateKeypair writes a private key in OpenSSH PEM format", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "gen-openssh-format-test";
    await mod.generateKeypair(id);

    const privContents = await readFile(mod.getPrivateKeyPath(id), "utf8");
    expect(privContents.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n")).toBe(true);
    expect(privContents.endsWith("-----END OPENSSH PRIVATE KEY-----\n")).toBe(true);
    // Body should NOT be PKCS#8 — that's the bug we're fixing.
    expect(privContents).not.toContain("BEGIN PRIVATE KEY");

    // Decoded body must start with the OpenSSH magic bytes.
    const body = privContents
      .replace("-----BEGIN OPENSSH PRIVATE KEY-----\n", "")
      .replace("-----END OPENSSH PRIVATE KEY-----\n", "")
      .replace(/\n/g, "");
    const decoded = Buffer.from(body, "base64");
    expect(decoded.subarray(0, 15).toString("utf8")).toBe("openssh-key-v1\0");
  });

  it("generateKeypair private key is loadable by ssh-keygen", async () => {
    if (!(await hasSshKeygen())) {
      // Skip on systems without OpenSSH installed (some minimal CI images).
      return;
    }
    const mod = await import("../ssh-connection-service");
    const id = "gen-ssh-keygen-test";
    await mod.generateKeypair(id);
    const privPath = mod.getPrivateKeyPath(id);

    const { stdout, stderr } = await execFileAsync("ssh-keygen", [
      "-y",
      "-f",
      privPath,
    ]);
    expect(stderr).not.toMatch(/invalid format/i);
    expect(stdout.trim().startsWith("ssh-ed25519 ")).toBe(true);
  });

  it("hasPrivateKey reflects on-disk state", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "presence-test";
    expect(await mod.hasPrivateKey(id)).toBe(false);
    await mod.writeKey(id, "PRIV");
    expect(await mod.hasPrivateKey(id)).toBe(true);
  });

  it("readPublicKey returns null when no public key is on disk", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "missing-pub-test";
    await mod.writeKey(id, "PRIV"); // no pub
    expect(await mod.readPublicKey(id)).toBeNull();
  });

  it("deleteConnectionDir removes the directory recursively", async () => {
    const mod = await import("../ssh-connection-service");
    const id = "delete-test";
    await mod.writeKey(id, "PRIV", "ssh-ed25519 AAAA");
    await mod.deleteConnectionDir(id);
    expect(await mod.hasPrivateKey(id)).toBe(false);
    expect(await mod.readPublicKey(id)).toBeNull();
  });
});

describe("SshConnectionService — getConnectionDir path-traversal guard", () => {
  it("rejects ids that escape the SSH base dir", async () => {
    const mod = await import("../ssh-connection-service");
    expect(() => mod.getConnectionDir("../foo")).toThrow(/Invalid connection id/i);
    expect(() => mod.getConnectionDir("../../etc/passwd")).toThrow(
      /Invalid connection id/i
    );
    expect(() => mod.getConnectionDir("/absolute/path")).toThrow(
      /Invalid connection id/i
    );
  });

  it("accepts well-formed connection ids", async () => {
    const mod = await import("../ssh-connection-service");
    const dir = mod.getConnectionDir("550e8400-e29b-41d4-a716-446655440000");
    expect(dir).toContain(tmpRoot);
  });
});

describe("SshConnectionService — extraOptions allowlist", () => {
  it("rejects ProxyCommand", async () => {
    const mod = await import("../ssh-connection-service");
    // Use the create() error path to exercise validation. We pass through
    // an invalid input; the throw happens before any DB write.
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["-o", "ProxyCommand=nc evil 22"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects LocalCommand", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["-o", "LocalCommand=rm -rf /"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects PermitLocalCommand", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["-o", "PermitLocalCommand=yes"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects Match blocks", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["Match host *"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects -F (alternate config file)", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["-F", "/tmp/evil-config"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects entries longer than 256 chars", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["x".repeat(300)],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects entries with embedded newlines", async () => {
    const mod = await import("../ssh-connection-service");
    await expect(
      mod.create("test-user-allowlist", {
        name: "x",
        host: "h",
        username: "u",
        authType: "system",
        extraOptions: ["-o\nProxyCommand=evil"],
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("SshConnectionService — password encryption round-trip", () => {
  it("getDecryptedPassword recovers the plaintext", async () => {
    const mod = await import("../ssh-connection-service");
    const { encrypt } = await import("@/lib/encryption");
    const plaintext = "hunter2!";
    const enc = encrypt(plaintext);
    // Build a minimal SshConnection-shaped object — we only call the helper.
    const conn: Parameters<typeof mod.getDecryptedPassword>[0] = {
      id: "enc-test",
      userId: "u1",
      projectId: null,
      name: "n",
      host: "h",
      port: 22,
      username: "u",
      authType: "password",
      hasPassphrase: false,
      passwordEnc: enc,
      knownHostsPolicy: "accept-new",
      extraOptions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: null,
    };
    expect(mod.getDecryptedPassword(conn)).toBe(plaintext);
  });

  it("returns null when no password is stored", async () => {
    const mod = await import("../ssh-connection-service");
    const conn: Parameters<typeof mod.getDecryptedPassword>[0] = {
      id: "no-pwd",
      userId: "u1",
      projectId: null,
      name: "n",
      host: "h",
      port: 22,
      username: "u",
      authType: "key",
      hasPassphrase: false,
      passwordEnc: null,
      knownHostsPolicy: "accept-new",
      extraOptions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: null,
    };
    expect(mod.getDecryptedPassword(conn)).toBeNull();
  });
});

describe("SshConnectionService — OpenSSH wire-format encoders", () => {
  it("encodeOpensshEd25519PublicKey emits the expected wire format for a known input", async () => {
    const mod = await import("../ssh-connection-service");
    // 32-byte all-zero public key: deterministic output we can hand-check.
    const rawPub = Buffer.alloc(32, 0);
    const line = mod.encodeOpensshEd25519PublicKey(rawPub);
    expect(line.startsWith("ssh-ed25519 ")).toBe(true);

    const b64 = line.split(" ")[1];
    const decoded = Buffer.from(b64, "base64");
    // uint32(11) || "ssh-ed25519" || uint32(32) || 32 zero bytes
    expect(decoded.length).toBe(4 + 11 + 4 + 32);
    expect(decoded.readUInt32BE(0)).toBe(11);
    expect(decoded.subarray(4, 15).toString("utf8")).toBe("ssh-ed25519");
    expect(decoded.readUInt32BE(15)).toBe(32);
    expect(decoded.subarray(19, 51).equals(Buffer.alloc(32, 0))).toBe(true);
  });

  it("encodeOpensshEd25519PublicKey rejects keys that are not 32 bytes", async () => {
    const mod = await import("../ssh-connection-service");
    expect(() => mod.encodeOpensshEd25519PublicKey(Buffer.alloc(31, 0))).toThrow();
    expect(() => mod.encodeOpensshEd25519PublicKey(Buffer.alloc(64, 0))).toThrow();
  });

  it("encodeOpensshEd25519PrivateKey produces a wrapped PEM with the OpenSSH magic", async () => {
    const mod = await import("../ssh-connection-service");
    const rawPriv = Buffer.alloc(32, 1);
    const rawPub = Buffer.alloc(32, 2);
    const pem = mod.encodeOpensshEd25519PrivateKey(rawPriv, rawPub, "test");

    expect(pem.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n")).toBe(true);
    expect(pem.endsWith("-----END OPENSSH PRIVATE KEY-----\n")).toBe(true);

    const lines = pem.split("\n");
    // First line is the BEGIN marker, last two are END marker + empty trailing.
    const bodyLines = lines.slice(1, -2);
    expect(bodyLines.length).toBeGreaterThan(0);
    for (const line of bodyLines) {
      // ssh-keygen wraps at 70 columns; final line may be shorter.
      expect(line.length).toBeLessThanOrEqual(70);
    }

    const body = bodyLines.join("");
    const decoded = Buffer.from(body, "base64");
    expect(decoded.subarray(0, 15).toString("utf8")).toBe("openssh-key-v1\0");

    // Walk the wire format and verify checkints match + the private blob
    // round-trips.
    let off = 15;
    const readString = (): Buffer => {
      const len = decoded.readUInt32BE(off);
      off += 4;
      const b = decoded.subarray(off, off + len);
      off += len;
      return b;
    };
    expect(readString().toString("utf8")).toBe("none"); // ciphername
    expect(readString().toString("utf8")).toBe("none"); // kdfname
    expect(readString().length).toBe(0); // kdfoptions
    const numKeys = decoded.readUInt32BE(off);
    off += 4;
    expect(numKeys).toBe(1);

    const pubBlob = readString();
    let inner = 0;
    expect(pubBlob.readUInt32BE(inner)).toBe(11);
    inner += 4;
    expect(pubBlob.subarray(inner, inner + 11).toString("utf8")).toBe(
      "ssh-ed25519"
    );
    inner += 11;
    expect(pubBlob.readUInt32BE(inner)).toBe(32);
    inner += 4;
    expect(pubBlob.subarray(inner, inner + 32).equals(rawPub)).toBe(true);

    const privBlob = readString();
    // checkint repeated.
    expect(privBlob.subarray(0, 4).equals(privBlob.subarray(4, 8))).toBe(true);
    let pi = 8;
    // type
    expect(privBlob.readUInt32BE(pi)).toBe(11);
    pi += 4;
    expect(privBlob.subarray(pi, pi + 11).toString("utf8")).toBe("ssh-ed25519");
    pi += 11;
    // public
    expect(privBlob.readUInt32BE(pi)).toBe(32);
    pi += 4;
    expect(privBlob.subarray(pi, pi + 32).equals(rawPub)).toBe(true);
    pi += 32;
    // priv+pub seed (64)
    expect(privBlob.readUInt32BE(pi)).toBe(64);
    pi += 4;
    expect(privBlob.subarray(pi, pi + 32).equals(rawPriv)).toBe(true);
    expect(privBlob.subarray(pi + 32, pi + 64).equals(rawPub)).toBe(true);
    pi += 64;
    // comment
    const commentLen = privBlob.readUInt32BE(pi);
    pi += 4;
    expect(privBlob.subarray(pi, pi + commentLen).toString("utf8")).toBe("test");
    pi += commentLen;
    // padding to multiple of 8 with incrementing bytes
    let pad = 1;
    while (pi < privBlob.length) {
      expect(privBlob[pi]).toBe(pad);
      pi += 1;
      pad += 1;
    }
    expect(privBlob.length % 8).toBe(0);
  });

  it("encodeOpensshEd25519PrivateKey rejects malformed inputs", async () => {
    const mod = await import("../ssh-connection-service");
    expect(() =>
      mod.encodeOpensshEd25519PrivateKey(
        Buffer.alloc(31, 0),
        Buffer.alloc(32, 0),
        "x"
      )
    ).toThrow();
    expect(() =>
      mod.encodeOpensshEd25519PrivateKey(
        Buffer.alloc(32, 0),
        Buffer.alloc(33, 0),
        "x"
      )
    ).toThrow();
  });
});
