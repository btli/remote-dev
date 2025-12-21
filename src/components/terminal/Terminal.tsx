"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { ImageAddon as ImageAddonType } from "@xterm/addon-image";
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
  const imageAddonRef = useRef<ImageAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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
        { ImageAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-image"),
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
      const imageAddon = new ImageAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(imageAddon);

      terminal.open(terminalRef.current);
      fitAddon.fit();

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      imageAddonRef.current = imageAddon;

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

      // Use ResizeObserver to detect when terminal container becomes visible
      // This handles the case when switching tabs (hidden -> visible)
      let lastWidth = 0;
      let lastHeight = 0;
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          // Only trigger resize when dimensions actually change from non-zero to new values
          // This catches the transition from hidden (0x0) to visible
          if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
            lastWidth = width;
            lastHeight = height;
            handleResize();
          }
        }
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      // Store cleanup in closure
      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
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
      imageAddonRef.current?.dispose();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      imageAddonRef.current = null;
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

  // Encode image as iTerm2 OSC 1337 escape sequence
  const encodeImageAsOSC1337 = useCallback(
    async (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          const nameBase64 = btoa(file.name);
          // OSC 1337 format: \x1b]1337;File=name=<base64name>;size=<bytes>;inline=1:<base64data>\x07
          const sequence = `\x1b]1337;File=name=${nameBase64};size=${file.size};inline=1:${base64}\x07`;
          resolve(sequence);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },
    []
  );

  // Send image through WebSocket as terminal input
  const sendImageToTerminal = useCallback(
    async (file: File) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not connected");
        return;
      }

      try {
        const sequence = await encodeImageAsOSC1337(file);
        wsRef.current.send(JSON.stringify({ type: "input", data: sequence }));
      } catch (error) {
        console.error("Failed to encode image:", error);
      }
    },
    [encodeImageAsOSC1337]
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));

      for (const file of imageFiles) {
        await sendImageToTerminal(file);
      }
    },
    [sendImageToTerminal]
  );

  // Handle paste events for images
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      if (imageItems.length === 0) return;

      e.preventDefault();

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          await sendImageToTerminal(file);
        }
      }
    },
    [sendImageToTerminal]
  );

  return (
    <div
      ref={terminalRef}
      className={`h-full w-full rounded-lg overflow-hidden relative ${
        isDragging ? "ring-2 ring-blue-500 ring-opacity-50" : ""
      }`}
      style={{ backgroundColor: getThemeBackground(theme) }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-background/90 px-4 py-2 rounded-lg border border-blue-500/50 text-sm">
            Drop image to paste
          </div>
        </div>
      )}
    </div>
  );
}
