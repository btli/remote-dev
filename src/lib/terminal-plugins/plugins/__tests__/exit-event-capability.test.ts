// @vitest-environment node
/**
 * Capability-flag tests for the `emitsExitEvents` plugin contract.
 *
 * `session-service.ts` reads this flag from the server plugin registry to
 * decide whether to:
 *   - install the tmux pane-exited hook that POSTs to /internal/agent-exit
 *   - seed `agentExitState = "running"` on the new DB row
 *
 * If a plugin loses the flag (or a new tmux-backed plugin forgets to set
 * it), the corresponding sessions silently lose the exit-screen / restart
 * flow. Lock the contract here.
 */

import { describe, it, expect } from "vitest";

import { AgentServerPlugin } from "../agent-plugin-server";
import { LoopAgentServerPlugin } from "../loop-agent-plugin-server";
import { SshServerPlugin } from "../ssh-plugin-server";
import { ShellServerPlugin } from "../shell-plugin-server";
import { FileViewerServerPlugin } from "../file-viewer-plugin-server";
import { BrowserServerPlugin } from "../browser-plugin-server";

describe("emitsExitEvents capability flag", () => {
  it("agent / loop / ssh opt in (tmux pane is the 'main task')", () => {
    expect(AgentServerPlugin.emitsExitEvents).toBe(true);
    expect(LoopAgentServerPlugin.emitsExitEvents).toBe(true);
    expect(SshServerPlugin.emitsExitEvents).toBe(true);
  });

  it("plain shell does NOT opt in (a user shell exit shouldn't surface an exit screen)", () => {
    expect(ShellServerPlugin.emitsExitEvents ?? false).toBe(false);
  });

  it("non-tmux plugins are unaffected (file viewer, browser pane)", () => {
    // These have useTmux: false; the flag is meaningless but should default
    // to false rather than being inadvertently set elsewhere.
    expect(FileViewerServerPlugin.emitsExitEvents ?? false).toBe(false);
    expect(BrowserServerPlugin.emitsExitEvents ?? false).toBe(false);
  });
});
