#!/usr/bin/env bun

import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { installCodexHooks } from "../src/services/agent-hooks/codex-adapter";

const tempRoot = await mkdtemp(join(tmpdir(), "rdv-codex-hook-smoke-"));
const codexHome = join(tempRoot, "codex-home");
const binDir = join(tempRoot, "bin");
const eventLog = join(tempRoot, "events.log");

try {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(binDir, { recursive: true, mode: 0o700 });

  const sourceCodexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  await copyFile(join(sourceCodexHome, "auth.json"), join(codexHome, "auth.json"));
  await chmod(join(codexHome, "auth.json"), 0o600);
  await installCodexHooks(tempRoot, codexHome);

  const fakeRdv = join(binDir, "rdv");
  await writeFile(
    fakeRdv,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$*\" >> \"$RDV_HOOK_SMOKE_LOG\"",
      "cat >/dev/null",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const child = spawn(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--dangerously-bypass-hook-trust",
      "--sandbox",
      "read-only",
      "--model",
      process.env.RDV_CODEX_SMOKE_MODEL ?? "gpt-5.6-sol",
      "Run pwd with a shell tool, then reply with exactly OK.",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        RDV_HOOK_SMOKE_LOG: eventLog,
        RDV_SESSION_ID: "codex-hook-smoke",
        RDV_AGENT_GENERATION: "0",
        RDV_API_KEY: "rdv_smoke_only",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`codex exec exited ${exitCode}`);

  const events = (await readFile(eventLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  const required = [
    "hook codex session-start",
    "hook codex prompt-submit",
    "hook codex pre-tool-use",
    "hook codex post-tool-use",
    "hook codex stop",
    "hook codex session-end",
  ];
  const missing = required.filter((event) => !events.includes(event));
  if (missing.length > 0) {
    throw new Error(
      `Codex did not fire required hooks: ${missing.join(", ")}; saw ${events.join(", ")}`,
    );
  }
  console.log(JSON.stringify({ ok: true, events }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
