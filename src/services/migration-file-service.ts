/**
 * MigrationFileService — SOURCE-side archive builders + chunk reader + size
 * preview for server-to-server migration (stage 2: file transfer).
 *
 * Up to three gzipped tars are produced into a per-job staging directory:
 *   - "working-tree" (mode full_tar) — the whole working directory minus
 *     EXCLUDE_PATTERNS, or "essentials" (mode git_essentials) — .beads/,
 *     .env* files, untracked-but-not-ignored files, and a binary diff of
 *     uncommitted changes (destination re-clones from the recorded remote).
 *   - "profiles" — each linked profile's configDir laid out as
 *     `profiles/<sourceProfileId>/…` (destination re-maps via
 *     profileIdRemaps). `.cache` always excluded; `.ssh/` only with
 *     includeSshKeys.
 *   - "agent-settings" — a CURATED copy of host-level agent config from
 *     $HOME (claude/codex/gemini/opencode), credentials gated by
 *     includeAgentCreds.
 *
 * All subprocess calls go through src/lib/exec (execFile — argument arrays,
 * never shell interpolation), mirroring TarballInstallerImpl.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readlink,
  rm,
  stat,
  lstat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agentProfiles,
  nodePreferences,
  projectProfileLinks,
  projects,
} from "@/db/schema";
import { execFile, execFileNoThrow, execFileCapped } from "@/lib/exec";
import { getMigrationStagingDir } from "@/lib/paths";
import {
  CHUNK_SIZE_BYTES,
  EXCLUDE_PATTERNS,
  type ArchiveManifestEntry,
  type ArchiveName,
  type MigrationOptions,
} from "@/lib/migration-bundle";
import type { MigrationWorkingTreeMode } from "@/types/migration";
import { createLogger } from "@/lib/logger";

const log = createLogger("MigrationFiles");

/** Hard cap on the shipped uncommitted-diff size (skipped + warned beyond). */
const MAX_DIFF_BYTES = 32 * 1024 * 1024;

/** Result of building the file archives for one migration job. */
export interface BuiltArchives {
  /** Source-side staging directory holding the built tars (caller cleans up). */
  stagingDir: string;
  archives: ArchiveManifestEntry[];
  /** Absolute path of each built tar, keyed by archive name. */
  archivePaths: Partial<Record<ArchiveName, string>>;
  gitRemoteUrl: string | null;
  gitBranch: string | null;
  beadsIncluded: boolean;
  info: string[];
  warnings: string[];
}

export interface BuildArchivesInput {
  jobId: string;
  /** The project's defaultWorkingDirectory on this host (null = no tree). */
  workingDir: string | null;
  options: MigrationOptions;
  /** Linked profiles to ship: source id + source configDir. */
  profiles: Array<{ id: string; configDir: string }>;
}

/** sha256 (hex) of a file, streamed. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data: string | Buffer) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Number of CHUNK_SIZE_BYTES pieces a file of `sizeBytes` ships as (>= 1). */
export function chunkCountFor(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / CHUNK_SIZE_BYTES));
}

/**
 * Read chunk `index` (0-based) of a built archive. Returns a Buffer of up to
 * CHUNK_SIZE_BYTES (the final chunk is usually shorter).
 */
