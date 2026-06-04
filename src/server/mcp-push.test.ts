// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "node:net";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pushToMcpServer,
  closeMcpSocket,
  setDeliveredHook,
  setReplayHook,
  onMcpAck,
  __setMcpSocketPathForTest,
  type McpPushEvent,
} from "./mcp-push";

// A stub "MCP server": listens on the session's socket path, records every
// event line it receives, and can be configured to echo back an {type:"ack"}
// and/or send a {type:"replay_request"}. This exercises the bidirectional
// protocol added in x386.2/.3 without a real Claude Code process.
interface StubServer {
  server: net.Server;
  received: Record<string, unknown>[];
  conns: net.Socket[];
  /** Send a replay_request from the (first) connected client → terminal server. */
  sendReplayRequest: (sessionId: string) => void;
  close: () => Promise<void>;
}

function startStub(
  sockPath: string,
  opts: { autoAck?: boolean } = {},
): Promise<StubServer> {
  const received: Record<string, unknown>[] = [];
  const conns: net.Socket[] = [];
  const server = net.createServer((conn) => {
    conns.push(conn);
    let buf = "";
    conn.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        received.push(msg);
        if (opts.autoAck && msg.frame === "event" && msg.messageId) {
          conn.write(JSON.stringify({ type: "ack", messageId: msg.messageId }) + "\n");
        }
      }
    });
    conn.on("error", () => {});
  });
  return new Promise((resolve) => {
    server.listen(sockPath, () => {
      resolve({
        server,
        received,
        conns,
        sendReplayRequest: (sessionId: string) => {
          conns[0]?.write(JSON.stringify({ type: "replay_request", sessionId }) + "\n");
        },
        close: () =>
          new Promise<void>((res) => {
            for (const c of conns) c.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

/** Poll a predicate until true or timeout (events are async over the socket). */
async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeEvent(over: Partial<McpPushEvent> = {}): McpPushEvent {
  return {
    type: "peer_message",
    messageId: "m1",
    fromSessionId: "from-1",
    fromSessionName: "alice",
    toSessionId: "to-1",
    body: "hello",
    channelId: null,
    channelName: null,
    parentMessageId: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

let tmpDir: string;
const SID = "sess-abc";
let sockPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-mcp-test-"));
  sockPath = join(tmpDir, `rdv-mcp-${SID}.sock`);
  __setMcpSocketPathForTest((sid) => join(tmpDir, `rdv-mcp-${sid}.sock`));
  setDeliveredHook(null);
  setReplayHook(null);
});

afterEach(() => {
  closeMcpSocket(SID);
  __setMcpSocketPathForTest(null);
  setDeliveredHook(null);
  setReplayHook(null);
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("mcp-push ack-aware delivery (x386.2)", () => {
  it("fires the delivered hook when the socket accepts the write", async () => {
    const stub = await startStub(sockPath);
    const delivered: Array<{ sid: string; mid: string }> = [];
    setDeliveredHook((sid, mid) => delivered.push({ sid, mid }));

    pushToMcpServer(SID, makeEvent({ messageId: "m1" }));

    await waitFor(() => delivered.length > 0);
    expect(delivered[0]).toEqual({ sid: SID, mid: "m1" });
    // The MCP server received an {frame:"event"} envelope carrying the messageId.
    await waitFor(() => stub.received.length > 0);
    expect(stub.received[0]).toMatchObject({ frame: "event", messageId: "m1" });
    await stub.close();
  });

  it("invokes the per-session ack handler when the MCP server acks", async () => {
    const stub = await startStub(sockPath, { autoAck: true });
    const acked: string[] = [];
    onMcpAck(SID, (messageId) => acked.push(messageId));

    pushToMcpServer(SID, makeEvent({ messageId: "m1" }));

    await waitFor(() => acked.includes("m1"));
    expect(acked).toEqual(["m1"]);
    await stub.close();
  });

  it("leaves a push unacked when the MCP server never acks (poll recovers)", async () => {
    const stub = await startStub(sockPath, { autoAck: false });
    const acked: string[] = [];
    onMcpAck(SID, (messageId) => acked.push(messageId));
    const delivered: string[] = [];
    setDeliveredHook((_sid, mid) => delivered.push(mid));

    pushToMcpServer(SID, makeEvent({ messageId: "m1" }));

    await waitFor(() => delivered.includes("m1"));
    // Delivered but NOT acked — this is the "no silent loss" guarantee.
    await new Promise((r) => setTimeout(r, 80));
    expect(acked).toHaveLength(0);
    await stub.close();
  });
});

describe("mcp-push replay handshake (x386.3)", () => {
  it("invokes the replay hook when the MCP server sends a replay_request", async () => {
    const stub = await startStub(sockPath, { autoAck: true });
    const replays: string[] = [];
    setReplayHook(async (sid) => {
      replays.push(sid);
    });

    // Establish the connection by pushing one event first.
    pushToMcpServer(SID, makeEvent({ messageId: "m0" }));
    await waitFor(() => stub.conns.length > 0);

    // MCP server (re)connects → asks the terminal server to replay.
    stub.sendReplayRequest(SID);

    await waitFor(() => replays.includes(SID));
    expect(replays).toEqual([SID]);
    await stub.close();
  });

  it("the socket file must exist before a push connects", async () => {
    // No stub started → no socket file → push is a no-op (cached negative).
    const delivered: string[] = [];
    setDeliveredHook((_sid, mid) => delivered.push(mid));
    expect(fs.existsSync(sockPath)).toBe(false);
    pushToMcpServer(SID, makeEvent({ messageId: "m1" }));
    await new Promise((r) => setTimeout(r, 60));
    expect(delivered).toHaveLength(0);
  });
});
