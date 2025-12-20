"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ConnectionStatus } from "@/types/terminal";

interface TerminalProps {
  sessionId: string;
  tmuxSessionName: string;
  wsUrl?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
}

// Tokyo Night theme colors
const TOKYO_NIGHT_THEME = {
  background: "#1a1b26",
  foreground: "#a9b1d6",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "#33467c",
  black: "#32344a",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#ad8ee6",
  cyan: "#449dab",
  white: "#787c99",
  brightBlack: "#444b6a",
  brightRed: "#ff7a93",
  brightGreen: "#b9f27c",
  brightYellow: "#ff9e64",
  brightBlue: "#7da6ff",
  brightMagenta: "#bb9af7",
  brightCyan: "#0db9d7",
  brightWhite: "#acb0d0",
};

export function Terminal({
  sessionId,
  tmuxSessionName,
  wsUrl = "ws://localhost:3001",
  onStatusChange,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      onStatusChange?.(status);
    },
    [onStatusChange]
  );

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: TOKYO_NIGHT_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      updateStatus("connecting");

      const cols = terminal.cols;
      const rows = terminal.rows;
      const params = new URLSearchParams({
        sessionId,
        tmuxSession: tmuxSessionName,
        cols: String(cols),
        rows: String(rows),
      });

      const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        updateStatus("connected");
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "output":
              terminal.write(msg.data);
              break;
            case "ready":
              console.log("Terminal session ready:", msg.sessionId);
              break;
            case "session_created":
              console.log("New tmux session created:", msg.tmuxSessionName);
              break;
            case "session_attached":
              console.log("Attached to existing tmux session:", msg.tmuxSessionName);
              break;
            case "exit":
              terminal.writeln(
                `\r\n\x1b[33mProcess exited with code ${msg.code}\x1b[0m`
              );
              break;
            case "error":
              terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
              break;
          }
        } catch {
          terminal.write(event.data);
        }
      };

      ws.onclose = () => {
        updateStatus("disconnected");

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          updateStatus("reconnecting");
          reconnectAttemptsRef.current++;

          terminal.writeln(
            `\r\n\x1b[33mReconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...\x1b[0m`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        } else {
          terminal.writeln(
            "\r\n\x1b[31mConnection lost. Refresh to reconnect.\x1b[0m"
          );
          updateStatus("error");
        }
      };

      ws.onerror = () => {
        console.error("WebSocket error");
      };
    }

    connect();

    terminal.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          })
        );
      }
    };

    window.addEventListener("resize", handleResize);
    // Initial fit after a short delay to ensure container is sized
    const resizeTimer = setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimer);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, tmuxSessionName, wsUrl, updateStatus]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#1a1b26] rounded-lg overflow-hidden"
    />
  );
}
