// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  codexHooksEnabled,
  inspectInstalledCodexHooks,
  installCodexHooks,
  uninstallCodexHooks,
} from "./codex-adapter";

const tempDirs: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rdv-codex-hooks-"));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("installCodexHooks", () => {
  it("is enabled by default with an explicit zero-value rollback", () => {
    expect(codexHooksEnabled({})).toBe(true);
    expect(codexHooksEnabled({ RDV_CODEX_HOOKS_ENABLED: "1" })).toBe(true);
    expect(codexHooksEnabled({ RDV_CODEX_HOOKS_ENABLED: "0" })).toBe(false);
  });

  it("installs the full Codex lifecycle map under the active config root", async () => {
    const configRoot = await makeConfigRoot();

    await installCodexHooks(configRoot);

    const path = join(configRoot, ".codex", "hooks.json");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };

    expect(Object.keys(parsed.hooks).sort()).toEqual([
      "PermissionRequest",
      "PostCompact",
      "PostToolUse",
      "PreCompact",
      "PreToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
    expect(parsed.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");
    expect(parsed.hooks.PermissionRequest[0]?.hooks[0]?.command).toContain(
      "rdv hook codex permission-request",
    );
    expect(parsed.hooks.Stop[0]?.hooks[0]?.command).toContain("rdv hook codex stop");
    expect(parsed.hooks.UserPromptSubmit[0]?.hooks[0]?.command).toContain(
      "rdv hook codex prompt-submit",
    );
    const commands = Object.values(parsed.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    expect(commands).toHaveLength(11);
    for (const command of commands) {
      expect(command).toContain("rdv hook codex");
      expect(command).not.toContain('_RDV_RC" -eq 2');
      expect(command).toContain("else ");
      expect(command).not.toContain("eval ");
      expect(command).toContain('export "$_RDV_VALUE"');
      expect(command).toContain("RDV_AGENT_GENERATION");
      expect(command).toContain("Authorization: Bearer $RDV_API_KEY");
      expect(command).toContain("--connect-timeout 1");
      expect(command).toContain("--max-time 2");
      expect(command).toContain("--retry-max-time 2");
      expect(command).toContain("-o /dev/null");
      expect(spawnSync("/bin/sh", ["-n", "-c", command]).status).toBe(0);
    }
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("structurally detects missing or drifted managed hook entries", async () => {
    const configRoot = await makeConfigRoot();
    await installCodexHooks(configRoot);

    await expect(inspectInstalledCodexHooks(configRoot)).resolves.toEqual({
      configured: true,
    });

    const path = join(configRoot, ".codex", "hooks.json");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    parsed.hooks.PermissionRequest[0]!.hooks[0]!.command = "user-command";
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);

    const result = await inspectInstalledCodexHooks(configRoot);
    expect(result.configured).toBe(false);
    expect(result.error).toContain("missing or drifted");
  });

  it("keeps an old process callback bound to its inherited generation during fallback", async () => {
    const configRoot = await makeConfigRoot();
    const binDir = join(configRoot, "bin");
    const capturePath = join(configRoot, "curl-args");
    await mkdir(binDir, { recursive: true });
    const scripts: Record<string, string> = {
      rdv: "#!/bin/sh\nexit 1\n",
      uuidgen: "#!/bin/sh\nprintf delivery-fixed\n",
      tmux: `#!/bin/sh
if [ "$1" = display-message ]; then printf current-session; exit 0; fi
case "$4" in
  RDV_SESSION_ID) printf 'RDV_SESSION_ID=new-session' ;;
  RDV_AGENT_GENERATION) printf 'RDV_AGENT_GENERATION=9' ;;
  RDV_API_KEY) printf 'RDV_API_KEY=new-key' ;;
  RDV_TERMINAL_PORT) printf 'RDV_TERMINAL_PORT=9999' ;;
esac
`,
      curl: `#!/bin/sh\nprintf '%s\\n' "$*" > "${capturePath}"\n`,
    };
    await Promise.all(
      Object.entries(scripts).map(async ([name, script]) => {
        const path = join(binDir, name);
        await writeFile(path, script);
        await chmod(path, 0o755);
      }),
    );
    await installCodexHooks(configRoot);
    const parsed = JSON.parse(await readFile(join(configRoot, ".codex", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = parsed.hooks.PermissionRequest[0]!.hooks[0]!.command;

    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "old-session",
        RDV_AGENT_GENERATION: "4",
        RDV_API_KEY: "old-key",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
      },
      input: "{}",
    });

    expect(result.status).toBe(0);
    const args = await readFile(capturePath, "utf8");
    expect(args).toContain("localhost:7777/internal/agent-status?sessionId=old-session");
    expect(args).toContain("generation=4");
    expect(args).toContain("deliveryId=delivery-fixed");
    expect(args).toContain("Bearer old-key");
    expect(args).not.toContain("new-session");
    expect(args).not.toContain("generation=9");
  });

  it("falls back to curl when an older rdv rejects the codex subcommand with exit 2", async () => {
    const configRoot = await makeConfigRoot();
    const binDir = join(configRoot, "bin");
    const capturePath = join(configRoot, "curl-args");
    await mkdir(binDir, { recursive: true });
    const scripts: Record<string, string> = {
      // clap uses exit 2 for an unknown subcommand in older rdv binaries.
      rdv: "#!/bin/sh\nexit 2\n",
      uuidgen: "#!/bin/sh\nprintf delivery-old-rdv\n",
      tmux: "#!/bin/sh\nexit 1\n",
      curl: `#!/bin/sh\nprintf '%s\\n' "$*" > "${capturePath}"\n`,
    };
    await Promise.all(
      Object.entries(scripts).map(async ([name, script]) => {
        const path = join(binDir, name);
        await writeFile(path, script);
        await chmod(path, 0o755);
      }),
    );
    await installCodexHooks(configRoot);
    const parsed = JSON.parse(await readFile(join(configRoot, ".codex", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    const result = spawnSync("/bin/sh", ["-c", parsed.hooks.PermissionRequest[0]!.hooks[0]!.command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "session-1",
        RDV_AGENT_GENERATION: "4",
        RDV_API_KEY: "key-1",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
      },
      input: "{}",
    });

    expect(result.status).toBe(0);
    expect(await readFile(capturePath, "utf8")).toContain(
      "status=waiting&deliveryId=delivery-old-rdv",
    );
  });

  it("preserves request_user_input attention when the rdv bridge fails after reading stdin", async () => {
    const configRoot = await makeConfigRoot();
    const binDir = join(configRoot, "bin");
    const curlCapturePath = join(configRoot, "curl-args");
    const rdvCapturePath = join(configRoot, "rdv-payload");
    await mkdir(binDir, { recursive: true });
    const scripts: Record<string, string> = {
      rdv: `#!/bin/sh\ncat > "${rdvCapturePath}"\nexit 1\n`,
      uuidgen: "#!/bin/sh\nprintf delivery-question-fallback\n",
      tmux: "#!/bin/sh\nexit 1\n",
      curl: `#!/bin/sh\nprintf '%s\\n' "$*" > "${curlCapturePath}"\n`,
    };
    await Promise.all(
      Object.entries(scripts).map(async ([name, script]) => {
        const path = join(binDir, name);
        await writeFile(path, script);
        await chmod(path, 0o755);
      }),
    );
    await installCodexHooks(configRoot);
    const parsed = JSON.parse(await readFile(join(configRoot, ".codex", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const payload = JSON.stringify({
      tool_name: "request_user_input",
      tool_input: { questions: [{ question: "Continue?" }] },
    });

    const result = spawnSync("/bin/sh", ["-c", parsed.hooks.PreToolUse[0]!.hooks[0]!.command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RDV_SESSION_ID: "session-1",
        RDV_AGENT_GENERATION: "4",
        RDV_API_KEY: "key-1",
        RDV_TERMINAL_SOCKET: "",
        RDV_TERMINAL_PORT: "7777",
      },
      input: payload,
    });

    expect(result.status).toBe(0);
    expect(await readFile(rdvCapturePath, "utf8")).toBe(payload);
    expect(await readFile(curlCapturePath, "utf8")).toContain(
      "status=waiting&deliveryId=delivery-question-fallback",
    );

    const ordinaryPayload = JSON.stringify({
      tool_name: "mcp__example__forward",
      tool_input: {
        tool_name: "request_user_input",
      },
    });
    const ordinaryResult = spawnSync(
      "/bin/sh",
      ["-c", parsed.hooks.PreToolUse[0]!.hooks[0]!.command],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          RDV_SESSION_ID: "session-1",
          RDV_AGENT_GENERATION: "4",
          RDV_API_KEY: "key-1",
          RDV_TERMINAL_SOCKET: "",
          RDV_TERMINAL_PORT: "7777",
        },
        input: ordinaryPayload,
      },
    );

    expect(ordinaryResult.status).toBe(0);
    expect(await readFile(rdvCapturePath, "utf8")).toBe(ordinaryPayload);
    expect(await readFile(curlCapturePath, "utf8")).toContain(
      "status=running&deliveryId=delivery-question-fallback",
    );
  });

  it("preserves user hooks and replaces only Remote Dev-owned entries", async () => {
    const configRoot = await makeConfigRoot();
    const codexDir = join(configRoot, ".codex");
    const path = join(codexDir, "hooks.json");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(
        {
          description: "user config",
          customKey: { keep: true },
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "user-pre-tool" }] },
              {
                matcher: "mixed-group",
                hooks: [
                  { type: "command", command: "user-in-mixed-group" },
                  {
                    type: "command",
                    command: "rdv hook codex old # remote-dev:codex-hooks:v0",
                  },
                ],
              },
              {
                matcher: "",
                hooks: [
                  {
                    type: "command",
                    command: "rdv hook codex old # remote-dev:codex-hooks:v0",
                  },
                ],
              },
            ],
            CustomEvent: [{ hooks: [{ type: "command", command: "user-custom" }] }],
          },
        },
        null,
        2,
      )}\n`,
    );

    await installCodexHooks(configRoot);
    const first = await readFile(path, "utf8");
    await installCodexHooks(configRoot);
    const second = await readFile(path, "utf8");
    const parsed = JSON.parse(first) as {
      description: string;
      customKey: { keep: boolean };
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    expect(parsed.description).toBe("user config");
    expect(parsed.customKey).toEqual({ keep: true });
    expect(parsed.hooks.CustomEvent[0]?.hooks[0]?.command).toBe("user-custom");
    expect(parsed.hooks.PreToolUse.some((group) => group.hooks[0]?.command === "user-pre-tool")).toBe(
      true,
    );
    expect(
      parsed.hooks.PreToolUse.some(
        (group) => group.hooks[0]?.command === "user-in-mixed-group",
      ),
    ).toBe(true);
    expect(first).not.toContain("remote-dev:codex-hooks:v0");
    expect(second).toBe(first);
  });

  it("preserves a user command that merely mentions the ownership marker", async () => {
    const configRoot = await makeConfigRoot();
    const codexDir = join(configRoot, ".codex");
    const path = join(codexDir, "hooks.json");
    const userCommand =
      'printf "%s\\n" "remote-dev:codex-hooks:v1" && run-user-hook';
    await mkdir(codexDir, { recursive: true });
    await writeFile(path, `${JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: "Bash",
          hooks: [{ type: "command", command: userCommand }],
        }],
      },
    }, null, 2)}\n`);

    await installCodexHooks(configRoot);
    let installed = await readFile(path, "utf8");
    expect(installed).toContain("run-user-hook");

    await uninstallCodexHooks(configRoot);
    installed = await readFile(path, "utf8");
    expect(installed).toContain("run-user-hook");
  });

  it("refreshes a dedicated managed group without changing surrounding user hooks", async () => {
    const configRoot = await makeConfigRoot();
    const codexDir = join(configRoot, ".codex");
    const path = join(codexDir, "hooks.json");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({
        hooks: {
          PermissionRequest: [
            { matcher: "before", hooks: [{ type: "command", command: "user-before" }] },
            {
              hooks: [{
                type: "command",
                command: "rdv hook codex old # remote-dev:codex-hooks:v0",
                timeout: 1,
              }],
            },
            { matcher: "after", hooks: [{ type: "command", command: "user-after" }] },
          ],
        },
      }, null, 2)}\n`,
    );

    await installCodexHooks(configRoot);

    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    const groups = parsed.hooks.PermissionRequest;
    expect(groups).toHaveLength(3);
    expect(groups[0]?.hooks[0]?.command).toBe("user-before");
    expect(groups[1]?.hooks[0]?.command).toContain("rdv hook codex permission-request");
    expect(groups[2]?.hooks[0]?.command).toBe("user-after");
  });

  it("removes a managed-first legacy entry without changing the user hook definition", async () => {
    const configRoot = await makeConfigRoot();
    const codexDir = join(configRoot, ".codex");
    const path = join(codexDir, "hooks.json");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "legacy-mixed-matcher",
              hooks: [
                {
                  type: "command",
                  command: "rdv hook codex old # remote-dev:codex-hooks:v0",
                  timeout: 1,
                },
                { type: "command", command: "user-after-managed", timeout: 7 },
              ],
            },
            { matcher: "user-group", hooks: [{ type: "command", command: "user-later" }] },
          ],
        },
      }, null, 2)}\n`,
    );

    await installCodexHooks(configRoot);

    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    const groups = parsed.hooks.PreToolUse;
    expect(groups[0]?.matcher).toBe("legacy-mixed-matcher");
    expect(groups[0]?.hooks).toEqual([
      { type: "command", command: "user-after-managed", timeout: 7 },
    ]);
    expect(groups[1]?.hooks[0]?.command).toBe("user-later");
    expect(groups[2]?.hooks[0]?.command).toContain("rdv hook codex pre-tool-use");
    expect(JSON.stringify(parsed)).not.toContain("inactive-trust-slot");
    expect(JSON.stringify(parsed)).not.toContain("remote-dev:codex-hooks:v0");
  });

  it("writes to an explicit CODEX_HOME instead of assuming HOME/.codex", async () => {
    const configRoot = await makeConfigRoot();
    const explicitCodexHome = join(configRoot, "isolated", "codex-home");

    await installCodexHooks(configRoot, explicitCodexHome);

    const parsed = JSON.parse(await readFile(join(explicitCodexHome, "hooks.json"), "utf8")) as {
      hooks: Record<string, unknown>;
    };
    expect(parsed.hooks.PermissionRequest).toBeDefined();
    await expect(access(join(configRoot, ".codex", "hooks.json"))).rejects.toThrow();
  });

  it("repairs permissive file mode even when hook content is already current", async () => {
    const configRoot = await makeConfigRoot();
    const path = join(configRoot, ".codex", "hooks.json");
    await installCodexHooks(configRoot);
    const content = await readFile(path, "utf8");
    await chmod(path, 0o644);

    await installCodexHooks(configRoot);

    expect(await readFile(path, "utf8")).toBe(content);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("does not rewrite a semantically current user-formatted file", async () => {
    const configRoot = await makeConfigRoot();
    const path = join(configRoot, ".codex", "hooks.json");
    await installCodexHooks(configRoot);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const userFormatted = JSON.stringify(parsed);
    await writeFile(path, userFormatted);
    await chmod(path, 0o644);

    await installCodexHooks(configRoot);

    expect(await readFile(path, "utf8")).toBe(userFormatted);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite invalid user JSON", async () => {
    const configRoot = await makeConfigRoot();
    const codexDir = join(configRoot, ".codex");
    const path = join(codexDir, "hooks.json");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path, "{ user-owned-invalid-json\n");

    await expect(installCodexHooks(configRoot)).rejects.toThrow(/invalid JSON/i);
    expect(await readFile(path, "utf8")).toBe("{ user-owned-invalid-json\n");
  });

  it("uninstalls only Remote Dev-owned entries and preserves user config", async () => {
    const configRoot = await makeConfigRoot();
    const path = join(configRoot, ".codex", "hooks.json");
    await installCodexHooks(configRoot);
    const installed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & {
      hooks: Record<string, unknown[]>;
    };
    installed.customKey = { keep: true };
    installed.hooks.PreToolUse.unshift({
      matcher: "user",
      hooks: [{ type: "command", command: "user-hook" }],
    });
    await writeFile(path, `${JSON.stringify(installed, null, 2)}\n`);

    await uninstallCodexHooks(configRoot);

    const cleaned = JSON.parse(await readFile(path, "utf8")) as typeof installed;
    expect(cleaned.customKey).toEqual({ keep: true });
    expect(JSON.stringify(cleaned)).not.toContain("remote-dev:codex-hooks:");
    expect(cleaned.hooks.PreToolUse).toEqual([
      { matcher: "user", hooks: [{ type: "command", command: "user-hook" }] },
    ]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
