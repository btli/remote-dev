// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installAgentHooks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const codexHooksEnabled = vi.hoisted(() => vi.fn(() => true));
const validateAgentHooks = vi.hoisted(() => vi.fn().mockResolvedValue({
  valid: false,
  repaired: false,
  configured: true,
  reachable: true,
  runtimeTrust: "unknown",
}));

vi.mock("@/services/agent-profile-service", () => ({
  installAgentHooks,
  validateAgentHooks,
}));
vi.mock("@/services/agent-hooks/codex-adapter", () => ({ codexHooksEnabled }));

import { prepareAgentLaunch } from "@/services/agent-launch-preparation";

describe("prepareAgentLaunch", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    installAgentHooks.mockClear();
    codexHooksEnabled.mockReset();
    codexHooksEnabled.mockReturnValue(true);
    validateAgentHooks.mockClear();
    process.env.HOME = "/server-home";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("repairs Codex hooks in the exact launch CODEX_HOME", async () => {
    const env = {
      RDV_AGENT_PROVIDER: "codex",
      HOME: "/profile-home",
      CODEX_HOME: "/profile-home/codex",
      RDV_SESSION_ID: "s1",
    };

    await prepareAgentLaunch(env);

    expect(installAgentHooks).toHaveBeenCalledWith("/profile-home", "codex", env);
  });

  it("repairs Claude hooks in the shared server account config", async () => {
    await prepareAgentLaunch({ RDV_AGENT_PROVIDER: "claude", HOME: "/profile-home" });

    expect(installAgentHooks).toHaveBeenCalledWith(
      "/server-home",
      "claude",
      expect.objectContaining({ RDV_AGENT_PROVIDER: "claude" }),
    );
  });

  it("leaves providers without lifecycle hook installers untouched", async () => {
    await prepareAgentLaunch({ RDV_AGENT_PROVIDER: "gemini" });
    expect(installAgentHooks).not.toHaveBeenCalled();
  });

  it("keeps Codex launchable when lifecycle hooks are disabled for rollback", async () => {
    codexHooksEnabled.mockReturnValue(false);

    await prepareAgentLaunch({
      RDV_AGENT_PROVIDER: "codex",
      RDV_SESSION_ID: "s1",
    });

    expect(installAgentHooks).toHaveBeenCalledOnce();
    expect(validateAgentHooks).not.toHaveBeenCalled();
  });

  it("blocks launch when the authenticated hook boundary is unreachable", async () => {
    validateAgentHooks.mockResolvedValueOnce({
      valid: false,
      repaired: false,
      configured: true,
      reachable: false,
      runtimeTrust: "unknown",
      error: "health unavailable",
    });

    await expect(prepareAgentLaunch({
      RDV_AGENT_PROVIDER: "codex",
      RDV_SESSION_ID: "s1",
      RDV_AGENT_GENERATION: "0",
      RDV_API_KEY: "key",
    })).rejects.toThrow("health unavailable");
  });
});
