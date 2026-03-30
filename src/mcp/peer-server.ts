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

const SESSION_ID = process.env.RDV_SESSION_ID;
if (!SESSION_ID) {
  process.stderr.write("rdv-peers: RDV_SESSION_ID not set, exiting\n");
  process.exit(1);
}

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
      "You have peer communication tools to discover and message other AI agents working in the same project.",
      "Use list_peers to see who else is working in this project folder.",
      "Use send_message to coordinate with a specific peer or broadcast to all peers.",
      "Use check_messages to read messages from other agents.",
      "Use set_summary to describe what you're currently working on so peers can find you.",
      "When you receive messages from peers, respond helpfully — treat them like a colleague asking for help.",
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
  ],
}));

// ── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

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
        lastPollTimestamp = new Date().toISOString();

        if (resp.status !== 200) {
          return textResult(`Error: ${JSON.stringify(resp.data)}`);
        }

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
await server.connect(transport);
