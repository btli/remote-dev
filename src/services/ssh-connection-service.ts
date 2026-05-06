/**
 * SshConnectionService — CRUD + on-disk asset management for saved SSH
 * connections used by the `ssh` terminal type.
 *
 * Each connection owns a directory under `~/.remote-dev/ssh/{id}/` that may
 * contain a private key (`id`, mode 0600), public key (`id.pub`, mode 0644),
 * and a per-connection `known_hosts` file. The directory itself is created
 * with mode 0700.
 *
 * Passphrases are intentionally NOT stored on disk or in the DB. When a key
 * is passphrase-protected OpenSSH prompts the user inside the terminal at
 * connect time. The DB's `has_passphrase` column is a UI hint only.
 *
 * @see src/lib/terminal-plugins/plugins/ssh-plugin-server.ts
 */

import { mkdir, writeFile, readFile, rm, access, chmod } from "node:fs/promises";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { db } from "@/db";
import { sshConnections } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { encrypt, decryptSafe } from "@/lib/encryption";
import { getSshConnectionsDir } from "@/lib/paths";
import { execFileNoThrow } from "@/lib/exec";
import { createLogger } from "@/lib/logger";

const log = createLogger("SshConnectionService");

export type SshAuthType = "key" | "agent" | "password" | "system";
export type SshKnownHostsPolicy = "strict" | "accept-new" | "no";

export interface SshConnection {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasPassphrase: boolean;
  passwordEnc: string | null;
  knownHostsPolicy: SshKnownHostsPolicy;
  extraOptions: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

export interface CreateSshConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: SshAuthType;
  /** Plaintext password (will be encrypted at rest). Only valid for `password` auth. */
  password?: string;
  hasPassphrase?: boolean;
  knownHostsPolicy?: SshKnownHostsPolicy;
  extraOptions?: string[];
  projectId?: string | null;
}

export interface UpdateSshConnectionInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: SshAuthType;
  /** Plaintext password (will be encrypted at rest). Pass `null` to clear. */
  password?: string | null;
  hasPassphrase?: boolean;
  knownHostsPolicy?: SshKnownHostsPolicy;
  extraOptions?: string[] | null;
  projectId?: string | null;
}

export class SshConnectionServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SshConnectionServiceError";
  }
}

