#!/usr/bin/env node
/**
 * RDV Peers MCP Server
 *
 * A stdio MCP server that provides peer communication tools for Claude Code agents.
 * Auto-registered in each agent's settings.json at session creation.
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

const SESSION_ID = process.env.RDV_SESSION_ID ?? "";

// Track last poll time so we only get new messages
let lastPollTimestamp = new Date().toISOString();

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

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "rdv-peers", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: [
      "You have peer communication and channel tools for coordinating with other AI agents in this project.",
      "Use list_channels to see available channels in the project folder.",
      "Use create_channel to create topic-specific channels for coordinating work.",
      "Use send_to_channel to send messages to a specific channel (GFM markdown supported).",
      "Use read_channel to read recent messages from a channel.",
      "Use list_peers, send_message, check_messages, and set_summary for direct peer communication.",
      "When you start a significant piece of work, consider creating a channel for it.",
      "Treat messages from peers as colleague requests — respond helpfully.",
    ].join(" "),
  }
);

// ── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_peers",
      description:
        "List other AI agent sessions working in the same project folder. Returns their name, status, provider, and work summary.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "send_message",
      description:
        "Send a message to another agent in the same project folder. Omit to_session_id to broadcast to all peers.",
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
              "Target session ID from list_peers. Omit to broadcast to all peers.",
          },
        },
        required: ["body"],
      },
    },
    {
      name: "check_messages",
      description:
        "Check for new messages from other agents. Returns messages received since last check.",
      inputSchema: {
        type: "object" as const,
        properties: {},
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
    {
      name: "list_channels",
      description:
        "List available channels in the current project folder. Shows channel groups, names, and message counts.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "create_channel",
      description:
        "Create a new channel in the current project folder. Use when starting a significant piece of work that warrants its own discussion space.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description:
              "Channel name (lowercase, alphanumeric and hyphens, 1-50 chars)",
          },
          topic: {
            type: "string",
            description: "Optional topic/description for the channel",
          },
        },
        required: ["name"],
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
      name: "read_channel",
      description:
        "Read recent messages from a specific channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_name: {
            type: "string",
            description: "Channel name to read from (e.g., 'general')",
          },
          limit: {
            type: "number",
            description: "Number of messages to return (default: 20, max: 50)",
          },
        },
        required: ["channel_name"],
      },
    },
  ],
}));

// ── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (!SESSION_ID) {
    return textResult("Error: RDV_SESSION_ID not set. Peer tools require an active agent session.");
  }

  try {
    switch (name) {
      case "list_peers": {
        const resp = await callInternal(
          `/internal/peers/list?sessionId=${SESSION_ID}`,
          "GET"
        );
        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        const peers = (resp.data.peers as Array<Record<string, unknown>>) || [];
        if (peers.length === 0) {
          return textResult("No other agents are currently active in this project folder.");
        }

        const peerList = peers
          .map((p) => {
            const parts = [
              `- **${p.name}** (${p.sessionId})`,
              `  Provider: ${p.agentProvider || "unknown"}`,
              `  Status: ${p.agentActivityStatus || "unknown"}${p.isConnected ? " (connected)" : " (disconnected)"}`,
            ];
            if (p.claudeSessionId) {
              parts.push(`  Claude Session: ${p.claudeSessionId}`);
            }
            if (p.peerSummary) {
              parts.push(`  Working on: ${p.peerSummary}`);
            }
            return parts.join("\n");
          })
          .join("\n\n");

        return textResult(`Found ${peers.length} peer(s):\n\n${peerList}`);
      }

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

      case "check_messages": {
        const resp = await callInternal(
          `/internal/peers/messages/poll?sessionId=${SESSION_ID}&since=${encodeURIComponent(lastPollTimestamp)}`,
          "GET"
        );

        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        // Only advance timestamp after a successful response to avoid losing messages
        lastPollTimestamp = new Date().toISOString();

        const messages =
          (resp.data.messages as Array<Record<string, unknown>>) || [];
        if (messages.length === 0) {
          return textResult("No new messages.");
        }

        const msgList = messages
          .map((m) => {
            const from = m.fromSessionName || m.fromSessionId || "unknown";
            const target = m.toSessionId ? "(direct)" : "(broadcast)";
            return `**From ${from}** ${target}:\n${m.body}`;
          })
          .join("\n\n---\n\n");

        return textResult(`${messages.length} new message(s):\n\n${msgList}`);
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

      case "list_channels": {
        const resp = await callInternal(
          `/internal/channels/list?sessionId=${SESSION_ID}`,
          "GET"
        );
        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        const groups = (resp.data.groups as Array<Record<string, unknown>>) || [];
        if (groups.length === 0) {
          return textResult("No channels found. Channels will be created automatically when needed.");
        }

        const output = groups
          .map((g) => {
            const channels = (g.channels as Array<Record<string, unknown>>) || [];
            const chList = channels
              .map((c) => `  - ${c.displayName} (${c.messageCount} messages)${c.topic ? ` — ${c.topic}` : ""}`)
              .join("\n");
            return `**${g.name}**\n${chList}`;
          })
          .join("\n\n");

        return textResult(output);
      }

      case "create_channel": {
        const { name, topic } = (args || {}) as { name: string; topic?: string };
        if (!name) {
          return textResult("Error: channel name is required");
        }

        const payload: Record<string, unknown> = {
          fromSessionId: SESSION_ID,
          name,
        };
        if (topic) payload.topic = topic;

        const resp = await callInternal("/internal/channels/create", "POST", payload);
        if (resp.status !== 201) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

        return textResult(`Channel #${name} created successfully.`);
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

      case "read_channel": {
        const { channel_name, limit: rawLimit } = (args || {}) as {
          channel_name: string;
          limit?: number;
        };
        if (!channel_name) {
          return textResult("Error: channel_name is required");
        }

        // First list channels to resolve name to ID
        const listResp = await callInternal(
          `/internal/channels/list?sessionId=${SESSION_ID}`,
          "GET"
        );
        if (listResp.status !== 200) {
          return textResult(`Error listing channels: ${JSON.stringify(listResp.data)}`);
        }

        const allGroups = (listResp.data.groups as Array<Record<string, unknown>>) || [];
        let channelId: string | undefined;
        for (const g of allGroups) {
          const channels = (g.channels as Array<Record<string, unknown>>) || [];
          const found = channels.find((c) => c.name === channel_name);
          if (found) {
            channelId = found.id as string;
            break;
          }
        }

        if (!channelId) {
          return textResult(`Channel '${channel_name}' not found. Use list_channels to see available channels.`);
        }

        // Note: We can't directly call the Next.js API route from the MCP server.
        // For now, return channel info. Messages are visible in the chat UI.
        return textResult(`Channel #${channel_name} found (id: ${channelId}). Messages are available in the chat UI. Use send_to_channel to post messages.`);
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
server.connect(transport).catch((err) => {
  process.stderr.write(`rdv-peers: failed to start: ${err}\n`);
  process.exit(1);
});
