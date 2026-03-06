/**
 * Terminal WebSocket message types
 */

/** Prefix byte for binary voice audio frames sent over WebSocket */
export const VOICE_AUDIO_PREFIX = 0x01;

// Client -> Server messages
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "attach"; sessionId: string }
  | { type: "detach" }
  | { type: "voice_start" }
  | { type: "voice_stop" };

// Server -> Client messages
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "ready"; sessionId: string }
  | { type: "exit"; code: number }
  | { type: "session_created"; sessionId: string; tmuxSessionName: string }
  | { type: "session_attached"; sessionId: string }
  | { type: "session_not_found"; sessionId: string }
  | { type: "error"; message: string }
  | { type: "voice_ready"; sessionId: string }
  | { type: "voice_error"; message: string };

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
