// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  AGENT_PROVIDERS,
  AGENT_PRESETS,
} from "./session";
import { AGENT_PROVIDERS as DOMAIN_AGENT_PROVIDERS } from "../../packages/domain/src/types/session";
import { buildAgentCommand } from "@/lib/terminal-plugins/agent-utils";

describe("Cursor agent provider metadata", () => {
  it("launches the Cursor TUI with bare agent and filters its bypass flags", () => {
    const cursor = AGENT_PROVIDERS.find((provider) => provider.id === "cursor");

    expect(cursor).toMatchObject({
      id: "cursor",
      name: "Cursor",
      command: "agent",
      configFile: "AGENTS.md",
      defaultFlags: [],
      dangerousFlags: ["--force", "--yolo"],
    });
    expect(buildAgentCommand(cursor!)).toBe("agent");
    expect(buildAgentCommand(cursor!, ["--force", "--model", "fast", "--yolo"])).toBe(
      "agent --model fast",
    );
  });

  it("keeps the shared domain registry in sync", () => {
    expect(DOMAIN_AGENT_PROVIDERS.find((provider) => provider.id === "cursor")).toMatchObject({
      id: "cursor",
      command: "agent",
      dangerousFlags: ["--force", "--yolo"],
    });
  });

  it("offers Cursor in the feature-session agent presets", () => {
    expect(AGENT_PRESETS.find((preset) => preset.id === "cursor")).toMatchObject({
      command: "agent",
      label: "Cursor",
    });
  });
});
