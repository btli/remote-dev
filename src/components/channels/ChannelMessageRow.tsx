"use client";

import React, { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, MessageSquare } from "lucide-react";
import type { ChannelMessage } from "@/types/channels";

// Mention token pattern: @<sid:UUID>
const MENTION_RE = /@<sid:([0-9a-f-]{36})>/g;

interface ChannelMessageRowProps {
  message: ChannelMessage;
  peerNameMap: Map<string, string>;
  onReplyClick?: (messageId: string) => void;
  isThreadReply?: boolean;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Pre-process message body to replace @<sid:UUID> mention tokens with
 * displayable text. Returns a version of the body where mentions are replaced
 * with @name (or @shortId) so ReactMarkdown can render them as plain text.
 * Also returns a map of placeholder → ReactNode for inline rendering.
 */
function buildMentionSegments(
  body: string,
  peerNameMap: Map<string, string>
): ReactNode {
  const matches = Array.from(body.matchAll(MENTION_RE));
  if (matches.length === 0) return body;

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const matchIndex = match.index!;
    if (matchIndex > lastIndex) {
      parts.push(body.slice(lastIndex, matchIndex));
    }

    const sessionId = match[1];
    const name = peerNameMap.get(sessionId);
    parts.push(
      <span
        key={`mention-${matchIndex}`}
        className="text-primary font-medium"
        title={name ? `Session: ${sessionId}` : `Unknown session: ${sessionId}`}
      >
        @{name ?? sessionId.slice(0, 8)}
      </span>
    );

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return <>{parts}</>;
}

/**
 * Replace mention tokens in a string with a plain-text representation so
 * ReactMarkdown can safely parse the body without the custom token syntax
 * interfering with markdown parsing.
 */
function preprocessBodyForMarkdown(
  body: string,
  peerNameMap: Map<string, string>
): string {
  return body.replace(MENTION_RE, (_match, sessionId) => {
    const name = peerNameMap.get(sessionId);
    return `@${name ?? sessionId.slice(0, 8)}`;
  });
}

export function ChannelMessageRow({
  message,
  peerNameMap,
  onReplyClick,
  isThreadReply = false,
}: ChannelMessageRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const processedBody = preprocessBodyForMarkdown(message.body, peerNameMap);

  const senderName = message.isUserMessage ? "You" : message.fromSessionName;
  const timestamp = formatTime(message.createdAt);

  const avatarElement = message.isUserMessage ? (
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
      <User className="w-3.5 h-3.5 text-blue-400" />
    </div>
  ) : (
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
      <Bot className="w-3.5 h-3.5 text-primary" />
    </div>
  );

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-1.5 rounded-lg transition-colors ${
        isHovered ? "bg-white/5" : "bg-transparent"
      } ${isThreadReply ? "pl-6" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Avatar */}
      <div className="mt-0.5">{avatarElement}</div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header: sender name + timestamp */}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span
            className={`text-sm font-semibold ${
              message.isUserMessage ? "text-blue-300" : "text-primary"
            }`}
          >
            {senderName}
          </span>
          <span className="text-[10px] text-muted-foreground/50 select-none">
            {timestamp}
          </span>
        </div>

        {/* Markdown body */}
        <div className="text-sm text-foreground/90 leading-relaxed prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  {children}
                </a>
              ),
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                return isInline ? (
                  <code
                    className="bg-white/10 px-1 py-0.5 rounded text-sm font-mono"
                    {...props}
                  >
                    {children}
                  </code>
                ) : (
                  <pre className="bg-black/30 p-3 rounded-lg overflow-x-auto my-2">
                    <code className={`${className ?? ""} font-mono`} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
              ul: ({ children }) => (
                <ul className="list-disc pl-4 mb-1">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-4 mb-1">{children}</ol>
              ),
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-white/20 pl-3 my-1 text-white/60">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-2">
                  <table className="min-w-full border-collapse">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-white/10 px-2 py-1 text-left text-sm font-medium bg-white/5">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-white/10 px-2 py-1 text-sm">
                  {children}
                </td>
              ),
              h1: ({ children }) => (
                <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold mt-1.5 mb-0.5">
                  {children}
                </h3>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">
                  {children}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic text-foreground/80">{children}</em>
              ),
              hr: () => <hr className="border-white/10 my-2" />,
            }}
          >
            {processedBody}
          </ReactMarkdown>
        </div>

        {/* Reply chip — shown when there are replies and we're not already in a thread */}
        {!isThreadReply && message.replyCount > 0 && (
          <button
            onClick={() => onReplyClick?.(message.id)}
            className="flex items-center gap-1.5 mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            {message.replyCount}{" "}
            {message.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      {/* Hover action: Reply button */}
      {!isThreadReply && isHovered && (
        <div className="absolute right-3 top-1.5 flex items-center gap-1">
          <button
            onClick={() => onReplyClick?.(message.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-card border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Reply in thread"
          >
            <MessageSquare className="w-3 h-3" />
            Reply
          </button>
        </div>
      )}
    </div>
  );
}
