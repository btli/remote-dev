"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { ConnectionStatus } from "@/types/terminal";
import { getTerminalTheme, getThemeBackground } from "@/lib/terminal-themes";

interface TerminalProps {
  sessionId: string;
  tmuxSessionName: string;
  wsUrl?: string;
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
}

export function Terminal({
  sessionId,
  tmuxSessionName,
  wsUrl = "ws://localhost:3001",
  theme = "tokyo-night",
  fontSize = 14,
  fontFamily = "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermType | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalExitRef = useRef(false);
  const maxReconnectAttempts = 5;

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      onStatusChange?.(status);
    },
    [onStatusChange]
  );

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let terminal: XTermType;
    let fitAddon: FitAddonType;
    let mounted = true;

    // Dynamically import xterm modules (browser-only)
    async function initTerminal() {
      const [
        { Terminal: XTerm },
        { FitAddon },
        { WebLinksAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      // Also import CSS
      await import("@xterm/xterm/css/xterm.css");

      if (!mounted || !terminalRef.current) return;

      terminal = new XTerm({
        cursorBlink: true,
        fontSize,
        fontFamily,
        theme: getTerminalTheme(theme),
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
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
          onWebSocketReady?.(ws);
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
                  `\r\n\x1b[33mSession ended (exit code ${msg.code})\x1b[0m`
                );
                // Mark as intentional exit to prevent reconnection
                intentionalExitRef.current = true;
                onSessionExit?.(msg.code);
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
          onWebSocketReady?.(null);

          // Don't reconnect if this was an intentional exit (user typed "exit" or Ctrl+D)
          if (intentionalExitRef.current) {
            return;
          }

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

      // Store cleanup in closure
      return () => {
        window.removeEventListener("resize", handleResize);
        clearTimeout(resizeTimer);
      };
    }

    let cleanup: (() => void) | undefined;

    initTerminal().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    return () => {
      mounted = false;
      cleanup?.();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, tmuxSessionName, wsUrl, updateStatus]);

  // Update terminal options when preferences change
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    terminal.options.theme = getTerminalTheme(theme);
    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;

    // Refit after font changes
    fitAddonRef.current?.fit();
  }, [theme, fontSize, fontFamily]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full rounded-lg overflow-hidden"
      style={{ backgroundColor: getThemeBackground(theme) }}
    />
  );
}
