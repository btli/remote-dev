/**
 * Terminal WebSocket message types
 */

// Client -> Server messages
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "attach"; sessionId: string }
  | { type: "detach" }
  | { type: "clipboard_subscribe"; enabled: boolean }
  | { type: "clipboard_write"; data: string; updateId: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "ready"; sessionId: string }
  | { type: "exit"; code: number }
  | { type: "session_created"; sessionId: string; tmuxSessionName: string }
  | { type: "session_attached"; sessionId: string }
  | { type: "session_not_found"; sessionId: string }
  | { type: "clipboard_update"; data: string; revision: number }
  | { type: "error"; message: string };

// Terminal connection state
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface TerminalConnectionState {
  status: ConnectionStatus;
  sessionId: string | null;
  error: Error | null;
  reconnectAttempts: number;
}

// Terminal dimensions
export interface TerminalDimensions {
  cols: number;
  rows: number;
}
