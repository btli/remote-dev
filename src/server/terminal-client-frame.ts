export interface TerminalClientProtocolMessage {
  type?: string;
  data?: unknown;
  updateId?: unknown;
  enabled?: unknown;
  cols?: unknown;
  rows?: unknown;
  force?: boolean;
  reassert?: boolean;
  [key: string]: unknown;
}

export interface TerminalClientFrameHandlers {
  onProtocolMessage(message: TerminalClientProtocolMessage): void | Promise<void>;
  onLegacyInput(data: string): void | Promise<void>;
}

function looksLikeControlFrame(raw: string): boolean {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{")) return false;
  return (
    /(?:^|[,{]\s*)"(?:type|updateId)"(?:\s*:|\s*$)/u.test(trimmed) ||
    /"clipboard_(?:subscribe|write)/u.test(trimmed)
  );
}

/**
 * Route valid JSON protocol objects separately from legacy raw terminal input.
 * Malformed control-looking objects and protocol handler failures fail closed;
 * neither path can be reinterpreted as keystrokes or reach terminal recording.
 */
export function routeTerminalClientFrame(
  raw: string,
  handlers: TerminalClientFrameHandlers,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return !looksLikeControlFrame(raw)
      ? Promise.resolve(handlers.onLegacyInput(raw))
      : Promise.resolve();
  }

  // Preserve the legacy handler's historical `null` behavior: accessing
  // `type` on parsed null used to fall through to raw PTY input.
  if (parsed === null) {
    return Promise.resolve(handlers.onLegacyInput(raw));
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) return Promise.resolve();
  try {
    return Promise.resolve(
      handlers.onProtocolMessage(parsed as TerminalClientProtocolMessage),
    ).catch(() => {
      // Async protocol errors are rejected, never reclassified as raw input.
    });
  } catch {
    // A synchronous handler failure is also a consumed control frame.
    return Promise.resolve();
  }
}
