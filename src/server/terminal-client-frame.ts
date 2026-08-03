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
  onProtocolMessage(message: TerminalClientProtocolMessage): void;
  onLegacyInput(data: string): void;
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
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    if (!looksLikeControlFrame(raw)) handlers.onLegacyInput(raw);
    return;
  }

  // Preserve the legacy handler's historical `null` behavior: accessing
  // `type` on parsed null used to fall through to raw PTY input.
  if (parsed === null) {
    handlers.onLegacyInput(raw);
    return;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) return;
  try {
    handlers.onProtocolMessage(parsed as TerminalClientProtocolMessage);
  } catch {
    // Protocol errors are rejected, never reclassified as raw terminal input.
  }
}
