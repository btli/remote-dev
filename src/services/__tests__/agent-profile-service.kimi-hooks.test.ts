// @vitest-environment node
/**
 * Tests for the Kimi Code hook installer in agent-profile-service.
 *
 * Kimi reads lifecycle hooks from the `[[hooks]]` array of
 * `<kimi-home>/config.toml`. The writer must:
 *   - append rdv-managed blocks for all 12 lifecycle events,
 *   - preserve user-authored [[hooks]] rules and all other content verbatim,
 *   - be idempotent across reinstalls (byte-identical second run),
 *   - leave malformed/unexpected content untouched,
 *   - skip the write entirely when nothing would change,
 *   - write atomically (tmp + rename) with a per-invocation unique tmp path,
 *   - preserve the existing config.toml mode through a rewrite (it can hold
 *     an API key) and default a new file to 0600,
 *   - only use Kimi's allowed fields (event, matcher, command, timeout).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile as realWriteFile, rm, stat, chmod as realChmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The service module pulls in drizzle; the kimi hook path never touches the db.
vi.mock("@/db", () => ({
  db: {
    update: vi.fn(),
    delete: vi.fn(),
    query: {},
  },
}));

// Spy on fs writes so the no-op detection test can observe skipped writes
// while still operating on a real temp directory.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

import { writeFile, rename } from "node:fs/promises";
import { installAgentHooks } from "../agent-profile-service";

const KIMI_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "SubagentStart",
  "SubagentStop",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "Stop",
  "StopFailure",
  "Interrupt",
  "SessionEnd",
] as const;

const KIMI_RDV_EVENTS: Record<string, string> = {
  SessionStart: "session-start",
  UserPromptSubmit: "prompt-submit",
  PreToolUse: "pre-tool-use",
  SubagentStart: "subagent-start",
  SubagentStop: "subagent-stop",
  PermissionRequest: "permission-request",
  PreCompact: "compacting",
  PostCompact: "running",
  Stop: "stop",
  StopFailure: "stop-failure",
  Interrupt: "interrupt",
  SessionEnd: "session-end",
};

let kimiHome: string;
let configPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  kimiHome = await mkdtemp(join(tmpdir(), "rdv-kimi-hooks-"));
  configPath = join(kimiHome, "config.toml");
});

afterEach(async () => {
  await rm(kimiHome, { recursive: true, force: true });
});

describe("installAgentHooks — kimi config.toml writer", () => {
  it("creates config.toml with managed blocks for all 12 lifecycle events", async () => {
    await installAgentHooks(kimiHome, "kimi");

    const content = await readFile(configPath, "utf-8");

    // One [[hooks]] table per event, each preceded by the managed header.
    expect(content.match(/^# rdv-managed$/gm)).toHaveLength(12);
    expect(content.match(/^\[\[hooks\]\]$/gm)).toHaveLength(12);

    for (const event of KIMI_EVENTS) {
      expect(content).toContain(`event = "${event}"`);
      expect(content).toContain(`rdv hook kimi ${KIMI_RDV_EVENTS[event]}`);
    }

    // rdv-with-curl-fallback command shape, same as the claude path.
    expect(content).toContain("if command -v rdv");
    expect(content).toContain("/internal/agent-status");

    // [remote-dev-1aa5c] subagent-stop keeps the source tag so the
    // server-side ordering guard applies (curl fallback carries it too).
    expect(content).toContain("status=running&source=subagent-stop");

    // Only Kimi's allowed fields — a stray field fails Kimi's config load.
    // (matcher is optional and intentionally omitted.)
    expect(content).not.toMatch(/^matcher\s*=/gm);
    expect(content).not.toMatch(/^type\s*=/gm);
  });

  it("writes atomically via tmp file + rename", async () => {
    await installAgentHooks(kimiHome, "kimi");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [tmpPath] = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(tmpPath).startsWith(`${configPath}.rdv-tmp-`)).toBe(true);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(tmpPath, configPath);
  });

  it("creates a new config.toml with mode 0600 (it can hold an API key)", async () => {
    await installAgentHooks(kimiHome, "kimi");

    // No secret-bearing window: the tmp file is created 0600 up front, not
    // written with default perms and chmod'd afterwards.
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".rdv-tmp-"),
      expect.any(String),
      { mode: 0o600 },
    );
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves the existing file's mode through a rewrite", async () => {
    await realWriteFile(configPath, '# user comment\nmodel = "k2"\n');
    await realChmod(configPath, 0o600);

    await installAgentHooks(kimiHome, "kimi");

    // Content was rewritten (managed blocks appended) but the mode survives
    // the tmp+rename swap.
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain('model = "k2"');
    expect(content.match(/^# rdv-managed$/gm)).toHaveLength(12);
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves a permissive existing mode too (no tightening/widening)", async () => {
    await realWriteFile(configPath, '# team-shared config\nmodel = "k2"\n');
    await realChmod(configPath, 0o644);

    await installAgentHooks(kimiHome, "kimi");

    // The tmp file is still born 0600 (no secret window); the 0644 mode is
    // applied via chmod only because the target already existed with it.
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".rdv-tmp-"),
      expect.any(String),
      { mode: 0o600 },
    );
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("uses a unique tmp path per invocation and leaves no .rdv-tmp files behind", async () => {
    // Concurrent installs share a pid — a pid-only tmp suffix would race.
    await Promise.all([
      installAgentHooks(kimiHome, "kimi"),
      installAgentHooks(kimiHome, "kimi"),
    ]);

    const tmpPaths = (writeFile as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => String(p));
    expect(tmpPaths.length).toBeGreaterThanOrEqual(1);
    expect(new Set(tmpPaths).size).toBe(tmpPaths.length);

    // Second run is a no-op — no new tmp churn.
    vi.clearAllMocks();
    await installAgentHooks(kimiHome, "kimi");
    expect(writeFile).not.toHaveBeenCalled();

    const leftovers = (await readdir(kimiHome)).filter((f) => f.includes(".rdv-tmp-"));
    expect(leftovers).toEqual([]);

    // Final content is well-formed despite the concurrent writes.
    const content = await readFile(configPath, "utf-8");
    expect(content.match(/^# rdv-managed$/gm)).toHaveLength(12);
  });

  it("preserves user hooks and all other config content verbatim", async () => {
    const userContent = [
      "# Kimi Code configuration",
      'model = "k2"',
      "",
      "[ui]",
      "theme = \"dark\"",
      "",
      "# my personal hook",
      "[[hooks]]",
      'event = "PreToolUse"',
      'matcher = "Bash"',
      'command = "echo hi"',
      "timeout = 3",
      "",
    ].join("\n");
    await realWriteFile(configPath, userContent);

    await installAgentHooks(kimiHome, "kimi");

    const content = await readFile(configPath, "utf-8");
    // Every original line survives, in order, as the file's leading content
    // (trailing blank lines at the junction may be normalized).
    expect(content.startsWith(userContent.replace(/\n+$/, ""))).toBe(true);
    // The user's hook table is intact alongside the 12 managed ones.
    expect(content.match(/^\[\[hooks\]\]$/gm)).toHaveLength(13);
    expect(content).toContain('matcher = "Bash"');
    expect(content).toContain('command = "echo hi"');
  });

  it("is idempotent — a second install is byte-identical and writes nothing", async () => {
    const userContent = '# user comment\n\n[[hooks]]\nevent = "Stop"\ncommand = "user-cmd"\n\n';
    await realWriteFile(configPath, userContent);

    await installAgentHooks(kimiHome, "kimi");
    const first = await readFile(configPath, "utf-8");

    vi.clearAllMocks();
    await installAgentHooks(kimiHome, "kimi");
    const second = await readFile(configPath, "utf-8");

    expect(second).toBe(first);
    // No-op detection: unchanged content must not be rewritten.
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    // User hook still there, still exactly one copy of each managed block.
    expect(second).toContain('command = "user-cmd"');
    expect(second.match(/^# rdv-managed$/gm)).toHaveLength(12);
  });

  it("replaces stale rdv-managed blocks wholesale (no duplicates on upgrade)", async () => {
    await installAgentHooks(kimiHome, "kimi");
    const first = await readFile(configPath, "utf-8");
    // Simulate an older/partial install: keep only a couple of managed blocks.
    const blocks = first.split(/(?=^# rdv-managed$)/m).filter(Boolean);
    expect(blocks.length).toBe(12);
    await realWriteFile(configPath, blocks.slice(0, 2).join(""));

    await installAgentHooks(kimiHome, "kimi");
    const content = await readFile(configPath, "utf-8");

    expect(content.match(/^# rdv-managed$/gm)).toHaveLength(12);
    expect(content.match(/^\[\[hooks\]\]$/gm)).toHaveLength(12);
  });

  it("leaves malformed/unexpected content untouched", async () => {
    const weird = [
      "this is not toml at all",
      "[[[triple bracket",
      'event = "NotARealEvent"',
      "[[hooks]]",
      "command = 42 # not even a string",
      "   ",
      "[[hooks]]",
      'command = "rdv status --human" # user runs rdv directly, not a hook marker',
      "",
    ].join("\n");
    await realWriteFile(configPath, weird);

    await installAgentHooks(kimiHome, "kimi");

    const content = await readFile(configPath, "utf-8");
    expect(content.startsWith(weird.replace(/\n+$/, ""))).toBe(true);
    // The two user [[hooks]] tables survive; 12 managed ones are appended.
    expect(content.match(/^\[\[hooks\]\]$/gm)).toHaveLength(14);
  });

  it("removes legacy rdv hook blocks (marker without managed header)", async () => {
    // A block written by an older/foreign installer: no # rdv-managed header,
    // but the command carries the rdv hook marker.
    const legacy = [
      "[[hooks]]",
      'event = "Stop"',
      'command = "if command -v rdv >/dev/null 2>&1; then rdv hook kimi stop; fi"',
      "",
    ].join("\n");
    await realWriteFile(configPath, legacy);

    await installAgentHooks(kimiHome, "kimi");

    const content = await readFile(configPath, "utf-8");
    // Only the 12 fresh managed blocks remain.
    expect(content.match(/^\[\[hooks\]\]$/gm)).toHaveLength(12);
    expect(content.match(/^# rdv-managed$/gm)).toHaveLength(12);
  });

  it("does nothing for non-hook providers", async () => {
    await installAgentHooks(kimiHome, "codex");
    await installAgentHooks(kimiHome, "gemini");

    expect(writeFile).not.toHaveBeenCalled();
    await expect(readFile(configPath, "utf-8")).rejects.toThrow();
  });
});
