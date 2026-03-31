/**
 * Client-safe types for the peer chat room UI.
 *
 * These mirror the server-side PeerMessage/PeerInfo types from peer-service.ts
 * but are safe to import in client components (no server-only dependencies).
 */

/** A message in the peer chat room. Mirrors PeerMessage from PeerService. */
export interface PeerChatMessage {
  id: string;
  fromSessionId: string | null;
  fromSessionName: string;
  toSessionId: string | null;
  body: string;
  isUserMessage: boolean;
  createdAt: string; // ISO string
}

/** Info about an active agent peer. Subset of PeerInfo from PeerService. */
export interface PeerChatAgent {
  sessionId: string;
  name: string;
  agentProvider: string | null;
  agentActivityStatus: string | null;
  peerSummary: string | null;
  isConnected: boolean;
}

/** The active view in the folder tab bar. */
export type ActiveView = "terminal" | "chat";
