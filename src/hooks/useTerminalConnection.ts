"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import type { ConnectionStatus, TerminalDimensions, ServerMessage } from "@/types/terminal";

interface UseTerminalConnectionOptions {
  sessionId: string;
  tmuxSessionName: string;
  wsUrl?: string;
  onOutput?: (data: string) => void;
  onReady?: (sessionId: string) => void;
  onError?: (error: Error) => void;
  onExit?: (code: number) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

interface UseTerminalConnectionReturn {
  status: ConnectionStatus;
  error: Error | null;
  connect: (terminal: Terminal) => void;
  disconnect: () => void;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  reconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;

export function useTerminalConnection({
  sessionId,
  tmuxSessionName,
  wsUrl = "ws://localhost:3001",
  onOutput,
  onReady,
  onError,
  onExit,
  onStatusChange,
}: UseTerminalConnectionOptions): UseTerminalConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dimensionsRef = useRef<TerminalDimensions>({ cols: 80, rows: 24 });
  const connectRef = useRef<((terminal: Terminal) => void) | null>(null);

  const updateStatus = useCallback(
    (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        switch (msg.type) {
          case "output":
            onOutput?.(msg.data);
            break;
          case "ready":
            onReady?.(msg.sessionId);
            break;
          case "session_created":
          case "session_attached":
            console.log(`Session ${msg.type}:`, msg.sessionId);
            break;
          case "exit":
            onExit?.(msg.code);
            break;
          case "error":
            setError(new Error(msg.message));
            onError?.(new Error(msg.message));
            break;
        }
      } catch {
        // Non-JSON data - treat as raw output
        onOutput?.(event.data);
      }
    },
    [onOutput, onReady, onExit, onError]
  );

  const connect = useCallback(
    (terminal: Terminal) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      terminalRef.current = terminal;
      dimensionsRef.current = { cols: terminal.cols, rows: terminal.rows };

      updateStatus("connecting");
      setError(null);

      const params = new URLSearchParams({
        sessionId,
        tmuxSession: tmuxSessionName,
        cols: String(terminal.cols),
        rows: String(terminal.rows),
      });

      const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        updateStatus("connected");
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        updateStatus("disconnected");

        // Attempt reconnection if we haven't exhausted attempts
        if (
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS &&
          terminalRef.current
        ) {
          updateStatus("reconnecting");
          reconnectAttemptsRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            if (terminalRef.current && connectRef.current) {
              connectRef.current(terminalRef.current);
            }
          }, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        const err = new Error("WebSocket connection error");
        setError(err);
        onError?.(err);
        updateStatus("error");
      };
    },
    [sessionId, tmuxSessionName, wsUrl, handleMessage, updateStatus, onError]
  );

  // Keep connectRef in sync with the connect function (in an effect, not during render)
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    updateStatus("disconnected");
  }, [updateStatus]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    dimensionsRef.current = { cols, rows };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;

    if (terminalRef.current) {
      connect(terminalRef.current);
    }
  }, [connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    status,
    error,
    connect,
    disconnect,
    sendInput,
    resize,
    reconnect,
  };
}
