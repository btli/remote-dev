"use client";

/**
 * PeerChatContext - Manages folder-scoped peer chat messages for the chat room UI.
 *
 * Follows the same patterns as NotificationContext and TaskContext:
 * - Fetches initial data on folder change
 * - Accepts real-time updates via addMessage (called from WebSocket handler)
 * - Optimistic updates for user-sent messages
 * - Visibility-change re-fetch
 *
 * When ChannelContext is available (ChannelProvider mounted above), this context
 * acts as a shim: messages, sendMessage, and unreadCount delegate to ChannelContext
 * so that all UI components continue working without changes. Peers are still
 * fetched independently.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePreferencesContext } from "./PreferencesContext";
import { useChannelContextOptional } from "./ChannelContext";
import type { PeerChatMessage, PeerChatAgent } from "@/types/peer-chat";

/** Map from session ID → current display name, built from active peers. */
export type PeerNameMap = ReadonlyMap<string, string>;

interface PeerChatContextValue {
  messages: PeerChatMessage[];
  peers: PeerChatAgent[];
  /** Resolves session IDs to current display names. */
  peerNameMap: PeerNameMap;
  unreadCount: number;
  loading: boolean;
  sendMessage: (body: string) => Promise<void>;
  addMessage: (msg: PeerChatMessage) => void;
  markAllRead: () => void;
  markChatInactive: () => void;
  refresh: () => Promise<void>;
}

const PeerChatContext = createContext<PeerChatContextValue | null>(null);

export function usePeerChatContext(): PeerChatContextValue {
  const context = useContext(PeerChatContext);
  if (!context) {
    throw new Error("usePeerChatContext must be used within a PeerChatProvider");
  }
  return context;
}

const MAX_MESSAGES = 500;

interface PeerChatProviderProps {
  children: ReactNode;
}

export function PeerChatProvider({ children }: PeerChatProviderProps) {
  const { activeProject } = usePreferencesContext();
  const folderId = activeProject.folderId;

  // ChannelContext shim: when ChannelProvider is mounted above us, delegate
  // messages / sendMessage / unreadCount to it so all consumers get channel-
  // aware data without needing code changes.
  const channelCtx = useChannelContextOptional();

  const [messages, setMessages] = useState<PeerChatMessage[]>([]);
  const [peers, setPeers] = useState<PeerChatAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatActiveRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    // When ChannelContext is available, it owns message fetching; skip.
    if (channelCtx) return;

    if (!folderId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`/api/peers/messages?folderId=${folderId}&limit=200`);
      if (resp.ok) {
        const data = await resp.json();
        setMessages(data.messages ?? []);
      }
    } catch {
      // Silently fail -- messages will appear via WebSocket push
    } finally {
      setLoading(false);
    }
  }, [folderId, channelCtx]);

  const fetchPeers = useCallback(async () => {
    if (!folderId) {
      setPeers([]);
      return;
    }

    try {
      const resp = await fetch(`/api/peers/peers?folderId=${folderId}`);
      if (resp.ok) {
        const data = await resp.json();
        setPeers(data.peers ?? []);
      }
    } catch {
      // Silently fail
    }
  }, [folderId]);

  // Reset and refetch on folder change
  useEffect(() => {
    setMessages([]);
    setPeers([]);
    setUnreadCount(0);
    chatActiveRef.current = false;
    fetchMessages();
    fetchPeers();
  }, [folderId, fetchMessages, fetchPeers]);

  // Refetch on tab focus
  useEffect(() => {
    function handleVisibility(): void {
      if (!document.hidden && folderId) {
        fetchMessages();
        fetchPeers();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [folderId, fetchMessages, fetchPeers]);

  const addMessage = useCallback(
    (msg: PeerChatMessage) => {
      if (channelCtx) {
        // Route through ChannelContext when available. ChannelMessage and
        // PeerChatMessage share the same shape, so the cast is safe.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        channelCtx.addMessage(msg as any);
        return;
      }

      setMessages((prev) => {
        // Deduplicate by ID (optimistic messages may arrive again from broadcast)
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

      if (!chatActiveRef.current) {
        setUnreadCount((c) => c + 1);
      }
    },
    [channelCtx]
  );

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
    chatActiveRef.current = true;
  }, []);

  const markChatInactive = useCallback(() => {
    chatActiveRef.current = false;
  }, []);

  const sendMessage = useCallback(
    async (body: string) => {
      if (channelCtx) {
        // Delegate to ChannelContext which knows the active channel.
        await channelCtx.sendMessage(body);
        return;
      }

      if (!folderId || !body.trim()) return;

      const trimmedBody = body.trim();

      const optimistic: PeerChatMessage = {
        id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromSessionId: null,
        fromSessionName: "You",
        toSessionId: null,
        body: trimmedBody,
        isUserMessage: true,
        createdAt: new Date().toISOString(),
        channelId: null,
        parentMessageId: null,
        replyCount: 0,
      };
      setMessages((prev) => [...prev, optimistic]);

      try {
        // Server handles @name → @<sid:UUID> mention resolution authoritatively
        const resp = await fetch("/api/peers/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId, body: trimmedBody }),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.message) {
            // Replace optimistic with server message, or remove if it already arrived via broadcast
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) {
                return prev.filter((m) => m.id !== optimistic.id);
              }
              return prev.map((m) => (m.id === optimistic.id ? { ...data.message } : m));
            });
          }
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        }
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      }
    },
    [folderId, channelCtx]
  );

  const refresh = useCallback(async () => {
    await Promise.all([fetchMessages(), fetchPeers()]);
  }, [fetchMessages, fetchPeers]);

  // Build session ID → current name map from active peers.
  // When a peer is renamed, the peers list updates and the map rebuilds,
  // causing all message bubbles to show the new name instantly.
  const peerNameMap = useMemo<PeerNameMap>(() => {
    const map = new Map<string, string>();
    for (const peer of peers) {
      map.set(peer.sessionId, peer.name);
    }
    return map;
  }, [peers]);

  // When ChannelContext is available, use its activeChannelMessages (cast to
  // PeerChatMessage[] since the shapes are compatible) and totalUnreadCount.
  const effectiveMessages = channelCtx
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (channelCtx.activeChannelMessages as any as PeerChatMessage[])
    : messages;
  const effectiveLoading = channelCtx ? channelCtx.loading : loading;
  const effectiveUnreadCount = channelCtx ? channelCtx.totalUnreadCount : unreadCount;

  const value = useMemo<PeerChatContextValue>(
    () => ({
      messages: effectiveMessages,
      peers,
      peerNameMap,
      unreadCount: effectiveUnreadCount,
      loading: effectiveLoading,
      sendMessage,
      addMessage,
      markAllRead,
      markChatInactive,
      refresh,
    }),
    [
      effectiveMessages,
      peers,
      peerNameMap,
      effectiveUnreadCount,
      effectiveLoading,
      sendMessage,
      addMessage,
      markAllRead,
      markChatInactive,
      refresh,
    ]
  );

  return (
    <PeerChatContext.Provider value={value}>
      {children}
    </PeerChatContext.Provider>
  );
}
