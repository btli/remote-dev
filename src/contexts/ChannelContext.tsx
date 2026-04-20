"use client";

/**
 * ChannelContext - Primary chat state manager for channel-aware messaging.
 *
 * Manages channel groups, per-channel message cache, thread state, and unread
 * tracking. Follows the same patterns as TaskContext and PeerChatContext:
 * - Fetches initial data on folder change
 * - Accepts real-time updates via addMessage / addThreadReply / addChannel
 * - Optimistic updates for user-sent messages
 * - Visibility-change re-fetch
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
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePreferencesContext } from "./PreferencesContext";
import { useProjectTree } from "./ProjectTreeContext";
import type { ChannelGroup, Channel, ChannelMessage } from "@/types/channels";

// ---------------------------------------------------------------------------
// Map update helpers — reduces duplication in optimistic update logic
// ---------------------------------------------------------------------------

type MapSetter<V> = Dispatch<SetStateAction<Map<string, V[]>>>;

/** Replace an optimistic message with the server version, or remove it if already present. */
function reconcileOptimistic(
  setter: MapSetter<ChannelMessage>,
  key: string,
  optimisticId: string,
  serverMsg: ChannelMessage
): void {
  setter((prev) => {
    const current = prev.get(key) ?? [];
    if (current.some((m) => m.id === serverMsg.id)) {
      // Server message already arrived via WebSocket — just remove the optimistic one
      return new Map(prev).set(key, current.filter((m) => m.id !== optimisticId));
    }
    return new Map(prev).set(key, current.map((m) => (m.id === optimisticId ? serverMsg : m)));
  });
}

/** Remove an optimistic message (on error). */
function removeOptimistic(
  setter: MapSetter<ChannelMessage>,
  key: string,
  optimisticId: string
): void {
  setter((prev) => {
    const current = prev.get(key) ?? [];
    return new Map(prev).set(key, current.filter((m) => m.id !== optimisticId));
  });
}

/** Increment a parent message's replyCount in the channel message map. */
function incrementParentReplyCount(
  setter: MapSetter<ChannelMessage>,
  channelId: string,
  parentId: string
): void {
  setter((prev) => {
    const msgs = prev.get(channelId);
    if (!msgs) return prev;
    return new Map(prev).set(
      channelId,
      msgs.map((m) => (m.id === parentId ? { ...m, replyCount: m.replyCount + 1 } : m))
    );
  });
}

interface ChannelContextValue {
  groups: ChannelGroup[];
  activeChannelId: string | null;
  setActiveChannelId: (id: string | null) => void;
  activeChannelMessages: ChannelMessage[];
  totalUnreadCount: number;
  loading: boolean;
  sendMessage: (body: string, parentMessageId?: string) => Promise<void>;
  markChannelRead: (channelId: string, messageId: string) => Promise<void>;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  openThreadId: string | null;
  threadMessages: ChannelMessage[];
  refreshChannels: () => Promise<void>;
  createChannel: (name: string, topic?: string) => Promise<void>;
  /** Called by WebSocket handler when a channel message arrives. */
  addMessage: (message: ChannelMessage) => void;
  /** Called by WebSocket handler when a thread reply arrives. */
  addThreadReply: (parentId: string, message: ChannelMessage) => void;
  /** Called by WebSocket handler when a new channel is created. */
  addChannel: (channel: Channel) => void;
}

const ChannelContext = createContext<ChannelContextValue | null>(null);

export function useChannelContext(): ChannelContextValue {
  const context = useContext(ChannelContext);
  if (!context) {
    throw new Error("useChannelContext must be used within a ChannelProvider");
  }
  return context;
}

/** Returns the context or null if the provider is not mounted. */
export function useChannelContextOptional(): ChannelContextValue | null {
  return useContext(ChannelContext);
}

interface ChannelProviderProps {
  children: ReactNode;
}

