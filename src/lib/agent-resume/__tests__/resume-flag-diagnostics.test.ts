// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runResumeFlagDiagnostics } from "../resume-flag-diagnostics";
import type { AllCLIStatus, CLIStatus } from "@/services/agent-cli-service";
import type { AgentProviderType } from "@/types/session";

// Silence (and capture) the structured logger so we can assert the good-path
// `info` is emitted only for confirmed providers, without touching the log DB.
// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the spies exist
// when createLogger is first wired at import time.
const { infoSpy, warnSpy } = vi.hoisted(() => ({
  infoSpy: vi.fn(),
  warnSpy: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: warnSpy,
    info: infoSpy,
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

/** Minimal CLIStatus builder for the providers under test. */
function status(provider: AgentProviderType, installed: boolean): CLIStatus {
  return { provider: provider as CLIStatus["provider"], installed, command: provider };
}

function detection(statuses: CLIStatus[]): () => Promise<AllCLIStatus> {
  return vi.fn().mockResolvedValue({
    statuses,
    installedCount: statuses.filter((s) => s.installed).length,
    totalCount: statuses.length,
  });
}

beforeEach(() => {
  infoSpy.mockReset();
  warnSpy.mockReset();
});

describe("runResumeFlagDiagnostics", () => {
  it("probes installed resume-capable providers and skips uninstalled ones", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const detectInstalled = detection([
      status("claude", true), // installed + resumable -> probed
      status("codex", true), // installed + resumable -> probed
      status("gemini", false), // NOT installed -> skipped
    ]);

    await runResumeFlagDiagnostics({ detectInstalled, verify });

    expect(verify).toHaveBeenCalledTimes(2);
    const probed = verify.mock.calls.map((c) => c[0]);
    expect(probed).toEqual(expect.arrayContaining(["claude", "codex"]));
    expect(probed).not.toContain("gemini");
  });

  it("skips installed providers that are not resume-capable (antigravity)", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const detectInstalled = detection([
      status("antigravity", true), // installed but resume.kind === "none" -> skipped
    ]);

    await runResumeFlagDiagnostics({ detectInstalled, verify });

    expect(verify).not.toHaveBeenCalled();
  });

  it("logs an info only for providers whose token IS advertised", async () => {
    // codex confirmed (true), gemini drifted (false) -> only codex gets the info.
    const verify = vi
      .fn()
      .mockImplementation(async (p: AgentProviderType) => p === "codex");
    const detectInstalled = detection([status("codex", true), status("gemini", true)]);

    await runResumeFlagDiagnostics({ detectInstalled, verify });

    expect(verify).toHaveBeenCalledTimes(2);
    const advertised = infoSpy.mock.calls.filter(
      (c) => c[0] === "Resume token advertised by CLI --help",
    );
    expect(advertised).toHaveLength(1);
    expect(advertised[0][1]).toMatchObject({ provider: "codex" });
  });

  it("surfaces drift via the (real) verify warn path without double-logging info", async () => {
    // A drifted flag returns false. The routine itself must not emit the
    // good-path info for it; verifyResumeFlag owns the warn (asserted in the
    // registry's own suite), so here we only confirm no false-positive info.
    const verify = vi.fn().mockResolvedValue(false);
    const detectInstalled = detection([status("gemini", true)]);

    await runResumeFlagDiagnostics({ detectInstalled, verify });

    expect(verify).toHaveBeenCalledTimes(1);
    const advertised = infoSpy.mock.calls.filter(
      (c) => c[0] === "Resume token advertised by CLI --help",
    );
    expect(advertised).toHaveLength(0);
  });

  it("never throws when a single provider probe rejects, and probes the rest", async () => {
    const verify = vi.fn().mockImplementation(async (p: AgentProviderType) => {
      if (p === "codex") throw new Error("help timed out");
      return true;
    });
    const detectInstalled = detection([status("codex", true), status("gemini", true)]);

    await expect(
      runResumeFlagDiagnostics({ detectInstalled, verify }),
    ).resolves.toBeUndefined();

    // Both were attempted; the throwing one was caught and warned, not fatal.
    expect(verify).toHaveBeenCalledTimes(2);
    expect(
      warnSpy.mock.calls.some(
        (c) => c[0] === "Resume flag verification threw; skipping provider",
      ),
    ).toBe(true);
  });

  it("never throws when detection itself rejects", async () => {
    const verify = vi.fn();
    const detectInstalled = vi.fn().mockRejectedValue(new Error("which exploded"));

    await expect(
      runResumeFlagDiagnostics({ detectInstalled, verify }),
    ).resolves.toBeUndefined();

    expect(verify).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((c) => c[0] === "Resume flag diagnostics failed"),
    ).toBe(true);
  });

  it("logs a no-op info when no installed CLI is resume-capable", async () => {
    const verify = vi.fn();
    const detectInstalled = detection([
      status("claude", false),
      status("codex", false),
    ]);

    await runResumeFlagDiagnostics({ detectInstalled, verify });

    expect(verify).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some(
        (c) => c[0] === "No installed resume-capable agent CLIs to verify",
      ),
    ).toBe(true);
  });
});
