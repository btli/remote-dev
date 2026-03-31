/**
 * Resolve the terminal server base URL for internal HTTP calls.
 *
 * Discovery order: RDV_TERMINAL_SOCKET > RDV_TERMINAL_PORT > TERMINAL_PORT > 6002.
 * Used by API routes and services that need to call the terminal server.
 */
export function resolveTerminalServerUrl(): string {
  const socketPath = process.env.RDV_TERMINAL_SOCKET;
  if (socketPath) {
    return `http://unix:${socketPath}:`;
  }
  const port = process.env.RDV_TERMINAL_PORT ?? process.env.TERMINAL_PORT ?? "6002";
  return `http://127.0.0.1:${port}`;
}