export async function readArchiveChunk(
  filePath: string,
  index: number,
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const position = index * CHUNK_SIZE_BYTES;
    const { size } = await handle.stat();
    const length = Math.max(0, Math.min(CHUNK_SIZE_BYTES, size - position));
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      await handle.read(buffer, 0, length, position);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

// tar exclusion args covering both GNU tar and bsdtar pattern semantics:
// the bare name, the any-depth form ("*<slash>name"), and its contents
// ("*<slash>name<slash>*").
function tarExcludeArgs(patterns: readonly string[]): string[] {
  const args: string[] = [];
  for (const pattern of patterns) {
    args.push("--exclude", pattern, "--exclude", `*/${pattern}`, "--exclude", `*/${pattern}/*`);
  }
  return args;
}

/** Create `outFile` (tar.gz) from `cwd`, optionally excluding patterns. */
async function tarCreate(
  outFile: string,
  cwd: string,
  excludePatterns: readonly string[] = [],
): Promise<void> {
  await execFile(
    "tar",
    ["-czf", outFile, ...tarExcludeArgs(excludePatterns), "-C", cwd, "."],
    { timeout: 10 * 60 * 1000 },
  );
}

/**
 * Recursive copy with a relative-path filter. Skips special files (sockets,
 * FIFOs) instead of failing — profile dirs can contain agent sockets.
 * Returns the number of FILES copied.
 */
export async function copyTree(
  src: string,
  dest: string,
  filter?: (relPath: string, isDirectory: boolean) => boolean,
  relBase = "",
): Promise<number> {
  await mkdir(dest, { recursive: true });
  let copied = 0;
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (filter && !filter(rel, entry.isDirectory())) continue;
    if (entry.isDirectory()) {
      copied += await copyTree(from, to, filter, rel);
    } else if (entry.isSymbolicLink()) {
      try {
        await symlink(await readlink(from), to);
        copied++;
      } catch {
        // Broken/duplicate symlink — skip rather than fail the archive.
      }
    } else if (entry.isFile()) {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      copied++;
    }
    // Sockets, FIFOs, devices: skipped.
  }
  return copied;
}

/** Copy one file preserving its relative path under `destRoot`. */
async function copyRelative(srcRoot: string, rel: string, destRoot: string): Promise<void> {
  const to = join(destRoot, rel);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(srcRoot, rel), to);
}

/** True when any path segment is one of the EXCLUDE_PATTERNS dirs. */
function isExcludedPath(relPath: string): boolean {
  const segments = relPath.split("/");
  return segments.some((s) => (EXCLUDE_PATTERNS as readonly string[]).includes(s));
}

