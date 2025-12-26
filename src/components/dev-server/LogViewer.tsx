"use client";

/**
 * LogViewer - Display dev server logs in a scrollable container
 *
 * This component replaces xterm.js for dev-server sessions, providing:
 * - Real-time log streaming via WebSocket
 * - Color-coded stdout (gray) vs stderr (red)
 * - Search/filter functionality
 * - Auto-scroll with manual scroll detection
 * - Clear logs button
 * - Copy logs to clipboard
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Search, X, Copy, Trash2, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogEntry, ProcessState } from "@/types/process-manager";

interface LogViewerProps {
  sessionId: string;
  wsUrl?: string;
  className?: string;
  onStatusChange?: (status: "connected" | "disconnected" | "error") => void;
  onProcessStateChange?: (state: ProcessState) => void;
}

export function LogViewer({
  sessionId,
  wsUrl,
  className,
  onStatusChange,
  onProcessStateChange,
}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  // Process state is tracked for potential future use (status display, controls)
  const processStateRef = useRef<ProcessState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Determine WebSocket URL
  const resolvedWsUrl = useMemo(() => {
    if (wsUrl) return wsUrl;
    // Default to port 3001 on same host
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.hostname}:3001`;
    }
    return "ws://localhost:3001";
  }, [wsUrl]);

  // WebSocket connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        // Fetch auth token
        const tokenRes = await fetch(`/api/sessions/${sessionId}/token`);
        if (!tokenRes.ok) {
          console.error("[LogViewer] Failed to get auth token");
          onStatusChange?.("error");
          return;
        }
        const { token } = await tokenRes.json();

        ws = new WebSocket(`${resolvedWsUrl}?token=${token}&sessionId=${sessionId}`);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[LogViewer] WebSocket connected");
          setIsConnected(true);
          onStatusChange?.("connected");
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
              case "log-history":
                setLogs(msg.entries);
                break;

              case "log-output":
                setLogs((prev) => [
                  ...prev,
                  {
                    timestamp: msg.timestamp,
                    stream: msg.stream,
                    data: msg.data,
                  },
                ]);
                break;

              case "dev-server-ready":
                if (msg.state) {
                  processStateRef.current = msg.state;
                  onProcessStateChange?.(msg.state);
                }
                break;

              case "process-exit":
                console.log("[LogViewer] Process exited:", msg.exitCode, msg.signal);
                break;

              case "logs-cleared":
                setLogs([]);
                break;
            }
          } catch (error) {
            console.error("[LogViewer] Error parsing message:", error);
          }
        };

        ws.onclose = () => {
          console.log("[LogViewer] WebSocket disconnected");
          setIsConnected(false);
          onStatusChange?.("disconnected");

          // Try to reconnect after 3 seconds
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error("[LogViewer] WebSocket error:", error);
          onStatusChange?.("error");
        };
      } catch (error) {
        console.error("[LogViewer] Connection error:", error);
        onStatusChange?.("error");
      }
    }

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [sessionId, resolvedWsUrl, onStatusChange, onProcessStateChange]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    setAutoScroll(isAtBottom);
  }, []);

  // Clear logs
  const handleClearLogs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "clear-logs" }));
    }
    setLogs([]);
  }, []);

  // Copy logs to clipboard
  const handleCopyLogs = useCallback(() => {
    const text = logs.map((entry) => entry.data).join("");
    navigator.clipboard.writeText(text).catch((err) => {
      console.error("[LogViewer] Failed to copy:", err);
    });
  }, [logs]);

  // Scroll to bottom
  const handleScrollToBottom = useCallback(() => {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Filter logs by search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs;
    const query = searchQuery.toLowerCase();
    return logs.filter((entry) => entry.data.toLowerCase().includes(query));
  }, [logs, searchQuery]);

  // Format timestamp
  const formatTimestamp = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  }, []);

  return (
    <div className={cn("flex flex-col h-full bg-slate-900 overflow-hidden", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-slate-800/50 border-b border-white/5 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="pl-8 h-8 bg-slate-800 border-slate-700 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleCopyLogs}
          className="h-8 w-8 text-slate-400 hover:text-white"
          title="Copy logs"
        >
          <Copy className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleClearLogs}
          className="h-8 w-8 text-slate-400 hover:text-white"
          title="Clear logs"
        >
          <Trash2 className="w-4 h-4" />
        </Button>

        {/* Connection status indicator */}
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            isConnected ? "bg-emerald-400" : "bg-red-400"
          )}
          title={isConnected ? "Connected" : "Disconnected"}
        />
      </div>

      {/* Log container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed min-h-0"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            {searchQuery ? "No matching logs" : "Waiting for logs..."}
          </div>
        ) : (
          filteredLogs.map((entry, idx) => (
            <div
              key={idx}
              className={cn(
                "whitespace-pre-wrap break-all",
                entry.stream === "stderr" ? "text-red-400" : "text-slate-300"
              )}
            >
              <span className="text-slate-600 mr-2 select-none">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span>{entry.data}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button (shown when not at bottom) */}
      {!autoScroll && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-4 right-4 bg-violet-500 text-white px-3 py-1.5 rounded-full text-xs font-medium shadow-lg hover:bg-violet-600 transition-colors flex items-center gap-1.5"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
