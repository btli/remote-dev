import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";

import type { TerminalSession } from "@/types/session";
import type { TerminalTypeClientComponentProps } from "@/types/terminal-type-client";

const capture = vi.hoisted(() => ({
  adapterTerminalProps: [] as Array<Record<string, unknown>>,
  loopTerminalProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    capture.adapterTerminalProps.push(props);
    return null;
  },
}));

vi.mock("@/components/terminal/Terminal", () => ({
  Terminal: (props: Record<string, unknown>) => {
    capture.loopTerminalProps.push(props);
    return null;
  },
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({ getAgentActivityStatus: () => "idle" }),
}));

vi.mock("@/hooks/useLoopOutputParser", () => ({
  useLoopOutputParser: () => ({ handleOutput: vi.fn(), reset: vi.fn() }),
}));

vi.mock("@/hooks/useLoopScheduler", () => ({
  useLoopScheduler: () => {},
}));

vi.mock("@/components/loop/LoopMessageBubble", () => ({
  LoopMessageBubble: () => null,
}));

vi.mock("@/components/loop/LoopChatInput", () => ({
  LoopChatInput: () => null,
}));

vi.mock("@/components/loop/LoopStatusBar", async () => {
  const React = await import("react");
  return {
    LoopStatusBar: ({ onToggleTerminal }: { onToggleTerminal: () => void }) =>
      React.createElement(
        "button",
        { type: "button", onClick: onToggleTerminal },
        "toggle terminal",
      ),
  };
});

vi.mock("@/components/loop/TerminalDrawer", () => ({
  TerminalDrawer: ({ children }: { children: ReactNode }) => children,
}));

import { AgentClientPlugin } from "./agent-plugin-client";
import { LoopAgentClientPlugin } from "./loop-agent-plugin-client";
import { ShellClientPlugin } from "./shell-plugin-client";
import { SshClientPlugin } from "./ssh-plugin-client";

const session = {
  id: "s1",
  name: "Session",
  tmuxSessionName: "rdv-s1",
  terminalType: "shell",
  projectPath: "/tmp/project",
  projectId: "p1",
  typeMetadata: null,
  agentProvider: "claude",
} as TerminalSession;

const baseProps = {
  session,
  wsUrl: "ws://localhost:3001",
  sessionToken: null,
  cols: 80,
  rows: 24,
  fontSize: 14,
  fontFamily: "monospace",
  isActive: true,
} satisfies TerminalTypeClientComponentProps;

function renderPlugin(
  component: ComponentType<TerminalTypeClientComponentProps>,
  visible: boolean,
) {
  const Component = component;
  render(
    <Component
      {...({ ...baseProps, visible } as TerminalTypeClientComponentProps)}
    />,
  );
}

describe("terminal plugin visible propagation", () => {
  beforeEach(() => {
    capture.adapterTerminalProps.length = 0;
    capture.loopTerminalProps.length = 0;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it.each([
    ["shell", ShellClientPlugin.component],
    ["agent", AgentClientPlugin.component],
    ["ssh", SshClientPlugin.component],
  ])("forwards visible=false through the %s adapter", (_name, component) => {
    renderPlugin(component, false);

    expect(capture.adapterTerminalProps.at(-1)?.visible).toBe(false);
  });

  it("combines loop parent visibility with the open terminal drawer", () => {
    renderPlugin(LoopAgentClientPlugin.component, false);
    fireEvent.click(screen.getByRole("button", { name: "toggle terminal" }));

    expect(capture.loopTerminalProps.at(-1)?.visible).toBe(false);
  });
});