/** Find every `.env*` FILE under `workingDir`, pruning excluded dirs. */
async function findDotEnvFiles(workingDir: string): Promise<string[]> {
  const pruneGroup: string[] = ["("];
  EXCLUDE_PATTERNS.forEach((p, i) => {
    if (i > 0) pruneGroup.push("-o");
    pruneGroup.push("-name", p);
  });
  pruneGroup.push(")");
  const result = await execFileNoThrow(
    "find",
    [".", "-type", "d", ...pruneGroup, "-prune", "-o", "-type", "f", "-name", ".env*", "-print"],
    { cwd: workingDir, timeout: 30_000 },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter((line) => line.length > 0 && !isExcludedPath(line));
}

/** Untracked-but-not-ignored files (`git ls-files --others --exclude-standard`). */
async function listUntrackedFiles(workingDir: string, cap = 10_000): Promise<string[]> {
  const result = await execFileCapped(
    "git",
    ["-C", workingDir, "ls-files", "-z", "--others", "--exclude-standard"],
    { timeout: 30_000, maxBytes: 8 * 1024 * 1024 },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\0")
    .filter((p) => p.length > 0 && !isExcludedPath(p))
    .slice(0, cap);
}

/** The host agent-settings base directories (shared by build + extract). */
export function agentSettingsDirs(): Record<"claude" | "codex" | "gemini" | "opencode", string> {
  const home = homedir();
  return {
    claude: process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codex: join(home, ".codex"),
    gemini: join(home, ".gemini"),
    opencode: join(home, ".config", "opencode"),
  };
}

/** Curated items copied per provider (dirs end with "/").  */
const CLAUDE_ITEMS = ["settings.json", "CLAUDE.md", "keybindings.json", "skills", "agents", "commands", "hooks"];
const CODEX_ITEMS = ["config.toml", "AGENTS.md"];
const CODEX_CRED_ITEMS = ["auth.json"];
const GEMINI_ITEMS = ["settings.json", "GEMINI.md", "ANTIGRAVITY.md", "config"];
const GEMINI_ALWAYS_EXCLUDE = new Set(["tmp", "antigravity-cli", "history"]);
const OPENCODE_EXCLUDE = new Set(["logs", "node_modules"]);
const INFO_CAP = 200;

/**
 * Stage the curated agent-settings copy under `stageRoot/agent-settings/…`.
 * Returns info strings describing what was included (capped).
 */
async function stageAgentSettings(
  stageRoot: string,
  includeAgentCreds: boolean,
): Promise<{ staged: boolean; info: string[] }> {
  const dirs = agentSettingsDirs();
  const info: string[] = [];
  let total = 0;

  const note = (provider: string, item: string) => {
    total++;
    if (info.length < INFO_CAP) info.push(`agent-settings: ${provider}/${item}`);
  };

  const copyItem = async (
    provider: string,
    base: string,
    item: string,
    filter?: (rel: string, isDir: boolean) => boolean,
  ): Promise<void> => {
    const src = join(base, item);
    if (!existsSync(src)) return;
    const dest = join(stageRoot, "agent-settings", provider, item);
    const s = await lstat(src);
    if (s.isDirectory()) {
      const copied = await copyTree(src, dest, filter);
      if (copied > 0) note(provider, `${item}/`);
      else await rm(dest, { recursive: true, force: true });
    } else if (s.isFile()) {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      note(provider, item);
    }
  };

  // claude — curated allowlist only.
  for (const item of CLAUDE_ITEMS) {
    await copyItem("claude", dirs.claude, item, (rel, isDir) => {
      void isDir;
      return !isExcludedPath(rel);
    });
  }

  // codex — config + docs, auth only with creds.
  for (const item of [...CODEX_ITEMS, ...(includeAgentCreds ? CODEX_CRED_ITEMS : [])]) {
    await copyItem("codex", dirs.codex, item);
  }

  // gemini — curated set + cred globs, ALWAYS excluding tmp/antigravity-cli/history.
  const geminiFilter = (rel: string) => {
    const top = rel.split("/")[0];
    return !GEMINI_ALWAYS_EXCLUDE.has(top);
  };
  for (const item of GEMINI_ITEMS) {
    await copyItem("gemini", dirs.gemini, item, geminiFilter);
  }
  if (includeAgentCreds && existsSync(dirs.gemini)) {
    const entries = await readdir(dirs.gemini, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (/^oauth_creds.*\.json$/.test(entry.name) || /^access_token/.test(entry.name)) {
        await copyItem("gemini", dirs.gemini, entry.name);
      }
    }
  }

  // opencode — everything except logs/ and node_modules.
  if (existsSync(dirs.opencode)) {
    const dest = join(stageRoot, "agent-settings", "opencode");
    const copied = await copyTree(dirs.opencode, dest, (rel) => {
      const top = rel.split("/")[0];
      return !OPENCODE_EXCLUDE.has(top) && !rel.split("/").includes("node_modules");
    });
    if (copied > 0) note("opencode", `(${copied} files)`);
    else await rm(dest, { recursive: true, force: true });
  }

  if (total > info.length) {
    info.push(`agent-settings: +${total - info.length} more items`);
  }
  return { staged: total > 0, info };
}

/** Stage the git_essentials content for `workingDir` under `stageRoot`. */
async function stageEssentials(
  workingDir: string,
  stageRoot: string,
  options: MigrationOptions,
  warnings: string[],
): Promise<{ beadsIncluded: boolean }> {
  // .beads/ — the project's issue database travels whole.
  let beadsIncluded = false;
  const beadsDir = join(workingDir, ".beads");
  if (existsSync(beadsDir)) {
    await copyTree(beadsDir, join(stageRoot, ".beads"));
    beadsIncluded = true;
  }

  const shipped = new Set<string>();
  const isDotEnv = (rel: string) => basename(rel).startsWith(".env");

  // .env* files (gated): usually gitignored, so the explicit find is what
  // ships them at all.
  if (options.includeDotEnv) {
    for (const rel of await findDotEnvFiles(workingDir)) {
      await copyRelative(workingDir, rel, stageRoot);
      shipped.add(rel);
    }
  }

  // Untracked-but-not-ignored files. The includeDotEnv toggle WINS here too:
  // a repo without a .gitignore reports .env* as untracked, and the opt-out
  // must not be bypassable through that path.
  for (const rel of await listUntrackedFiles(workingDir)) {
    if (shipped.has(rel)) continue;
    if (!options.includeDotEnv && isDotEnv(rel)) continue;
    try {
      await copyRelative(workingDir, rel, stageRoot);
      shipped.add(rel);
    } catch (error) {
      warnings.push(`Could not stage untracked file ${rel}: ${String(error)}`);
    }
  }

  // Uncommitted changes to tracked files, as a binary diff.
  const diff = await execFileCapped(
    "git",
    ["-C", workingDir, "diff", "HEAD", "--binary"],
    { timeout: 60_000, maxBytes: MAX_DIFF_BYTES },
  );
  if (diff.exitCode !== 0) {
    warnings.push("Could not compute uncommitted diff (no HEAD?) — not shipped");
  } else if (diff.truncated) {
    warnings.push(
      `Uncommitted diff exceeds ${MAX_DIFF_BYTES} bytes — not shipped (commit or stash first)`,
    );
  } else if (diff.stdout.length > 0) {
    await writeFile(join(stageRoot, "migration.diff"), diff.stdout, "utf8");
  }

  return { beadsIncluded };
}

/** Resolve the git remote + branch for essentials mode (remote REQUIRED). */
async function resolveGitOrigin(
  workingDir: string,
): Promise<{ gitRemoteUrl: string; gitBranch: string | null }> {
  const remote = await execFileNoThrow(
    "git",
    ["-C", workingDir, "remote", "get-url", "origin"],
    { timeout: 10_000 },
  );
  if (remote.exitCode !== 0 || !remote.stdout.trim()) {
    throw new Error(
      "git_essentials mode requires a git remote named 'origin' (destination re-clones from it)",
    );
  }
  const branch = await execFileNoThrow(
    "git",
    ["-C", workingDir, "rev-parse", "--abbrev-ref", "HEAD"],
    { timeout: 10_000 },
  );
  return {
    gitRemoteUrl: remote.stdout.trim(),
    gitBranch: branch.exitCode === 0 ? branch.stdout.trim() : null,
  };
}

/** Tar a built stage dir and describe it for the manifest. */
async function packArchive(
  name: ArchiveName,
  contentDir: string,
  stagingDir: string,
  excludePatterns: readonly string[] = [],
): Promise<{ entry: ArchiveManifestEntry; path: string }> {
  const outFile = join(stagingDir, `${name}.tar.gz`);
  await tarCreate(outFile, contentDir, excludePatterns);
  const { size } = await stat(outFile);
  return {
    entry: {
      name,
      sizeBytes: size,
      sha256: await sha256File(outFile),
      chunkCount: chunkCountFor(size),
    },
    path: outFile,
  };
}

/**
 * Build all file archives for a migration job into a fresh source-side
 * staging dir (`<migration-staging>/export-<jobId>`). The caller is
 * responsible for removing the staging dir when the job ends.
 */
export async function buildArchives(input: BuildArchivesInput): Promise<BuiltArchives> {
  const stagingDir = join(getMigrationStagingDir(), `export-${input.jobId}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const archives: ArchiveManifestEntry[] = [];
  const archivePaths: Partial<Record<ArchiveName, string>> = {};
  const warnings: string[] = [];
  const info: string[] = [];
  let gitRemoteUrl: string | null = null;
  let gitBranch: string | null = null;
  let beadsIncluded = false;

  // ── Working tree (full_tar) or essentials (git_essentials) ──
  if (input.options.workingTreeMode !== "none") {
    if (!input.workingDir) {
      warnings.push("Project has no working directory — no working-tree archive shipped");
    } else if (!existsSync(input.workingDir)) {
      warnings.push(
        `Working directory ${input.workingDir} does not exist — no working-tree archive shipped`,
      );
    } else if (input.options.workingTreeMode === "full_tar") {
      beadsIncluded = existsSync(join(input.workingDir, ".beads"));
      const built = await packArchive(
        "working-tree",
        input.workingDir,
        stagingDir,
        EXCLUDE_PATTERNS,
      );
      archives.push(built.entry);
      archivePaths["working-tree"] = built.path;
    } else {
      // git_essentials: destination clones; we ship only what clone can't recover.
      const origin = await resolveGitOrigin(input.workingDir);
      gitRemoteUrl = origin.gitRemoteUrl;
      gitBranch = origin.gitBranch;
      const stage = join(stagingDir, "essentials-stage");
      await mkdir(stage, { recursive: true });
      const staged = await stageEssentials(input.workingDir, stage, input.options, warnings);
      beadsIncluded = staged.beadsIncluded;
      const built = await packArchive("essentials", stage, stagingDir);
      archives.push(built.entry);
      archivePaths.essentials = built.path;
      await rm(stage, { recursive: true, force: true });
    }
  }

  // ── Profiles ──
  const presentProfiles = input.profiles.filter((p) => {
    if (existsSync(p.configDir)) return true;
    warnings.push(`Profile config dir ${p.configDir} does not exist — profile files not shipped`);
    return false;
  });
  if (presentProfiles.length > 0) {
    const stage = join(stagingDir, "profiles-stage");
    for (const profile of presentProfiles) {
      await copyTree(
        profile.configDir,
        join(stage, "profiles", profile.id),
        (rel, isDir) => {
          const top = rel.split("/")[0];
          if (top === ".cache") return false;
          if (top === ".ssh" && !input.options.includeSshKeys) return false;
          void isDir;
          return true;
        },
      );
    }
    const built = await packArchive("profiles", stage, stagingDir);
    archives.push(built.entry);
    archivePaths.profiles = built.path;
    await rm(stage, { recursive: true, force: true });
  }

  // ── Host agent settings (curated) ──
  if (input.options.includeAgentSettings) {
    const stage = join(stagingDir, "agent-settings-stage");
    await mkdir(stage, { recursive: true });
    const staged = await stageAgentSettings(stage, input.options.includeAgentCreds);
    if (staged.staged) {
      info.push(...staged.info);
      const built = await packArchive("agent-settings", stage, stagingDir);
      archives.push(built.entry);
      archivePaths["agent-settings"] = built.path;
    }
    await rm(stage, { recursive: true, force: true });
  }

  log.info("Migration archives built", {
    jobId: input.jobId,
    archives: archives.map((a) => `${a.name}:${a.sizeBytes}b/${a.chunkCount}ck`),
    warnings: warnings.length,
  });

  return { stagingDir, archives, archivePaths, gitRemoteUrl, gitBranch, beadsIncluded, info, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Size preview (estimates — `du` disk usage, not compressed transfer size).
// ─────────────────────────────────────────────────────────────────────────────

export interface SizePreview {
  workingTreeBytes: number;
  profilesBytes: number;
  agentSettingsBytes: number;
  totalBytes: number;
  warning?: string;
}

/** `du -sk <path>` → bytes (0 on failure/timeout). */
async function duBytes(path: string, timeoutMs = 1500): Promise<number> {
  if (!existsSync(path)) return 0;
  const result = await execFileNoThrow("du", ["-sk", path], { timeout: timeoutMs });
  // du exits non-zero on permission errors but still prints a usable total.
  const kb = Number.parseInt(result.stdout.split(/\s+/)[0] ?? "", 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

/** Sum of `du` over the EXCLUDE_PATTERNS dirs found in `root` (pruned find). */
async function excludedBytes(root: string): Promise<number> {
  const group: string[] = ["("];
  EXCLUDE_PATTERNS.forEach((p, i) => {
    if (i > 0) group.push("-o");
    group.push("-name", p);
  });
  group.push(")");
  const found = await execFileNoThrow(
    "find",
    [root, "-type", "d", ...group, "-prune", "-print"],
    { timeout: 1500 },
  );
  if (found.exitCode !== 0 && !found.stdout) return 0;
  const dirs = found.stdout.split("\n").filter((d) => d.trim().length > 0).slice(0, 25);
  let total = 0;
  for (const dir of dirs) {
    total += await duBytes(dir, 1200);
  }
  return total;
}

/** Estimate the git_essentials payload (beads + untracked + env files). */
async function essentialsBytes(workingDir: string, includeDotEnv: boolean): Promise<number> {
  let total = await duBytes(join(workingDir, ".beads"));
  const files = new Set(await listUntrackedFiles(workingDir));
  if (includeDotEnv) {
    for (const rel of await findDotEnvFiles(workingDir)) files.add(rel);
  }
  for (const rel of files) {
    try {
      total += (await stat(join(workingDir, rel))).size;
    } catch {
      // Disappeared mid-scan — ignore.
    }
  }
  return total;
}

/**
 * Estimate the transfer size for a migration (uncompressed `du`-based, so an
 * over-estimate of the gzipped wire size). Bounded to ~2s — on any failure or
 * timeout it returns zeros plus a warning rather than erroring.
 */
export async function sizePreview(
  userId: string,
  projectId: string,
  workingTreeMode: MigrationWorkingTreeMode,
  includeDotEnv = true,
): Promise<SizePreview> {
  const compute = async (): Promise<SizePreview> => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
    });
    if (!project) throw new Error("Project not found");

    const pref = await db.query.nodePreferences.findFirst({
      where: and(
        eq(nodePreferences.ownerId, projectId),
        eq(nodePreferences.ownerType, "project"),
        eq(nodePreferences.userId, userId),
      ),
    });
    const workingDir = pref?.defaultWorkingDirectory ?? null;

    let workingTreeBytes = 0;
    if (workingDir && existsSync(workingDir)) {
      if (workingTreeMode === "full_tar") {
        const total = await duBytes(workingDir);
        workingTreeBytes = Math.max(0, total - (await excludedBytes(workingDir)));
      } else if (workingTreeMode === "git_essentials") {
        workingTreeBytes = await essentialsBytes(workingDir, includeDotEnv);
      }
    }

    let profilesBytes = 0;
    const link = await db.query.projectProfileLinks.findFirst({
      where: eq(projectProfileLinks.projectId, projectId),
    });
    if (link) {
      const profile = await db.query.agentProfiles.findFirst({
        where: and(eq(agentProfiles.id, link.profileId), eq(agentProfiles.userId, userId)),
      });
      if (profile) profilesBytes = await duBytes(profile.configDir);
    }

    let agentSettingsBytes = 0;
    const dirs = agentSettingsDirs();
    for (const [provider, base] of Object.entries(dirs)) {
      const items =
        provider === "claude"
          ? CLAUDE_ITEMS
          : provider === "codex"
            ? [...CODEX_ITEMS, ...CODEX_CRED_ITEMS]
            : provider === "gemini"
              ? GEMINI_ITEMS
              : ["."];
      for (const item of items) {
        agentSettingsBytes += await duBytes(join(base, item), 800);
      }
    }

    return {
      workingTreeBytes,
      profilesBytes,
      agentSettingsBytes,
      totalBytes: workingTreeBytes + profilesBytes + agentSettingsBytes,
    };
  };

  const timeout = new Promise<SizePreview>((resolve) =>
    setTimeout(
      () =>
        resolve({
          workingTreeBytes: 0,
          profilesBytes: 0,
          agentSettingsBytes: 0,
          totalBytes: 0,
          warning: "Size estimate timed out — the tree may be very large",
        }),
      2000,
    ),
  );

  try {
    const result = await Promise.race([compute(), timeout]);
    return result;
  } catch (error) {
    if (String(error).includes("Project not found")) throw error;
    log.warn("Size preview failed", { projectId, error: String(error) });
    return {
      workingTreeBytes: 0,
      profilesBytes: 0,
      agentSettingsBytes: 0,
      totalBytes: 0,
      warning: `Size estimate unavailable: ${String(error)}`,
    };
  }
}
