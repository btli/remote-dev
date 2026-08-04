// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  AGENT_PROVIDERS,
  AGENT_PRESETS,
  LOOP_AGENT_PROVIDERS,
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
      dangerousFlags: ["-f", "--force", "--yolo"],
    });
    expect(buildAgentCommand(cursor!)).toBe("agent");
    expect(
      buildAgentCommand(cursor!, [
        "-f",
        "-f=true",
        "-fcompact",
        "-pf",
        "-Hfoo",
        "-wfeature",
        "--force",
        "--force=true",
        "--model",
        "fast",
        "--yolo",
        "--yolo=true",
      ]),
    ).toBe("agent -Hfoo -wfeature --model fast");
    expect(buildAgentCommand(cursor!, [], false, "/verified/cursor agent")).toBe(
      "'/verified/cursor agent'",
    );
    expect(buildAgentCommand(cursor!, [], false, "/verified/cursor's agent")).toBe(
      "'/verified/cursor'\\''s agent'",
    );
  });

  it("keeps the shared domain registry in sync", () => {
    expect(DOMAIN_AGENT_PROVIDERS.find((provider) => provider.id === "cursor")).toMatchObject({
      id: "cursor",
      command: "agent",
      dangerousFlags: ["-f", "--force", "--yolo"],
    });
  });

  it("offers Cursor in the feature-session agent presets", () => {
    expect(AGENT_PRESETS.find((preset) => preset.id === "cursor")).toMatchObject({
      command: "agent",
      label: "Cursor",
    });
    expect(LOOP_AGENT_PROVIDERS).toContain("cursor");
  });
});

describe("Kimi agent provider metadata", () => {
  it("launches the Kimi TUI with bare kimi and filters its bypass flags", () => {
    const kimi = AGENT_PROVIDERS.find((provider) => provider.id === "kimi");

    expect(kimi).toMatchObject({
      id: "kimi",
      name: "Kimi",
      command: "kimi",
      configFile: "AGENTS.md",
      defaultFlags: [],
      dangerousFlags: ["-y", "--yolo", "--yes", "--auto-approve", "--auto"],
    });
    expect(buildAgentCommand(kimi!)).toBe("kimi");
    expect(
      buildAgentCommand(kimi!, [
        "-y",
        "-y=true",
        "--yolo",
        "--yolo=true",
        "--yes",
        "--auto-approve",
        "--auto",
        "--auto=true",
        "--model",
        "fast",
      ]),
    ).toBe("kimi --model fast");
    // Dangerous flags pass through when explicitly allowed.
    expect(buildAgentCommand(kimi!, ["--yolo"], true)).toBe("kimi --yolo");
  });

  it("keeps the shared domain registry in sync", () => {
    expect(DOMAIN_AGENT_PROVIDERS.find((provider) => provider.id === "kimi")).toMatchObject({
      id: "kimi",
      command: "kimi",
      configFile: "AGENTS.md",
      dangerousFlags: ["-y", "--yolo", "--yes", "--auto-approve", "--auto"],
    });
  });

  it("offers Kimi in the feature-session agent presets", () => {
    expect(AGENT_PRESETS.find((preset) => preset.id === "kimi")).toMatchObject({
      command: "kimi",
      label: "Kimi",
    });
    expect(LOOP_AGENT_PROVIDERS).toContain("kimi");
  });
});
