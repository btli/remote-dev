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
} from "react";
import { usePreferencesContext } from "./PreferencesContext";
import type { ChannelGroup, Channel, ChannelMessage } from "@/types/channels";

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

  // ---------------------------------------------------------------------------
  // Channel group fetching
  // ---------------------------------------------------------------------------

  const fetchChannels = useCallback(async () => {
    if (!folderId) {
      setGroups([]);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`/api/channels?folderId=${encodeURIComponent(folderId)}`);
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
  }, [folderId]);

  // Reset state on folder change
  useEffect(() => {
    setGroups([]);
    setMessagesByChannel(new Map());
    setThreadMessages(new Map());
    setOpenThreadId(null);
    setActiveChannelIdState(null);
    fetchChannels();
  }, [folderId, fetchChannels]);

  // Refetch on tab focus
  useEffect(() => {
    function handleVisibility(): void {
      if (!document.hidden && folderId) {
        fetchChannels();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [folderId, fetchChannels]);

  const refreshChannels = useCallback(async () => {
    await fetchChannels();
  }, [fetchChannels]);

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

  const setActiveChannelId = useCallback((id: string | null) => {
    setActiveChannelIdState(id);
  }, []);

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

      if (parentMessageId) {
        // Optimistic thread reply
        setThreadMessages((prev) => {
          const current = prev.get(parentMessageId) ?? [];
          return new Map(prev).set(parentMessageId, [...current, optimistic]);
        });
      } else {
        // Optimistic channel message
        setMessagesByChannel((prev) => {
          const current = prev.get(targetChannelId) ?? [];
          return new Map(prev).set(targetChannelId, [...current, optimistic]);
        });
      }

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
            const serverMsg: ChannelMessage = data.message;

            if (parentMessageId) {
              setThreadMessages((prev) => {
                const current = prev.get(parentMessageId) ?? [];
                if (current.some((m) => m.id === serverMsg.id)) {
                  return new Map(prev).set(
                    parentMessageId,
                    current.filter((m) => m.id !== optimistic.id)
                  );
                }
                return new Map(prev).set(
                  parentMessageId,
                  current.map((m) => (m.id === optimistic.id ? serverMsg : m))
                );
              });
            } else {
              setMessagesByChannel((prev) => {
                const current = prev.get(targetChannelId) ?? [];
                if (current.some((m) => m.id === serverMsg.id)) {
                  return new Map(prev).set(
                    targetChannelId,
                    current.filter((m) => m.id !== optimistic.id)
                  );
                }
                return new Map(prev).set(
                  targetChannelId,
                  current.map((m) => (m.id === optimistic.id ? serverMsg : m))
                );
              });
            }
          }
        } else {
          // Remove optimistic on error
          if (parentMessageId) {
            setThreadMessages((prev) => {
              const current = prev.get(parentMessageId) ?? [];
              return new Map(prev).set(
                parentMessageId,
                current.filter((m) => m.id !== optimistic.id)
              );
            });
          } else {
            setMessagesByChannel((prev) => {
              const current = prev.get(targetChannelId) ?? [];
              return new Map(prev).set(
                targetChannelId,
                current.filter((m) => m.id !== optimistic.id)
              );
            });
          }
        }
      } catch {
        // Remove optimistic on network error
        if (parentMessageId) {
          setThreadMessages((prev) => {
            const current = prev.get(parentMessageId) ?? [];
            return new Map(prev).set(
              parentMessageId,
              current.filter((m) => m.id !== optimistic.id)
            );
          });
        } else {
          setMessagesByChannel((prev) => {
            const current = prev.get(targetChannelId) ?? [];
            return new Map(prev).set(
              targetChannelId,
              current.filter((m) => m.id !== optimistic.id)
            );
          });
        }
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
      if (!threadMessages.has(messageId)) {
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
    [activeChannelId, threadMessages]
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
      try {
        const resp = await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId, name, topic }),
        });
        if (resp.ok) {
          await fetchChannels();
        }
      } catch {
        // Silently fail
      }
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
      setMessagesByChannel((prev) => {
        const msgs = prev.get(message.channelId);
        if (!msgs) return prev;
        return new Map(prev).set(
          message.channelId,
          msgs.map((m) =>
            m.id === message.parentMessageId
              ? { ...m, replyCount: m.replyCount + 1 }
              : m
          )
        );
      });
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
      setActiveChannelId,
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
      setActiveChannelId,
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