export function ChannelProvider({ children }: ChannelProviderProps) {
  const { activeProject } = usePreferencesContext();
  const folderId = activeProject.folderId;
  const { activeNode } = useProjectTree();

  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [activeChannelId, setActiveChannelIdState] = useState<string | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;
  const [messagesByChannel, setMessagesByChannel] = useState<Map<string, ChannelMessage[]>>(
    new Map()
  );
  const [threadMessages, setThreadMessages] = useState<Map<string, ChannelMessage[]>>(new Map());
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const threadMessagesRef = useRef(threadMessages);
  threadMessagesRef.current = threadMessages;

  // ---------------------------------------------------------------------------
  // Channel group fetching
  // ---------------------------------------------------------------------------

  const fetchChannels = useCallback(async () => {
    // Phase 4: prefer node-scoped fetching so group nodes aggregate across
    // descendant projects. Fall back to the legacy folder scope when no
    // active node has been selected yet (first paint, pre-migration).
    const query = activeNode
      ? `nodeId=${encodeURIComponent(activeNode.id)}&nodeType=${activeNode.type}`
      : folderId
        ? `folderId=${encodeURIComponent(folderId)}`
        : null;

    if (!query) {
      setGroups([]);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`/api/channels?${query}`);
      if (resp.ok) {
        const data = await resp.json();
        const fetchedGroups: ChannelGroup[] = data.groups ?? [];
        setGroups(fetchedGroups);

        // Auto-select the default channel when loading channels for a folder
        setActiveChannelIdState((prev) => {
          // If already have a valid channel in this folder, keep it
          if (prev) {
            const existsInFetched = fetchedGroups.some((g) =>
              g.channels.some((c) => c.id === prev)
            );
            if (existsInFetched) return prev;
          }
          // Find and select the default channel
          for (const group of fetchedGroups) {
            const defaultChannel = group.channels.find((c) => c.isDefault);
            if (defaultChannel) return defaultChannel.id;
          }
          // Fall back to the first channel
          if (fetchedGroups.length > 0 && fetchedGroups[0].channels.length > 0) {
            return fetchedGroups[0].channels[0].id;
          }
          return null;
        });
      }
    } catch {
      // Silently fail -- channels will still be visible from cache
    } finally {
      setLoading(false);
    }
  }, [folderId, activeNode]);

  // Reset state on scope change (folder or active node)
  useEffect(() => {
    setGroups([]);
    setMessagesByChannel(new Map());
    setThreadMessages(new Map());
    setOpenThreadId(null);
    setActiveChannelIdState(null);
    fetchChannels();
  }, [folderId, activeNode, fetchChannels]);

  // Refetch on tab focus
  useEffect(() => {
    function handleVisibility(): void {
      if (!document.hidden && (folderId || activeNode)) {
        fetchChannels();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [folderId, activeNode, fetchChannels]);

  const refreshChannels = fetchChannels;

  // ---------------------------------------------------------------------------
  // Message fetching for the active channel
  // ---------------------------------------------------------------------------

  const fetchMessages = useCallback(async (channelId: string) => {
    try {
      const resp = await fetch(
        `/api/channels/${encodeURIComponent(channelId)}/messages?limit=50`
      );
      if (resp.ok) {
        const data = await resp.json();
        const msgs: ChannelMessage[] = data.messages ?? [];
        setMessagesByChannel((prev) => new Map(prev).set(channelId, msgs));
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (!activeChannelId) return;
    // Only fetch if we don't have messages cached yet
    if (!messagesByChannel.has(activeChannelId)) {
      fetchMessages(activeChannelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, fetchMessages]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (body: string, parentMessageId?: string) => {
      if (!activeChannelId || !body.trim()) return;

      const trimmedBody = body.trim();
      const targetChannelId = activeChannelId;

      const optimistic: ChannelMessage = {
        id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        channelId: targetChannelId,
        fromSessionId: null,
        fromSessionName: "You",
        toSessionId: null,
        body: trimmedBody,
        isUserMessage: true,
        parentMessageId: parentMessageId ?? null,
        replyCount: 0,
        createdAt: new Date().toISOString(),
      };

      // Determine which map and key to use for optimistic updates
      const [setter, key] = parentMessageId
        ? [setThreadMessages, parentMessageId] as const
        : [setMessagesByChannel, targetChannelId] as const;

      // Add optimistic message
      setter((prev) => {
        const current = prev.get(key) ?? [];
        return new Map(prev).set(key, [...current, optimistic]);
      });

      try {
        const resp = await fetch(
          `/api/channels/${encodeURIComponent(targetChannelId)}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: trimmedBody, parentMessageId }),
          }
        );

        if (resp.ok) {
          const data = await resp.json();
          if (data.message) {
            reconcileOptimistic(setter, key, optimistic.id, data.message);
          }
        } else {
          removeOptimistic(setter, key, optimistic.id);
        }
      } catch {
        removeOptimistic(setter, key, optimistic.id);
      }
    },
    [activeChannelId]
  );

  // ---------------------------------------------------------------------------
  // Mark channel read
  // ---------------------------------------------------------------------------

  const markChannelRead = useCallback(async (channelId: string, messageId: string) => {
    try {
      await fetch(`/api/channels/${encodeURIComponent(channelId)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      // Update local unread count for the channel
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          channels: g.channels.map((c) =>
            c.id === channelId ? { ...c, unreadCount: 0 } : c
          ),
        }))
      );
    } catch {
      // Silently fail
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Thread management
  // ---------------------------------------------------------------------------

  const openThread = useCallback(
    async (messageId: string) => {
      setOpenThreadId(messageId);
      // Fetch thread replies if not cached
      if (!threadMessagesRef.current.has(messageId)) {
        try {
          const channelId = activeChannelId;
          if (!channelId) return;
          const resp = await fetch(
            `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/thread`
          );
          if (resp.ok) {
            const data = await resp.json();
            setThreadMessages((prev) =>
              new Map(prev).set(messageId, data.replies ?? [])
            );
          }
        } catch {
          // Silently fail
        }
      }
    },
    [activeChannelId]
  );

  const closeThread = useCallback(() => {
    setOpenThreadId(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Create channel
  // ---------------------------------------------------------------------------

  const createChannel = useCallback(
    async (name: string, topic?: string) => {
      if (!folderId) return;
      const resp = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, name, topic }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to create channel");
      }
      await fetchChannels();
    },
    [folderId, fetchChannels]
  );

  // ---------------------------------------------------------------------------
  // WebSocket push handlers
  // ---------------------------------------------------------------------------

  const addMessage = useCallback((message: ChannelMessage) => {
    if (message.parentMessageId) {
      // It's a thread reply -- add to thread cache if that thread is open
      setThreadMessages((prev) => {
        const current = prev.get(message.parentMessageId!);
        if (!current) return prev; // thread not loaded, skip
        if (current.some((m) => m.id === message.id)) return prev; // dedup
        return new Map(prev).set(message.parentMessageId!, [...current, message]);
      });
      // Also increment replyCount on the parent in messagesByChannel
      incrementParentReplyCount(setMessagesByChannel, message.channelId, message.parentMessageId!);
    } else {
      setMessagesByChannel((prev) => {
        const current = prev.get(message.channelId) ?? [];
        if (current.some((m) => m.id === message.id)) return prev; // dedup
        return new Map(prev).set(message.channelId, [...current, message]);
      });
    }

    // Bump unread count for channels we're not currently viewing
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        channels: g.channels.map((c) => {
          if (c.id !== message.channelId) return c;
          if (message.isUserMessage) return c;
          if (c.id === activeChannelIdRef.current) return c; // currently viewing
          return { ...c, unreadCount: c.unreadCount + 1 };
        }),
      }))
    );
  }, []);

  const addThreadReply = useCallback((parentId: string, message: ChannelMessage) => {
    setThreadMessages((prev) => {
      const current = prev.get(parentId);
      if (!current) return prev;
      if (current.some((m) => m.id === message.id)) return prev;
      return new Map(prev).set(parentId, [...current, message]);
    });
    // Also bump parent's replyCount in messagesByChannel
    incrementParentReplyCount(setMessagesByChannel, message.channelId, parentId);
  }, []);

  const addChannel = useCallback((channel: Channel) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== channel.groupId) return g;
        if (g.channels.some((c) => c.id === channel.id)) return g;
        return { ...g, channels: [...g.channels, channel] };
      })
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeChannelMessages = useMemo(
    () => (activeChannelId ? messagesByChannel.get(activeChannelId) ?? [] : []),
    [activeChannelId, messagesByChannel]
  );

  const currentThreadMessages = useMemo(
    () => (openThreadId ? threadMessages.get(openThreadId) ?? [] : []),
    [openThreadId, threadMessages]
  );

  const totalUnreadCount = useMemo(
    () =>
      groups.reduce(
        (sum, g) => sum + g.channels.reduce((cs, c) => cs + c.unreadCount, 0),
        0
      ),
    [groups]
  );

  const value = useMemo<ChannelContextValue>(
    () => ({
      groups,
      activeChannelId,
      setActiveChannelId: setActiveChannelIdState,
      activeChannelMessages,
      totalUnreadCount,
      loading,
      sendMessage,
      markChannelRead,
      openThread,
      closeThread,
      openThreadId,
      threadMessages: currentThreadMessages,
      refreshChannels,
      createChannel,
      addMessage,
      addThreadReply,
      addChannel,
    }),
    [
      groups,
      activeChannelId,
      setActiveChannelIdState,
      activeChannelMessages,
      totalUnreadCount,
      loading,
      sendMessage,
      markChannelRead,
      openThread,
      closeThread,
      openThreadId,
      currentThreadMessages,
      refreshChannels,
      createChannel,
      addMessage,
      addThreadReply,
      addChannel,
    ]
  );

  return <ChannelContext.Provider value={value}>{children}</ChannelContext.Provider>;
}