function rowToConnection(row: typeof sshConnections.$inferSelect): SshConnection {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    hasPassphrase: row.hasPassphrase,
    passwordEnc: row.passwordEnc,
    knownHostsPolicy: row.knownHostsPolicy,
    extraOptions: (row.extraOptions as string[] | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * SSH options we never let users smuggle in via `extraOptions`. These would
 * let a saved connection execute arbitrary commands on the local machine
 * (ProxyCommand, LocalCommand) or pull config from an attacker-controlled
 * file (-F). We refuse them at write time so the on-disk state is always
 * safe to launch.
 */
const FORBIDDEN_OPTION_PATTERNS = [
  /ProxyCommand/i,
  /LocalCommand/i,
  /PermitLocalCommand/i,
  /\bMatch\b/i,
];

function validateExtraOptions(
  options: string[] | null | undefined
): void {
  if (!options) return;
  for (const opt of options) {
    if (typeof opt !== "string") {
      throw new SshConnectionServiceError(
        `Invalid extraOptions entry: ${typeof opt}`,
        "INVALID_INPUT"
      );
    }
    if (opt.length > 256) {
      throw new SshConnectionServiceError(
        "extraOptions entry exceeds 256 chars",
        "INVALID_INPUT"
      );
    }
    if (opt.includes("\0") || opt.includes("\n")) {
      throw new SshConnectionServiceError(
        "extraOptions entry contains illegal characters",
        "INVALID_INPUT"
      );
    }
    // Reject `-F /path/to/config` (alternate config file). We accept both
    // "-F" as its own token and "-Fsomething" since OpenSSH parses both.
    if (opt === "-F" || opt.startsWith("-F")) {
      throw new SshConnectionServiceError(
        `extraOptions entry references blocked SSH option: ${opt}`,
        "INVALID_INPUT"
      );
    }
    for (const pattern of FORBIDDEN_OPTION_PATTERNS) {
      if (pattern.test(opt)) {
        throw new SshConnectionServiceError(
          `extraOptions entry references blocked SSH option: ${opt}`,
          "INVALID_INPUT"
        );
      }
    }
  }
}

/**
 * Filesystem path for a connection's per-connection assets directory.
 *
 * Guards against path-traversal — `connectionId` comes from the DB in
 * normal use but several public helpers accept a raw id, so we resolve
 * the result and verify it stays inside the SSH base dir.
 */
export function getConnectionDir(connectionId: string): string {
  const baseDir = resolve(getSshConnectionsDir());
  const target = resolve(baseDir, connectionId);
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    throw new SshConnectionServiceError(
      `Invalid connection id: ${connectionId}`,
      "INVALID_INPUT"
    );
  }
  return target;
}

/** Path to the private key inside the connection's directory. */
export function getPrivateKeyPath(connectionId: string): string {
  return join(getConnectionDir(connectionId), "id");
}

/** Path to the public key inside the connection's directory. */
export function getPublicKeyPath(connectionId: string): string {
  return join(getConnectionDir(connectionId), "id.pub");
}

/** Path to the per-connection known_hosts file. */
export function getKnownHostsPath(connectionId: string): string {
  return join(getConnectionDir(connectionId), "known_hosts");
}

async function ensureConnectionDir(connectionId: string): Promise<string> {
  const dir = getConnectionDir(connectionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask; force the perm explicitly so the
  // directory is always 0700 regardless of the caller's umask.
  await chmod(dir, 0o700);
  return dir;
}

async function deleteConnectionDir(connectionId: string): Promise<void> {
  await rm(getConnectionDir(connectionId), { recursive: true, force: true });
}

/**
 * Detect whether sshpass is available on PATH. Cached per-process.
 */
let sshpassAvailableCache: boolean | null = null;
export async function isSshpassAvailable(): Promise<boolean> {
  if (sshpassAvailableCache !== null) return sshpassAvailableCache;
  // `which` is POSIX-portable enough for our supported platforms (mac/linux).
  const result = await execFileNoThrow("which", ["sshpass"]);
  sshpassAvailableCache = result.exitCode === 0 && Boolean(result.stdout.trim());
  return sshpassAvailableCache;
}

/** Reset cache — useful for tests. */
export function _resetSshpassCache(): void {
  sshpassAvailableCache = null;
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * List SSH connections owned by the user, with a tri-state project filter:
 *
 *   - `projectId: undefined` → all of the user's connections
 *   - `projectId: <string>`  → only those bound to that project
 *   - `projectId: null`      → only user-level (unbound) connections
 */
export async function list(opts: {
  userId: string;
  projectId?: string | null;
}): Promise<SshConnection[]> {
  const conditions = [eq(sshConnections.userId, opts.userId)];
  if (opts.projectId === null) {
    conditions.push(isNull(sshConnections.projectId));
  } else if (typeof opts.projectId === "string") {
    conditions.push(eq(sshConnections.projectId, opts.projectId));
  }

  const rows = await db
    .select()
    .from(sshConnections)
    .where(and(...conditions))
    .orderBy(desc(sshConnections.lastUsedAt), desc(sshConnections.updatedAt));

  return rows.map(rowToConnection);
}

export async function get(id: string, userId: string): Promise<SshConnection | null> {
  const rows = await db
    .select()
    .from(sshConnections)
    .where(and(eq(sshConnections.id, id), eq(sshConnections.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToConnection(rows[0]);
}

export async function create(
  userId: string,
  input: CreateSshConnectionInput
): Promise<SshConnection> {
  if (!input.name?.trim()) {
    throw new SshConnectionServiceError("Connection name is required", "NAME_REQUIRED");
  }
  if (!input.host?.trim()) {
    throw new SshConnectionServiceError("Host is required", "HOST_REQUIRED");
  }
  if (!input.username?.trim()) {
    throw new SshConnectionServiceError("Username is required", "USERNAME_REQUIRED");
  }
  const port = input.port ?? 22;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new SshConnectionServiceError("Port must be 1-65535", "INVALID_PORT");
  }

  if (input.authType === "password") {
    if (!input.password) {
      throw new SshConnectionServiceError(
        "Password is required for password auth",
        "PASSWORD_REQUIRED"
      );
    }
    const sshpassOk = await isSshpassAvailable();
    if (!sshpassOk) {
      throw new SshConnectionServiceError(
        "Password auth requires `sshpass` to be installed on PATH. Install via `brew install sshpass` (macOS) or your distro's package manager (Linux).",
        "SSHPASS_MISSING"
      );
    }
  }

  validateExtraOptions(input.extraOptions);

  // The schema's $defaultFn handles id generation, but we need the id
  // on this side of the insert to create the assets directory and
  // build the return value.
  const id = crypto.randomUUID();
  const now = new Date();

  await ensureConnectionDir(id);

  const row = {
    id,
    userId,
    projectId: input.projectId ?? null,
    name: input.name.trim(),
    host: input.host.trim(),
    port,
    username: input.username.trim(),
    authType: input.authType,
    hasPassphrase: input.hasPassphrase ?? false,
    passwordEnc: input.password ? encrypt(input.password) : null,
    knownHostsPolicy: input.knownHostsPolicy ?? ("accept-new" as const),
    extraOptions: input.extraOptions && input.extraOptions.length > 0 ? input.extraOptions : null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };

  await db.insert(sshConnections).values(row);

  log.info("Created SSH connection", { id, userId, host: input.host, authType: input.authType });

  return rowToConnection(row as typeof sshConnections.$inferSelect);
}

export async function update(
  id: string,
  userId: string,
  patch: UpdateSshConnectionInput
): Promise<SshConnection> {
  const existing = await get(id, userId);
  if (!existing) {
    throw new SshConnectionServiceError("Connection not found", "NOT_FOUND");
  }

  if (patch.extraOptions !== undefined) {
    validateExtraOptions(patch.extraOptions);
  }

  // Validate authType change against sshpass when switching to password.
  const nextAuthType = patch.authType ?? existing.authType;
  if (nextAuthType === "password") {
    const incomingPwd = patch.password ?? null;
    const hasExistingPwd = !!existing.passwordEnc;
    if (!hasExistingPwd && !incomingPwd) {
      throw new SshConnectionServiceError(
        "Password is required when authType is 'password'",
        "PASSWORD_REQUIRED"
      );
    }
    if (incomingPwd) {
      const sshpassOk = await isSshpassAvailable();
      if (!sshpassOk) {
        throw new SshConnectionServiceError(
          "Password auth requires `sshpass` to be installed on PATH",
          "SSHPASS_MISSING"
        );
      }
    }
  }

  const updates: Partial<typeof sshConnections.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.host !== undefined) updates.host = patch.host;
  if (patch.port !== undefined) updates.port = patch.port;
  if (patch.username !== undefined) updates.username = patch.username;
  if (patch.authType !== undefined) updates.authType = patch.authType;
  if (patch.hasPassphrase !== undefined) updates.hasPassphrase = patch.hasPassphrase;
  if (patch.knownHostsPolicy !== undefined) updates.knownHostsPolicy = patch.knownHostsPolicy;
  if (patch.extraOptions !== undefined) {
    updates.extraOptions = patch.extraOptions && patch.extraOptions.length > 0 ? patch.extraOptions : null;
  }
  if (patch.projectId !== undefined) updates.projectId = patch.projectId;
  if (patch.password !== undefined) {
    updates.passwordEnc = patch.password ? encrypt(patch.password) : null;
  }

  await db
    .update(sshConnections)
    .set(updates)
    .where(and(eq(sshConnections.id, id), eq(sshConnections.userId, userId)));

  const refreshed = await get(id, userId);
  if (!refreshed) {
    throw new SshConnectionServiceError("Connection not found after update", "NOT_FOUND");
  }
  return refreshed;
}

export async function remove(id: string, userId: string): Promise<void> {
  const existing = await get(id, userId);
  if (!existing) {
    throw new SshConnectionServiceError("Connection not found", "NOT_FOUND");
  }
  await db
    .delete(sshConnections)
    .where(and(eq(sshConnections.id, id), eq(sshConnections.userId, userId)));
  await deleteConnectionDir(id);
  log.info("Deleted SSH connection", { id, userId });
}

export async function markUsed(id: string): Promise<void> {
  await db
    .update(sshConnections)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(sshConnections.id, id));
}

/**
 * Decrypt and return the stored password for a connection. Returns `null`
 * if no password is stored. Used by the SSH plugin server when launching
 * via sshpass.
 */
export function getDecryptedPassword(connection: SshConnection): string | null {
  if (!connection.passwordEnc) return null;
  return decryptSafe(connection.passwordEnc);
}

// ============================================================================
// Filesystem helpers
// ============================================================================

/**
 * Write a private key to disk for the given connection. Sets permissions
 * to 0600 and writes the (optional) public key sibling at 0644.
 */
export async function writeKey(
  connectionId: string,
  privateKey: string,
  publicKey?: string
): Promise<void> {
  await ensureConnectionDir(connectionId);
  const privPath = getPrivateKeyPath(connectionId);
  const normalized = privateKey.endsWith("\n") ? privateKey : privateKey + "\n";
  await writeFile(privPath, normalized, { mode: 0o600 });
  await chmod(privPath, 0o600);
  if (publicKey) {
    const pubPath = getPublicKeyPath(connectionId);
    const pubNormalized = publicKey.endsWith("\n") ? publicKey : publicKey + "\n";
    await writeFile(pubPath, pubNormalized, { mode: 0o644 });
    await chmod(pubPath, 0o644);
  }
}

/**
 * Generate a new ed25519 keypair, write both halves to disk, and return
 * the public key for display in the UI.
 *
 * The private key is emitted in the native OpenSSH private-key format
 * (`-----BEGIN OPENSSH PRIVATE KEY-----`). PKCS#8 PEM is *not* loadable by
 * `ssh-keygen`/`ssh` for ed25519 keys despite the OpenSSL key APIs
 * supporting it — OpenSSH refuses anything that isn't its own wire format.
 */
export async function generateKeypair(connectionId: string): Promise<{
  publicKey: string;
}> {
  await ensureConnectionDir(connectionId);

  // Use the KeyObject form so we can JWK-export to grab the raw 32-byte
  // private seed and 32-byte public key. node:crypto has no built-in
  // OpenSSH-format private-key encoder, so we hand-pack the bytes below.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const privJwk = privateKey.export({ format: "jwk" }) as {
    d?: string;
    x?: string;
  };
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!privJwk.d || !privJwk.x || !pubJwk.x) {
    throw new Error("Unexpected ed25519 JWK shape (missing d/x)");
  }
  const rawPriv = Buffer.from(privJwk.d, "base64url");
  const rawPub = Buffer.from(pubJwk.x, "base64url");
  if (rawPriv.length !== 32 || rawPub.length !== 32) {
    throw new Error(
      `Invalid ed25519 raw key lengths: priv=${rawPriv.length} pub=${rawPub.length}`
    );
  }

  const comment = `rdv-${connectionId.slice(0, 8)}`;
  const opensshPubLine = `${encodeOpensshEd25519PublicKey(rawPub)} ${comment}`;
  const opensshPriv = encodeOpensshEd25519PrivateKey(rawPriv, rawPub, comment);

  await writeKey(connectionId, opensshPriv, opensshPubLine);
  return { publicKey: opensshPubLine };
}

// ---------------------------------------------------------------------------
// OpenSSH wire-format encoders for ed25519 keys.
//
// Reference: PROTOCOL.key in the OpenSSH source tree.
// All integers are big-endian; `string` is `uint32 length || bytes`.
// ---------------------------------------------------------------------------

function packUint32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function packString(buf: Buffer): Buffer {
  return Buffer.concat([packUint32(buf.length), buf]);
}

/**
 * Encode a raw 32-byte ed25519 public key as the OpenSSH single-line
 * `ssh-ed25519 BASE64` representation (no trailing comment).
 */
export function encodeOpensshEd25519PublicKey(rawPub: Buffer): string {
  if (rawPub.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${rawPub.length}`);
  }
  const wire = Buffer.concat([
    packString(Buffer.from("ssh-ed25519", "utf8")),
    packString(rawPub),
  ]);
  return `ssh-ed25519 ${wire.toString("base64")}`;
}

/**
 * Encode a raw ed25519 private + public seed pair as the OpenSSH
 * native private-key PEM (`-----BEGIN OPENSSH PRIVATE KEY-----`).
 *
 * Cipher and KDF are `none` (no passphrase). The base64 body is wrapped
 * at 70 columns to match `ssh-keygen` output. Result ends with a newline.
 */
export function encodeOpensshEd25519PrivateKey(
  rawPriv: Buffer,
  rawPub: Buffer,
  comment: string
): string {
  if (rawPriv.length !== 32) {
    throw new Error(`ed25519 private seed must be 32 bytes, got ${rawPriv.length}`);
  }
  if (rawPub.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${rawPub.length}`);
  }

  // Public key blob (length-prefixed, then packed as a string at the outer
  // layer when assembled into the file).
  const pubBlob = Buffer.concat([
    packString(Buffer.from("ssh-ed25519", "utf8")),
    packString(rawPub),
  ]);

  // Private key blob (cleartext because cipher=none): two equal checkints,
  // then key type, public key, concatenated private+public seed, comment,
  // and incrementing padding to a multiple of 8.
  const checkint = randomBytes(4);
  const privSeed = Buffer.concat([rawPriv, rawPub]); // 64 bytes
  const commentBuf = Buffer.from(comment, "utf8");
  const inner = Buffer.concat([
    checkint,
    checkint,
    packString(Buffer.from("ssh-ed25519", "utf8")),
    packString(rawPub),
    packString(privSeed),
    packString(commentBuf),
  ]);
  const padLen = (8 - (inner.length % 8)) % 8;
  const padding = Buffer.alloc(padLen);
  for (let i = 0; i < padLen; i++) padding[i] = i + 1; // 1, 2, 3, ...
  const paddedPriv = Buffer.concat([inner, padding]);

  // Outer file: magic, ciphername, kdfname, kdfoptions, numkeys, pubkey,
  // padded privatekey.
  const magic = Buffer.from("openssh-key-v1\0", "utf8"); // 15 bytes incl. NUL
  const file = Buffer.concat([
    magic,
    packString(Buffer.from("none", "utf8")), // ciphername
    packString(Buffer.from("none", "utf8")), // kdfname
    packString(Buffer.alloc(0)), // kdfoptions (empty string)
    packUint32(1), // numkeys
    packString(pubBlob),
    packString(paddedPriv),
  ]);

  const b64 = file.toString("base64");
  // ssh-keygen wraps the body at 70 columns.
  const wrapped = b64.match(/.{1,70}/g)?.join("\n") ?? b64;
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** Read a connection's public key, if present. */
export async function readPublicKey(connectionId: string): Promise<string | null> {
  try {
    const buf = await readFile(getPublicKeyPath(connectionId), "utf8");
    return buf.trim();
  } catch {
    return null;
  }
}

/** Whether the on-disk private key file exists for this connection. */
export async function hasPrivateKey(connectionId: string): Promise<boolean> {
  try {
    await access(getPrivateKeyPath(connectionId));
    return true;
  } catch {
    return false;
  }
}

// Re-export filesystem helpers under the canonical names referenced in the
// design doc. These are convenience aliases — internal code uses the
// individual functions directly.
export {
  deleteConnectionDir,
};
