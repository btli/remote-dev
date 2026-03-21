"use client";

/**
 * LoopMessageBubble — Individual chat message renderer
 *
 * Renders user, agent, and system messages with appropriate styling:
 * - User messages: right-aligned, accent background
 * - Agent messages: left-aligned, card background, supports markdown
 * - System messages: centered, muted
 * - Tool calls: collapsed disclosure with tool name
 */

import { useState } from "react";
import { Bot, User, ChevronDown, ChevronRight, Wrench, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/loop-agent";

interface LoopMessageBubbleProps {
  message: ChatMessage;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AgentBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-start gap-2 max-w-[85%]">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mt-1">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <span className="text-[10px] text-muted-foreground/60 pl-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mt-1">
        <User className="w-3.5 h-3.5 text-blue-400" />
      </div>
      <div className="flex flex-col gap-0.5 items-end">
        <div className="bg-blue-600/20 border border-blue-500/30 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <span className="text-[10px] text-muted-foreground/60 pr-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

function ToolCallBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2 max-w-[85%]">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center mt-1">
        <Wrench className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 bg-card/50 border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-card transition-colors text-left"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          <span className="font-mono truncate">
            {message.toolName ?? "tool"}
          </span>
        </button>
        {expanded && (
          <div className="bg-card/30 border border-border/30 rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all overflow-x-auto max-h-48 overflow-y-auto">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemBubble({ message }: { message: ChatMessage }) {
  const isError = message.kind === "error";

  return (
    <div className="flex justify-center">
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs",
          isError
            ? "bg-red-500/10 text-red-400 border border-red-500/20"
            : "bg-muted/30 text-muted-foreground"
        )}
      >
        {isError && <AlertCircle className="w-3 h-3" />}
        {message.content}
      </div>
    </div>
  );
}

function IterationMarker({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
        Iteration {message.iterationNumber}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

export function LoopMessageBubble({ message }: LoopMessageBubbleProps) {
  switch (message.kind) {
    case "iteration_marker":
      return <IterationMarker message={message} />;

    case "tool_call":
    case "tool_result":
      return <ToolCallBubble message={message} />;

    case "error":
      return <SystemBubble message={message} />;

    case "text":
    case "thinking":
    default: {
      if (message.role === "system") return <SystemBubble message={message} />;
      if (message.role === "user") return <UserBubble message={message} />;
      return <AgentBubble message={message} />;
    }
  }
}
