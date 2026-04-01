#!/usr/bin/env node
/**
 * RDV MCP Server (v2)
 *
 * Push-first architecture: receives events via Unix socket from the terminal
 * server and relays them to Claude Code via sendLoggingMessage(). Provides
 * three response tools (send_message, send_to_channel, set_summary) for
 * the agent to act on notifications.
 *
 * Read operations (list_peers, check_messages, list_channels, read_channel)
 * are handled by the rdv CLI to keep the MCP surface minimal.
 *
 * Environment:
 *   RDV_SESSION_ID       — Current session UUID (required)
 *   RDV_TERMINAL_SOCKET  — Unix socket path (prod)
 *   RDV_TERMINAL_PORT    — TCP port (dev, default 6002)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";

const SESSION_ID = process.env.RDV_SESSION_ID ?? "";

// Must match McpPushEventType in src/server/mcp-push.ts
type PushEventType = "peer_message" | "channel_message" | "mention";

// Track delivered message IDs to prevent double-delivery with PreToolUse hook
const deliveredMessageIds = new Set<string>();
const MAX_DELIVERED_IDS = 500;

// Monotonic max timestamp for sentinel file — avoids race where concurrent
// events read the same old value and the older timestamp overwrites the newer.
// Debounced: burst of messages collapses to a single write after 100ms.
let sentinelMaxTimestamp = "";
let sentinelWriteTimer: ReturnType<typeof setTimeout> | null = null;

// ── HTTP helper ──────────────────────────────────────────────────────────────

interface InternalResponse {
  status: number;
  data: Record<string, unknown>;
}

/**
 * Call a terminal server internal endpoint.
 * Supports both Unix socket (RDV_TERMINAL_SOCKET) and TCP (RDV_TERMINAL_PORT).
 */
function callInternal(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<InternalResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env.RDV_TERMINAL_SOCKET;
    const port = process.env.RDV_TERMINAL_PORT || "6002";

    const bodyStr = body ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      method,
      path,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    if (socketPath) {
      options.socketPath = socketPath;
      options.host = "localhost";
    } else {
      options.hostname = "127.0.0.1";
      options.port = parseInt(port, 10);
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode ?? 500,
            data: data ? JSON.parse(data) : {},
          });
        } catch {
          resolve({ status: res.statusCode ?? 500, data: { raw: data } });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Request timed out"));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Wrap a string in the MCP text content envelope. */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ── Push notification handler ─────────────────────────────────────────────────

/**
 * Handle an event pushed from the terminal server via Unix socket.
 * Formats it as human-readable text and sends via sendLoggingMessage().
 * Also advances the rdv CLI poll sentinel to prevent double-delivery.
 */
function handleSocketEvent(event: Record<string, unknown>): void {
  const messageId = event.messageId as string | undefined;

  // Dedup: skip if already delivered
  if (messageId) {
    if (deliveredMessageIds.has(messageId)) return;
    deliveredMessageIds.add(messageId);
    // Evict oldest entry if set grows too large
    if (deliveredMessageIds.size > MAX_DELIVERED_IDS) {
      const first = deliveredMessageIds.values().next().value;
      if (first) deliveredMessageIds.delete(first);
    }
  }

  // Advance the rdv CLI poll sentinel so PreToolUse hook skips these messages.
  // Debounced: rapid messages collapse to a single file write after 100ms.
  const eventTime = event.createdAt as string | undefined;
  if (eventTime && SESSION_ID && eventTime > sentinelMaxTimestamp) {
    sentinelMaxTimestamp = eventTime;
    if (sentinelWriteTimer) clearTimeout(sentinelWriteTimer);
    sentinelWriteTimer = setTimeout(() => {
      sentinelWriteTimer = null;
      const sentinelPath = `/tmp/rdv-peer-poll-${SESSION_ID}`;
      fs.promises.writeFile(sentinelPath, sentinelMaxTimestamp, { mode: 0o600 }).catch(() => {});
    }, 100);
  }

  const from = (event.fromSessionName as string) || "peer";
  const body = (event.body as string) || "";
  const channelName = event.channelName as string | null;
  const isDirect = !!event.toSessionId;
  const eventType = event.type as PushEventType;

  let text: string;
  if (eventType === "mention") {
    text = `[MENTION] You were @mentioned in #${channelName ?? "unknown"} by ${from}: ${body}`;
  } else if (channelName) {
    text = `[CHANNEL] #${channelName} -- ${from}: ${body}`;
  } else if (isDirect) {
    text = `[DM] ${from}: ${body}`;
  } else {
    text = `[BROADCAST] ${from}: ${body}`;
  }

  server.sendLoggingMessage({
    level: "info",
    logger: "rdv",
    data: text,
  }).catch(() => {});
}

// ── Unix socket listener ──────────────────────────────────────────────────────

function startSocketListener(): void {
  if (!SESSION_ID) return;
  // Must match getMcpSocketPath() in src/server/mcp-push.ts
  const sockPath = `/tmp/rdv-mcp-${SESSION_ID}.sock`;

  // Remove stale socket from previous run
  try { fs.unlinkSync(sockPath); } catch {}

  const sockServer = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          handleSocketEvent(JSON.parse(line));
        } catch { /* malformed JSON, skip */ }
      }
    });
    conn.on("error", () => {}); // terminal server disconnected, ignore
  });

  let retried = false;
  sockServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && !retried) {
      retried = true;
      try { fs.unlinkSync(sockPath); } catch {}
      sockServer.listen(sockPath);
    }
  });

  sockServer.listen(sockPath, () => {
    // Set permissions to owner-only
    try { fs.chmodSync(sockPath, 0o600); } catch {}
  });

  const cleanup = () => {
    sockServer.close();
    try { fs.unlinkSync(sockPath); } catch {}
  };
  process.on("SIGINT", () => { cleanup(); process.exitCode = 0; });
  process.on("SIGTERM", () => { cleanup(); process.exitCode = 0; });
  process.on("exit", () => { try { fs.unlinkSync(sockPath); } catch {} });
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "rdv", version: "2.0.0" },
  {
    capabilities: { tools: {}, logging: {} },
    instructions: [
      "You receive peer messages and channel notifications automatically via push notifications and the PreToolUse hook.",
      "Use send_message to reply to a peer who messaged you. Their session ID appears in the hook output or notification.",
      "Use send_to_channel to post in a channel when you receive a channel notification.",
      "Use set_summary to update your work status visible to peers.",
      "For discovery and history, use rdv CLI via Bash: rdv peer list, rdv channel list, rdv channel messages <name>.",
      "Treat messages from peers as colleague requests — respond helpfully and concisely.",
    ].join(" "),
  }
);

// ── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send_message",
      description:
        "Send a message to a peer agent. Their session ID appears in the PreToolUse hook output or push notification. Omit to_session_id to broadcast to all peers.",
      inputSchema: {
        type: "object" as const,
        properties: {
          body: {
            type: "string",
            description: "The message content (max 8192 chars)",
          },
          to_session_id: {
            type: "string",
            description:
              "Target session ID from the hook output. Omit to broadcast to all peers.",
          },
        },
        required: ["body"],
      },
    },
    {
      name: "send_to_channel",
      description:
        "Send a message to a specific channel. Supports GFM markdown for rich formatting. Use for channel-specific discussions rather than broadcast messages.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_name: {
            type: "string",
            description: "Channel name (e.g., 'general', 'auth-refactor')",
          },
          body: {
            type: "string",
            description: "Message content (GFM markdown supported, max 8192 chars)",
          },
          reply_to: {
            type: "string",
            description: "Message ID to reply to (creates a thread)",
          },
        },
        required: ["channel_name", "body"],
      },
    },
    {
      name: "set_summary",
      description:
        "Set a short summary of what you're currently working on, visible to peer agents.",
      inputSchema: {
        type: "object" as const,
        properties: {
          summary: {
            type: "string",
            description: "1-2 sentence summary of current work",
          },
        },
        required: ["summary"],
      },
    },
  ],
}));

// ── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (!SESSION_ID) {
    return textResult("Error: RDV_SESSION_ID not set. Tools require an active agent session.");
  }

  try {
    switch (name) {
      case "send_message": {
        const { body, to_session_id } = (args || {}) as {
          body: string;
          to_session_id?: string;
        };
        if (!body) {
          return textResult("Error: message body is required");
        }

        const resp = await callInternal("/internal/peers/messages/send", "POST", {
          fromSessionId: SESSION_ID,
          toSessionId: to_session_id,
          body,
        });
        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        const target = to_session_id ? `session ${to_session_id}` : "all peers";
        return textResult(`Message sent to ${target} (id: ${resp.data.messageId})`);
      }

      case "send_to_channel": {
        const { channel_name, body, reply_to } = (args || {}) as {
          channel_name: string;
          body: string;
          reply_to?: string;
        };
        if (!channel_name || !body) {
          return textResult("Error: channel_name and body are required");
        }

        const payload: Record<string, unknown> = {
          fromSessionId: SESSION_ID,
          channelName: channel_name,
          body,
        };
        if (reply_to) payload.parentMessageId = reply_to;

        const resp = await callInternal("/internal/channels/send", "POST", payload);
        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        return textResult(`Message sent to #${channel_name} (id: ${resp.data.messageId})`);
      }

      case "set_summary": {
        const { summary } = (args || {}) as { summary: string };
        if (!summary) {
          return textResult("Error: summary is required");
        }

        const resp = await callInternal("/internal/peers/summary", "POST", {
          sessionId: SESSION_ID,
          summary,
        });
        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        return textResult("Summary updated.");
      }

      default:
        return textResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Error calling ${name}: ${message}`);
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  startSocketListener();
}).catch((err) => {
  process.stderr.write(`rdv: failed to start: ${err}\n`);
  process.exit(1);
});
