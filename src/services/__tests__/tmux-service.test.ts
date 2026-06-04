// @vitest-environment node
/**
 * [y5ch fix #2] Guard the send-keys literal-mode argv: a payload that starts
 * with `-` must be typed literally, which requires the `--` end-of-options
 * delimiter before the payload. Without it tmux parses e.g. "-X" as a flag.
 *
 * We mock @/lib/exec so sessionExists() (execFileNoThrow has-session) succeeds
 * and capture every execFile argv to assert the delimiter placement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileCalls: string[][] = [];

vi.mock("@/lib/exec", () => ({
  execFile: vi.fn(async (_cmd: string, args: string[]) => {
    execFileCalls.push(args);
    return { stdout: "", stderr: "" };
  }),
  execFileNoThrow: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  execFileCheck: vi.fn(async () => true),
}));

beforeEach(() => {
  execFileCalls.length = 0;
});

async function loadService() {
  return import("../tmux-service");
}

/** The argv of the literal send-keys call (the one carrying `-l`). */
function literalSendKeysArgs(): string[] | undefined {
  return execFileCalls.find((a) => a[0] === "send-keys" && a.includes("-l"));
}

describe("sendKeys literal mode (`--` delimiter)", () => {
  it("passes a `-`-prefixed payload after `--` so it is typed literally", async () => {
    const { sendKeys } = await loadService();
    await sendKeys("rdv-test", "-X cancel", false);

    const args = literalSendKeysArgs();
    expect(args).toBeDefined();
    // …, "-l", "--", "<payload>"
    expect(args).toEqual(["send-keys", "-t", "rdv-test", "-l", "--", "-X cancel"]);
    // The delimiter must immediately precede the payload (last element).
    const dashIdx = args!.indexOf("--");
    expect(dashIdx).toBe(args!.length - 2);
    expect(args![args!.length - 1]).toBe("-X cancel");
  });

  it("types a markdown '- item' payload literally (not as a flag)", async () => {
    const { sendKeys } = await loadService();
    await sendKeys("rdv-test", "- item one", false);

    const args = literalSendKeysArgs();
    expect(args).toEqual(["send-keys", "-t", "rdv-test", "-l", "--", "- item one"]);
  });

  it("still sends Enter as a key name (no payload, no delimiter) when pressEnter", async () => {
    const { sendKeys } = await loadService();
    await sendKeys("rdv-test", "ls", true);

    const enter = execFileCalls.find((a) => a.includes("Enter"));
    expect(enter).toEqual(["send-keys", "-t", "rdv-test", "Enter"]);
  });
});
