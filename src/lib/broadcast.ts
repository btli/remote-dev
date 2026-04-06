/**
 * Fire-and-forget broadcast utility.
 *
 * Sends a POST to the terminal server's internal API to broadcast
 * a WebSocket message to all connected clients.  Errors are silently
 * swallowed — the caller already responded to the HTTP request and
 * the broadcast is best-effort.
 */
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("Broadcast");

/**
 * Notify all connected WebSocket clients that the sidebar data
 * (sessions and/or folders) has changed and should be refetched.
 *
 * This is fire-and-forget: the promise resolves immediately and
 * errors are logged but never thrown.
 */
export function broadcastSidebarChanged(): void {
  const baseUrl = resolveTerminalServerUrl();
  fetch(`${baseUrl}/internal/sidebar-changed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch((err) => {
    log.debug("Sidebar broadcast failed (terminal server may be down)", {
      error: String(err),
    });
  });
}
