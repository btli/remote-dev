/** Channel type discriminator. */
export type ChannelType = "public" | "dm" | "system";

/** A channel group (e.g., "Channels", "Direct Messages"). */
export interface ChannelGroup {
  id: string;
  folderId: string;
  name: string;
  position: number;
  channels: Channel[];
}

/** A channel within a group. */
export interface Channel {
  id: string;
  folderId: string;
  groupId: string;
  name: string;
  displayName: string;
  type: ChannelType;
  topic: string | null;
  isDefault: boolean;
  lastMessageAt: string | null;
  messageCount: number;
  unreadCount: number;
  createdAt: string;
}

/** A message within a channel, including thread metadata. */
export interface ChannelMessage {
  id: string;
  channelId: string;
  fromSessionId: string | null;
  fromSessionName: string;
  toSessionId: string | null;
  body: string;
  isUserMessage: boolean;
  parentMessageId: string | null;
  replyCount: number;
  createdAt: string;
}
