import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { parse } from "url";

interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

export function createTerminalServer(port: number = 3001) {
  const wss = new WebSocketServer({ port });

  console.log(`Terminal WebSocket server running on ws://localhost:${port}`);

  wss.on("connection", (ws, req) => {
    const sessionId = crypto.randomUUID();
    const query = parse(req.url || "", true).query;
    const cols = parseInt(query.cols as string) || 80;
    const rows = parseInt(query.rows as string) || 24;

    const shell = process.platform === "win32" ? "powershell.exe" : "zsh";
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: process.env as Record<string, string>,
    });

    sessions.set(sessionId, { pty: ptyProcess, ws });

    console.log(`Terminal session ${sessionId} started (${cols}x${rows})`);

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Terminal session ${sessionId} exited with code ${exitCode}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
      sessions.delete(sessionId);
    });

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            ptyProcess.resize(msg.cols, msg.rows);
            break;
        }
      } catch {
        // Raw input fallback
        ptyProcess.write(message.toString());
      }
    });

    ws.on("close", () => {
      console.log(`Terminal session ${sessionId} closed`);
      ptyProcess.kill();
      sessions.delete(sessionId);
    });

    ws.on("error", (error) => {
      console.error(`Terminal session ${sessionId} error:`, error);
      ptyProcess.kill();
      sessions.delete(sessionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId }));
  });

  return wss;
}

// Cleanup on exit
process.on("SIGINT", () => {
  console.log("Shutting down terminal sessions...");
  for (const [id, session] of sessions) {
    session.pty.kill();
    session.ws.close();
    console.log(`Closed session ${id}`);
  }
  process.exit(0);
});
