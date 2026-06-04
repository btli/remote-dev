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
  setPendingSessionsProvider,
  ensureConnected,
  reconcileMcpConnections,
  stopMcpReconcile,
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
  stopMcpReconcile();
  closeMcpSocket(SID);
  __setMcpSocketPathForTest(null);
  setDeliveredHook(null);
  setReplayHook(null);
  setPendingSessionsProvider(null);
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

describe("mcp-push idle-reconnect replay (x386.15)", () => {
  // Model a durable inbox: ids the agent has NOT yet acked. The replay hook reads
  // this (like getUndelivered) and the ack handler removes from it (like
  // ackDelivery), so the "no double-delivery" guarantee is exercised end-to-end.
  let unacked: Set<string>;

  function installReplayFromInbox(): void {
    setReplayHook((sid) => {
      for (const mid of unacked) {
        pushToMcpServer(sid, makeEvent({ messageId: mid }));
      }
    });
  }

  beforeEach(() => {
    unacked = new Set();
  });

  it("delivers a pending unacked message on reconnect WITHOUT a coincident push", async () => {
    // A message is owed to the session but nothing is actively pushing it.
    unacked.add("owed-1");
    const delivered: string[] = [];
    setDeliveredHook((_sid, mid) => delivered.push(mid));
    installReplayFromInbox();

    // The MCP server (re)appears after idle: its socket file now exists.
    const stub = await startStub(sockPath);

    // The delivery service reports this session has backlog; the reconcile tick
    // proactively reconnects and replays — no push() was called.
    setPendingSessionsProvider(async () => ["sess-abc"]);
    await reconcileMcpConnections();

    await waitFor(() => delivered.includes("owed-1"));
    expect(delivered).toEqual(["owed-1"]);
    // The MCP server actually received the replayed event over the fresh socket.
    await waitFor(() => stub.received.some((m) => m.messageId === "owed-1"));
    await stub.close();
  });

  it("does NOT double-deliver: a second reconcile while connected is a no-op", async () => {
    unacked.add("owed-1");
    const delivered: string[] = [];
    setDeliveredHook((_sid, mid) => delivered.push(mid));
    installReplayFromInbox();

    const stub = await startStub(sockPath);
    setPendingSessionsProvider(async () => ["sess-abc"]);

    // First pass: connect + replay.
    await reconcileMcpConnections();
    await waitFor(() => delivered.includes("owed-1"));
    const countAfterFirst = stub.received.filter((m) => m.messageId === "owed-1").length;
    expect(countAfterFirst).toBe(1);

    // Second + third passes while the socket is live: ensureConnected() short-
    // circuits (already connected) so the replay hook does NOT fire again.
    await reconcileMcpConnections();
    await reconcileMcpConnections();
    await new Promise((r) => setTimeout(r, 80));

    expect(delivered.filter((m) => m === "owed-1")).toEqual(["owed-1"]);
    expect(stub.received.filter((m) => m.messageId === "owed-1").length).toBe(1);
    await stub.close();
  });

  it("ensureConnected returns false (no dial) when already connected", async () => {
    const stub = await startStub(sockPath);
    // Establish a live connection via a normal push.
    pushToMcpServer(SID, makeEvent({ messageId: "m1" }));
    await waitFor(() => stub.conns.length > 0);

    // Now a live socket exists — ensureConnected must be a no-op.
    expect(ensureConnected(SID)).toBe(false);
    await stub.close();
  });

  it("is a no-op when the socket file is absent (nothing to reconnect to)", async () => {
    unacked.add("owed-1");
    const delivered: string[] = [];
    setDeliveredHook((_sid, mid) => delivered.push(mid));
    installReplayFromInbox();
    expect(fs.existsSync(sockPath)).toBe(false);

    setPendingSessionsProvider(async () => ["sess-abc"]);
    expect(ensureConnected(SID)).toBe(false);
    await reconcileMcpConnections();
    await new Promise((r) => setTimeout(r, 60));
    expect(delivered).toHaveLength(0);
  });

  it("does nothing when there is no pending backlog (provider returns [])", async () => {
    const stub = await startStub(sockPath);
    const replays: string[] = [];
    setReplayHook((sid) => {
      replays.push(sid);
    });
    setPendingSessionsProvider(async () => []);

    await reconcileMcpConnections();
    await new Promise((r) => setTimeout(r, 60));
    expect(replays).toHaveLength(0);
    // No connection was opened for a session with no backlog.
    expect(stub.conns).toHaveLength(0);
    await stub.close();
  });

  it("reconcile is a no-op when no provider is installed", async () => {
    // Provider left null (the default in unit tests that don't wire the service).
    const replays: string[] = [];
    setReplayHook((sid) => {
      replays.push(sid);
    });
    await reconcileMcpConnections(); // must not throw
    expect(replays).toHaveLength(0);
  });
});
