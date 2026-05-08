/**
 * EmbeddedSessionView tests.
 *
 * Verifies that:
 *   1. The view renders the terminal area.
 *   2. Mounting installs window.rdvBridge.
 *   3. Unmounting uninstalls window.rdvBridge.
 *   4. window.rdvBridge.input forwards into the terminal's sendInput.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { EmbeddedSessionView } from "../EmbeddedSessionView";

// Captured spies — re-created per test in `beforeEach` so we can assert
// against the actual instance the component held in its ref.
let sendInputSpy: ReturnType<typeof vi.fn>;
let scrollToBottomSpy: ReturnType<typeof vi.fn>;

vi.mock("@/components/terminal/TerminalWithKeyboard", async () => {
  const React = await import("react");
  const TerminalWithKeyboard = React.forwardRef<
    {
      sendInput: (s: string) => void;
      scrollToBottom: () => void;
      focus: () => void;
      restartAgent: () => void;
    },
    Record<string, unknown>
  >(function MockTerminal(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      sendInput: sendInputSpy as unknown as (s: string) => void,
      scrollToBottom: scrollToBottomSpy as unknown as () => void,
      focus: vi.fn() as unknown as () => void,
      restartAgent: vi.fn() as unknown as () => void,
    }));
    return React.createElement(
      "div",
      { "data-testid": "terminal-mock" },
      "terminal"
    );
  });
  return { TerminalWithKeyboard };
});

const session = {
  id: "session-1",
  name: "test session",
  tmuxSessionName: "rdv-session-1",
  status: "active" as const,
};

beforeEach(() => {
  sendInputSpy = vi.fn();
  scrollToBottomSpy = vi.fn();
});

afterEach(() => {
  cleanup();
  delete window.rdvBridge;
});

describe("EmbeddedSessionView", () => {
  it("renders the terminal area", () => {
    const { getByTestId } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );

    expect(getByTestId("terminal-mock")).toBeTruthy();
  });

  it("installs window.rdvBridge on mount", () => {
    expect(window.rdvBridge).toBeUndefined();

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    expect(window.rdvBridge).toBeDefined();
    expect(window.rdvBridge?.version).toBe(1);
  });

  it("uninstalls window.rdvBridge on unmount", () => {
    const { unmount } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    expect(window.rdvBridge).toBeDefined();

    unmount();

    expect(window.rdvBridge).toBeUndefined();
  });

  it("rdvBridge.input forwards to terminal sendInput", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.input("ls -la\n");

    expect(sendInputSpy).toHaveBeenCalledWith("ls -la\n");
  });
});
