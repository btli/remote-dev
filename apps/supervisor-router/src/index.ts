/**
 * Supervisor router — entrypoint (spec §5).
 *
 * A stateless Bun HTTP/WebSocket reverse proxy: the SINGLE front door behind the
 * Cloudflare tunnel for the instance host (e.g. `dev.example.com`). It routes
 * `/<slug>/*` to the matching instance Service with NO prefix stripping (the
 * instance image is slug-aware and genuinely serves under `/<slug>`), proxies
 * the `/<slug>/ws` terminal WebSocket, and proxies everything else — root `/`,
 * `/login`, `/api/*`, assets — to the **Supervisor dashboard** on the same host
 * (Option C: one external hostname, one Cloudflare Access app). Routes are
 * decided from a last-known-good allowlist polled from the Supervisor's
 * `/api/internal/routes` (fails open from cache when the Supervisor is
 * unreachable — see §15 M4).
 *
 * Run with `bun run src/index.ts` (or `bun run --watch` in dev). Bun loads `.env`
 * automatically.
 */

import type { Server, ServerWebSocket } from "bun";
import { createLogger } from "@/lib/logger";
import { AllowlistCache } from "@/lib/allowlist";
import { decideRoute } from "@/lib/router-core";
import {
  buildWsUpgradeHeaders,
  closeWsBridge,
  forwardWsMessage,
  openWsBridge,
  proxyHttp,
  type WsProxyData,
} from "@/lib/proxy";

const log = createLogger("Router");

interface RouterConfig {
  port: number;
  supervisorUrl: string;
  internalSecret: string;
  pollIntervalMs: number;
}

function loadConfig(): RouterConfig {
  const port = Number(process.env.ROUTER_PORT ?? "6004");
  const supervisorUrl =
    process.env.ROUTER_SUPERVISOR_URL ??
    "http://supervisor.rdv-system.svc.cluster.local:6003";
  const internalSecret = process.env.SUPERVISOR_INTERNAL_SECRET ?? "";
  const pollIntervalMs = Number(process.env.ROUTER_ALLOWLIST_POLL_MS ?? "10000");

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid ROUTER_PORT: ${process.env.ROUTER_PORT}`);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(
      `Invalid ROUTER_ALLOWLIST_POLL_MS: ${process.env.ROUTER_ALLOWLIST_POLL_MS}`,
    );
  }
  return { port, supervisorUrl, internalSecret, pollIntervalMs };
}

/** `/api/internal/*` is blocked at the front door — answered 404 locally, never proxied. */
function blockedResponse(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function healthResponse(): Response {
  return Response.json({ status: "ok" });
}

function isWebSocketUpgrade(req: Request): boolean {
  // A WebSocket upgrade sets `Upgrade: websocket` (case-insensitive) and a
  // `Connection` header that includes `Upgrade`.
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function main(): void {
  const config = loadConfig();

  // The Supervisor is the DEFAULT proxy upstream (Option C): non-instance
  // traffic is fronted to its dashboard on the same host. Derive its HTTP base
  // (no trailing slash) + matching WS base (http→ws, https→wss) once at boot.
  const supervisorHttpBase = config.supervisorUrl.replace(/\/$/, "");
  const supervisorWsBase = supervisorHttpBase.replace(/^http/, "ws");

  const allowlist = new AllowlistCache({
    supervisorUrl: config.supervisorUrl,
    internalSecret: config.internalSecret,
    pollIntervalMs: config.pollIntervalMs,
  });
  allowlist.start();

  const server: Server<WsProxyData> = Bun.serve<WsProxyData>({
    port: config.port,
    idleTimeout: 0, // never time out idle connections at the router (WS terminals are long-lived)

    async fetch(req, server): Promise<Response | undefined> {
      const url = new URL(req.url);
      const upgrade = isWebSocketUpgrade(req);
      const decision = decideRoute(url.pathname, upgrade, allowlist, {
        httpBase: supervisorHttpBase,
        wsBase: supervisorWsBase,
      });

      switch (decision.kind) {
        case "health":
          return healthResponse();
        case "blocked":
          return blockedResponse();
        case "proxy-ws": {
          const upstreamWsUrl = `${decision.upstreamWsBase}${decision.path}${url.search}`;
          const upgraded = server.upgrade(req, {
            data: {
              upstreamWsUrl,
              headers: buildWsUpgradeHeaders(req),
              slug: decision.slug,
            },
          });
          if (upgraded) {
            // Bun has taken over the socket; do not return a Response.
            return undefined;
          }
          // Upgrade negotiation failed (e.g. not actually a valid upgrade).
          return new Response("Expected a WebSocket upgrade.\n", {
            status: 426,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        case "proxy-http":
          return proxyHttp(
            req,
            decision.upstreamBase,
            decision.path,
            undefined,
            server,
          );
      }
    },

    websocket: {
      // Long-lived terminal sessions: disable the per-socket idle timeout
      // (Cloudflare/the instance manage liveness; the router just pipes bytes).
      idleTimeout: 0,
      open(ws: ServerWebSocket<WsProxyData>) {
        openWsBridge(ws);
      },
      message(ws: ServerWebSocket<WsProxyData>, message) {
        forwardWsMessage(ws, message);
      },
      close(ws: ServerWebSocket<WsProxyData>, code, reason) {
        closeWsBridge(ws, code, reason);
      },
    },
  });

  log.info("Supervisor router listening", {
    port: config.port,
    supervisorUrl: config.supervisorUrl,
    pollIntervalMs: config.pollIntervalMs,
    authenticatedAllowlist: config.internalSecret.length > 0,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Supervisor router shutting down", { signal });
    allowlist.stop();
    // `closeActiveConnections: false` lets in-flight requests drain; new
    // connections are refused once stop() is called.
    void server.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
