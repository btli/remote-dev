// @vitest-environment node
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildClipboardSessionEnv,
  ensureClipboardShims,
  prependPathEntry,
} from "./clipboard-shims";

describe("clipboard compatibility shims", () => {
  it("generates executable pbcopy and pbpaste wrappers in a stable data-dir path", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rdv-clipboard-shims-"));

    const first = ensureClipboardShims(dataDir);
    const second = ensureClipboardShims(dataDir);

    expect(first).toBe(join(dataDir, "rdv", "clipboard-bin"));
    expect(second).toBe(first);
    expect(await readFile(join(first, "pbcopy"), "utf8")).toBe(
      "#!/bin/sh\nexec rdv clipboard copy \"$@\"\n",
    );
    expect(await readFile(join(first, "pbpaste"), "utf8")).toBe(
      "#!/bin/sh\nexec rdv clipboard paste \"$@\"\n",
    );
    expect((await stat(join(first, "pbcopy"))).mode & 0o777).toBe(0o755);
    expect((await stat(join(first, "pbpaste"))).mode & 0o777).toBe(0o755);
  });
});

describe("clipboard session environment", () => {
  it("prepends the shim directory while preserving and de-duplicating PATH", () => {
    const existing = ["/usr/local/bin", "/usr/bin"].join(delimiter);

    expect(prependPathEntry("/rdv/shims", existing)).toBe(
      ["/rdv/shims", "/usr/local/bin", "/usr/bin"].join(delimiter),
    );
    expect(
      prependPathEntry(
        "/rdv/shims",
        ["/usr/local/bin", "/rdv/shims", "/usr/bin"].join(delimiter),
      ),
    ).toBe(["/rdv/shims", "/usr/local/bin", "/usr/bin"].join(delimiter));
  });

  it("injects only clipboard-required callback vars for a local shell", () => {
    expect(
      buildClipboardSessionEnv({
        sessionId: "session-a",
        terminalType: "shell",
        shimDir: "/rdv/shims",
        currentPath: "/usr/bin",
        terminalSocket: "/tmp/terminal.sock",
        terminalPort: "7002",
      }),
    ).toEqual({
      RDV_SESSION_ID: "session-a",
      RDV_TERMINAL_SOCKET: "/tmp/terminal.sock",
      PATH: ["/rdv/shims", "/usr/bin"].join(delimiter),
    });
  });

  it("uses the terminal port fallback and excludes SSH sessions", () => {
    expect(
      buildClipboardSessionEnv({
        sessionId: "session-a",
        terminalType: "agent",
        shimDir: "/rdv/shims",
        currentPath: "/usr/bin",
        terminalPort: "7002",
      }),
    ).toMatchObject({ RDV_TERMINAL_PORT: "7002" });

    expect(
      buildClipboardSessionEnv({
        sessionId: "session-a",
        terminalType: "ssh",
        shimDir: "/rdv/shims",
        currentPath: "/usr/bin",
        terminalPort: "7002",
      }),
    ).toEqual({});
  });
});
