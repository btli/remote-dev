// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeStatusHookCommand,
  installAgentHooks,
} from "@/services/agent-profile-service";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(rdvExit: number) {
  const root = await mkdtemp(join(tmpdir(), "rdv-claude-delivery-"));
  tempDirs.push(root);
  const binDir = join(root, "bin");
  const capturePath = join(root, "curl-args");
  const rdvEnvPath = join(root, "rdv-env");
  const tracePath = join(root, "trace");
  await mkdir(binDir);
  const scripts: Record<string, string> = {
    rdv: `#!/bin/sh\nprintf '%s' "$RDV_API_KEY" > "${rdvEnvPath}"\nprintf 'rdv\\n' >> "${tracePath}"\nprintf '%s' "$FAKE_RDV_OUTPUT"\nexit ${rdvExit}\n`,
    uuidgen: "#!/bin/sh\nprintf claude-delivery\n",
    tmux: `#!/bin/sh
if [ -n "$FAKE_TMUX_EMPTY" ]; then exit 1; fi
if [ "$1" = display-message ]; then printf current-session; exit 0; fi
case "$4" in
  RDV_SESSION_ID) printf 'RDV_SESSION_ID=legacy-session' ;;
  RDV_AGENT_GENERATION) printf 'RDV_AGENT_GENERATION=3' ;;
  RDV_API_KEY) printf 'RDV_API_KEY=tmux-key' ;;
  RDV_TERMINAL_PORT) printf 'RDV_TERMINAL_PORT=7777' ;;
esac
`,
    curl: `#!/bin/sh\nprintf '%s\\n' "$*" >> "${capturePath}"\nprintf 'curl\\n' >> "${tracePath}"\n`,
  };
  await Promise.all(Object.entries(scripts).map(async ([name, source]) => {
    const path = join(binDir, name);
    await writeFile(path, source);
    await chmod(path, 0o755);
  }));
  return { binDir, capturePath, rdvEnvPath, tracePath };
}

describe("Claude lifecycle delivery wrapper", () => {
  it("posts with the tmux key even when an old rdv exits zero after swallowing a 401", async () => {
    const { binDir, capturePath, rdvEnvPath, tracePath } = await fixture(0);
    const command = buildClaudeStatusHookCommand("rdv hook pre-compact", "compacting");
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "legacy-session",
        RDV_AGENT_GENERATION: "3",
        RDV_API_KEY: "",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
      },
      input: "{}",
    });

    expect(result.status).toBe(0);
    const args = await readFile(capturePath, "utf8");
    expect(args).toContain("status=compacting&deliveryId=claude-delivery");
    expect(args).toContain("Bearer tmux-key");
    expect(await readFile(rdvEnvPath, "utf8")).toBe("tmux-key");
    expect((await readFile(tracePath, "utf8")).trim().split("\n")).toEqual(["rdv", "curl"]);
  });

  it("keeps a blocked Claude Stop running and never publishes a transient idle", async () => {
    const { binDir, capturePath } = await fixture(0);
    const command = buildClaudeStatusHookCommand("rdv hook claude stop", "idle");
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "legacy-session",
        RDV_AGENT_GENERATION: "3",
        RDV_API_KEY: "",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
        FAKE_RDV_OUTPUT: "unfinished beads",
      },
      input: "{}",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain("unfinished beads");
    const args = await readFile(capturePath, "utf8");
    expect(args).toContain("status=running&deliveryId=claude-delivery");
    expect(args).not.toContain("status=idle");
  });

  it("preserves exit 2 so Claude policy hooks can still block", async () => {
    const { binDir, capturePath } = await fixture(2);
    const command = buildClaudeStatusHookCommand("rdv hook claude stop", "idle");
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "legacy-session",
        RDV_AGENT_GENERATION: "3",
        RDV_API_KEY: "",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
      },
      input: "{}",
    });

    expect(await readFile(capturePath, "utf8")).toContain("status=idle");
    expect(result.status).toBe(2);
  });

  it("preserves policy exit 2 even when no lifecycle credentials are available", async () => {
    const { binDir } = await fixture(2);
    const command = buildClaudeStatusHookCommand("rdv hook pre-tool-use", "running");
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "",
        RDV_AGENT_GENERATION: "",
        RDV_API_KEY: "",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "",
        FAKE_TMUX_EMPTY: "1",
      },
      input: "{}",
    });

    expect(result.status).toBe(2);
  });
});

describe("Claude lifecycle hook installation", () => {
  it.each([
    ["malformed JSON", "{\"hooks\":"],
    ["an empty file", ""],
    ["a non-object root", "[]\n"],
    ["a non-object hooks map", '{"hooks":[]}\n'],
    ["a malformed managed hook group", '{"hooks":{"Stop":"user-command"}}\n'],
    [
      "a hook group with a non-array handler list",
      '{"hooks":{"Stop":[{"matcher":"user","hooks":"not-an-array"}]}}\n',
    ],
    [
      "a hook group with a non-object handler",
      '{"hooks":{"Stop":[{"hooks":["user-command"]}]}}\n',
    ],
    ["a non-object MCP map", '{"mcpServers":[]}\n'],
  ])("leaves %s untouched and aborts repair", async (_label, original) => {
    const root = await mkdtemp(join(tmpdir(), "rdv-claude-install-"));
    tempDirs.push(root);
    const claudeDir = join(root, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    await mkdir(claudeDir);
    await writeFile(settingsPath, original);

    await expect(installAgentHooks(root, "claude", {})).rejects.toThrow(
      "Claude settings.json",
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(original);
  });

  it("replaces a nested RDV handler without deleting user handlers in the same group", async () => {
    const root = await mkdtemp(join(tmpdir(), "rdv-claude-install-"));
    tempDirs.push(root);
    const claudeDir = join(root, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    await mkdir(claudeDir);
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "mixed-user-group",
              hooks: [
                { type: "command", command: "run-user-cleanup" },
                {
                  type: "command",
                  command: "if command -v rdv; then rdv hook claude stop; fi",
                },
              ],
            },
          ],
        },
      }),
    );

    await installAgentHooks(root, "claude", {});
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { Stop: Array<{ matcher?: string; hooks: Array<{ command: string }> }> };
    };
    const userGroup = settings.hooks.Stop.find(
      (group) => group.matcher === "mixed-user-group",
    );
    expect(userGroup?.hooks).toEqual([
      { type: "command", command: "run-user-cleanup" },
    ]);
    expect(JSON.stringify(settings.hooks.Stop)).toContain("rdv hook claude stop");
  });
});
