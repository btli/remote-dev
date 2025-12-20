"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  wsUrl?: string;
}

export function Terminal({ wsUrl = "ws://localhost:3001" }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
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
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.writeln("Remote Dev Terminal");
    terminal.writeln("Connecting to server...\r\n");

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const cols = terminal.cols;
      const rows = terminal.rows;
      const ws = new WebSocket(`${wsUrl}?cols=${cols}&rows=${rows}`);
      wsRef.current = ws;

      ws.onopen = () => {
        terminal.writeln("\r\n\x1b[32mConnected to terminal server\x1b[0m\r\n");
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
            case "exit":
              terminal.writeln(`\r\n\x1b[33mProcess exited with code ${msg.code}\x1b[0m`);
              break;
          }
        } catch {
          terminal.write(event.data);
        }
      };

      ws.onclose = () => {
        terminal.writeln("\r\n\x1b[31mDisconnected from terminal server\x1b[0m");
        terminal.writeln("\x1b[33mReconnecting in 3 seconds...\x1b[0m\r\n");

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
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
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [wsUrl]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#1a1b26] p-2 rounded-lg"
    />
  );
}
