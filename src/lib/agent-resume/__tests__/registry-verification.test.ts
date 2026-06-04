// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * verifyResumeFlag() probes the installed CLI's `--help` to catch version drift
 * (e.g. a provider renaming `--resume`). It must (a) return true when the token
 * is present, (b) return false AND log a warn when absent, and (c) short-circuit
 * for non-resumable providers without probing.
 */

const warn = vi.fn();
const execFileNoThrow = vi.fn();

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }),
}));
vi.mock("@/lib/exec", () => ({
  execFileNoThrow: (...args: unknown[]) => execFileNoThrow(...args),
}));

beforeEach(() => {
  warn.mockClear();
  execFileNoThrow.mockReset();
});

describe("verifyResumeFlag", () => {
  it("returns true when --help advertises the resume token", async () => {
    execFileNoThrow.mockResolvedValue({
      stdout: "Usage: claude\n  --resume <id>  Resume a session",
      stderr: "",
      exitCode: 0,
    });
    const { verifyResumeFlag } = await import("../agent-resume-registry");
    expect(await verifyResumeFlag("claude")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns false and warns when the token is missing (drift)", async () => {
    execFileNoThrow.mockResolvedValue({
      stdout: "Usage: gemini [options]\n  --help",
      stderr: "",
      exitCode: 0,
    });
    const { verifyResumeFlag } = await import("../agent-resume-registry");
    expect(await verifyResumeFlag("gemini")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("short-circuits non-resumable providers without probing", async () => {
    const { verifyResumeFlag } = await import("../agent-resume-registry");
    expect(await verifyResumeFlag("antigravity")).toBe(false);
    expect(execFileNoThrow).not.toHaveBeenCalled();
  });

  it("probes codex with its subcommand token", async () => {
    execFileNoThrow.mockResolvedValue({
      stdout: "Commands:\n  resume    Resume a previous session",
      stderr: "",
      exitCode: 0,
    });
    const { verifyResumeFlag } = await import("../agent-resume-registry");
    expect(await verifyResumeFlag("codex")).toBe(true);
  });
});
