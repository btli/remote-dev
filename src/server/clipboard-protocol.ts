import { ClipboardBroker } from "./clipboard-broker";

export const CLIPBOARD_UPDATE_ID_MAX_BYTES = 128;

export interface ClipboardConnectionState {
  connectionId: string;
  sessionId: string;
  clipboardSubscribed: boolean;
  isVisible: boolean;
  isSocketOpen: boolean;
}

export interface ClientClipboardWrite {
  data: unknown;
  updateId: unknown;
}

export type ClientClipboardWriteResult =
  | { accepted: true; revision: number }
  | {
      accepted: false;
      reason:
        | "invalid_message"
        | "not_subscribed"
        | "not_visible"
        | "not_primary"
        | "socket_closed";
    };

export interface ClipboardUpdateMessage {
  type: "clipboard_update";
  data: string;
  revision: number;
}

export interface ClipboardDeliveryTarget {
  connection: ClipboardConnectionState;
  send(message: ClipboardUpdateMessage): void;
}

/** Store a browser-originated clipboard write without echoing it to clients. */
export function handleClientClipboardWrite(
  broker: ClipboardBroker,
  connection: ClipboardConnectionState,
  primaryConnectionId: string | undefined,
  message: ClientClipboardWrite,
): ClientClipboardWriteResult {
  if (
    typeof message.data !== "string" ||
    typeof message.updateId !== "string" ||
    !message.updateId ||
    Buffer.byteLength(message.updateId, "utf8") > CLIPBOARD_UPDATE_ID_MAX_BYTES
  ) {
    return { accepted: false, reason: "invalid_message" };
  }
  if (!connection.clipboardSubscribed) {
    return { accepted: false, reason: "not_subscribed" };
  }
  if (!connection.isVisible) {
    return { accepted: false, reason: "not_visible" };
  }
  if (connection.connectionId !== primaryConnectionId) {
    return { accepted: false, reason: "not_primary" };
  }
  if (!connection.isSocketOpen) {
    return { accepted: false, reason: "socket_closed" };
  }

  const { revision } = broker.write(connection.sessionId, message.data);
  return { accepted: true, revision };
}

/**
 * Store a host/CLI-originated write, then make one best-effort delivery to the
 * current primary. Clipboard data is never included in an error or log path.
 */
export function attemptRemoteClipboardWrite(
  broker: ClipboardBroker,
  sessionId: string,
  data: string,
  target?: ClipboardDeliveryTarget,
): { revision: number; delivered: boolean } {
  const { revision } = broker.write(sessionId, data);
  const connection = target?.connection;
  if (
    !target ||
    !connection ||
    connection.sessionId !== sessionId ||
    !connection.clipboardSubscribed ||
    !connection.isVisible ||
    !connection.isSocketOpen
  ) {
    return { revision, delivered: false };
  }

  try {
    target.send({ type: "clipboard_update", data, revision });
    return { revision, delivered: true };
  } catch {
    return { revision, delivered: false };
  }
}
