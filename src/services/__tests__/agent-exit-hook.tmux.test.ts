// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildAgentExitHookCommand } from "../agent-exit-hook";
import { configureAgentPaneLifecycle } from "../tmux-service";

const sessions: string[] = [];

function commandExists(command: string): boolean {
  try {
    execFileSync(command, [command === "tmux" ? "-V" : "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const session of sessions.splice(0)) {
    try {
      execFileSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
    } catch {
      // The session may already be gone during assertion failures.
    }
  }
});

describe.skipIf(!commandExists("tmux") || !commandExists("curl"))(
  "agent exit hook with real tmux",
  () => {
    it("reports the dying pane's real status without cross-firing another session", async () => {
      const requests: Array<{ url: string; authorization: string | undefined }> = [];
      let resolveRequest!: (request: IncomingMessage) => void;
      const requestReceived = new Promise<IncomingMessage>((resolve) => {
        resolveRequest = resolve;
      });
      const server = createServer((req, res) => {
        requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        resolveRequest(req);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server port");
      const suffix = `${process.pid}-${Date.now()}`;
      const dying = `rdv-exit-dying-${suffix}`;
      const survivor = `rdv-exit-survivor-${suffix}`;
      sessions.push(dying, survivor);

      try {
        execFileSync("tmux", [
          "new-session",
          "-d",
          "-s",
          dying,
          "sh -c 'sleep 1; exit 37'",
        ]);
        execFileSync("tmux", [
          "new-session",
          "-d",
          "-s",
          survivor,
          "sh -c 'sleep 10'",
        ]);
        execFileSync("tmux", ["set-environment", "-t", dying, "RDV_API_KEY", "rdv_test_dying"]);
        execFileSync("tmux", ["set-environment", "-t", survivor, "RDV_API_KEY", "rdv_test_survivor"]);
        execFileSync("tmux", ["set-environment", "-t", dying, "RDV_AGENT_GENERATION", "2"]);
        execFileSync("tmux", ["set-environment", "-t", survivor, "RDV_AGENT_GENERATION", "9"]);

        await configureAgentPaneLifecycle(
          dying,
          buildAgentExitHookCommand({
            sessionId: "session-dying",
            tmuxSessionName: dying,
            generation: 2,
            terminalPort: String(address.port),
          }),
        );
        await configureAgentPaneLifecycle(
          survivor,
          buildAgentExitHookCommand({
            sessionId: "session-survivor",
            tmuxSessionName: survivor,
            generation: 9,
            terminalPort: String(address.port),
          }),
        );

        await Promise.race([
          requestReceived,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for pane-died callback")), 5_000),
          ),
        ]);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toContain("sessionId=session-dying");
        expect(requests[0]?.url).toContain("generation=2");
        expect(requests[0]?.url).toContain("exitCode=37");
        expect(requests[0]?.authorization).toBe("Bearer rdv_test_dying");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 10_000);

    it("does not fire when an auxiliary pane dies in the agent's session", async () => {
      const requests: string[] = [];
      let resolveAgentExit!: () => void;
      const agentExitReceived = new Promise<void>((resolve) => {
        resolveAgentExit = resolve;
      });
      const server = createServer((req, res) => {
        const url = req.url ?? "";
        requests.push(url);
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        if (url.includes("exitCode=37")) resolveAgentExit();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server port");
      const session = `rdv-exit-split-${process.pid}-${Date.now()}`;
      sessions.push(session);

      try {
        execFileSync("tmux", [
          "new-session",
          "-d",
          "-s",
          session,
          "sh -c 'sleep 1; exit 37'",
        ]);
        execFileSync("tmux", ["set-environment", "-t", session, "RDV_API_KEY", "rdv_test_split"]);
        await configureAgentPaneLifecycle(
          session,
          buildAgentExitHookCommand({
            sessionId: "session-split",
            tmuxSessionName: session,
            generation: 3,
            terminalPort: String(address.port),
          }),
        );

        // This pane is not the pane that owns the agent lifecycle.
        execFileSync("tmux", ["split-window", "-d", "-t", session, "sh -c 'exit 23'"]);
        await Promise.race([
          agentExitReceived,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for agent pane exit")), 5_000),
          ),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(requests).toHaveLength(1);
        expect(requests[0]).toContain("exitCode=37");
        expect(requests[0]).not.toContain("exitCode=23");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 10_000);
  },
);
