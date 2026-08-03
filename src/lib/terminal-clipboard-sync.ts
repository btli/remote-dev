import type { ServerMessage } from "@/types/terminal";

export const MAX_CLIPBOARD_TEXT_BYTES = 1024 * 1024;
/** Coalesces the burst of copy/clipboardchange/focus events for one write. */
export const LOCAL_CLIPBOARD_DEDUPE_MS = 1_000;

export interface ClipboardSyncSocket {
  readonly readyState: number;
  send(data: string): void;
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export interface ClipboardReader {
  readText(): Promise<string>;
}

interface BrowserClipboardWriteOptions {
  clipboard?: ClipboardWriter | null;
  onBlocked: (text: string, retry: () => Promise<void>) => void;
}

interface TerminalClipboardSyncOptions {
  applyRemote: (text: string, revision: number) => void | Promise<void>;
  createUpdateId?: () => string;
  now?: () => number;
  onEligibilityInvalidated?: () => void;
}

interface PresentedState {
  active: boolean;
  visible: boolean;
  pageVisible: boolean;
  focused: boolean;
}

function defaultUpdateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isClipboardTextWithinLimit(text: string): boolean {
  return new TextEncoder().encode(text).byteLength <= MAX_CLIPBOARD_TEXT_BYTES;
}

/**
 * Legacy, gesture-bound copy path for browsers without Clipboard API access.
 * The selected textarea exists only for the synchronous execCommand call and
 * is removed even when the browser rejects the copy.
 */
export function copyTextWithSelectionFallback(
  text: string,
  ownerDocument: Document | null =
    typeof document === "undefined" ? null : document,
): boolean {
  if (!ownerDocument?.body) return false;
  const textarea = ownerDocument.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.setAttribute("data-rdv-clipboard-fallback", "");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "0 auto auto -9999px",
    opacity: "0",
    pointerEvents: "none",
  });
  ownerDocument.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return ownerDocument.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Attempt a remote-to-browser write. A denied automatic write is converted
 * into a retry callback that UI can place behind a user gesture.
 */
export async function writeBrowserClipboard(
  text: string,
  { clipboard, onBlocked }: BrowserClipboardWriteOptions,
): Promise<void> {
  const retry = async () => {
    if (clipboard) {
      try {
        await clipboard.writeText(text);
        return;
      } catch {
        // A user-gesture selection fallback can still work when permissions
        // permanently deny navigator.clipboard.
      }
    }
    if (!copyTextWithSelectionFallback(text)) {
      throw new Error("Clipboard copy unavailable");
    }
  };

  try {
    if (!clipboard) throw new Error("Clipboard API unavailable");
    await clipboard.writeText(text);
  } catch {
    onBlocked(text, retry);
  }
}

/** Best-effort local clipboard read; permission denials are intentionally silent. */
export async function readBrowserClipboard(
  clipboard: ClipboardReader | null | undefined,
  onText: (text: string) => void,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    onText(await clipboard.readText());
    return true;
  } catch {
    return false;
  }
}

/**
 * Per-terminal clipboard protocol state. The class deliberately knows
 * nothing about React, navigator.clipboard, or Flutter; those are adapters.
 */
export class TerminalClipboardSync {
  private socket: ClipboardSyncSocket | null = null;
  private enabled = false;
  private presented: PresentedState = {
    active: false,
    visible: false,
    pageVisible: false,
    focused: false,
  };
  private primary = false;
  private eligibilityGeneration = 0;
  private lastSubscription: boolean | null = null;
  private lastRemoteText: string | null = null;
  private lastRemoteRevision = -1;
  private lastRemoteAppliedAt = Number.NEGATIVE_INFINITY;
  private lastLocalText: string | null = null;
  private lastLocalUpdateId: string | null = null;
  private lastLocalWrittenAt = Number.NEGATIVE_INFINITY;
  private pendingLocalText: string | null = null;
  private readonly generatedUpdateIds = new Set<string>();
  private readonly generatedUpdateIdOrder: string[] = [];
  private readonly applyRemote: TerminalClipboardSyncOptions["applyRemote"];
  private readonly createUpdateId: () => string;
  private readonly now: () => number;
  private readonly onEligibilityInvalidated: () => void;

  constructor({
    applyRemote,
    createUpdateId = defaultUpdateId,
    now = Date.now,
    onEligibilityInvalidated = () => {},
  }: TerminalClipboardSyncOptions) {
    this.applyRemote = applyRemote;
    this.createUpdateId = createUpdateId;
    this.now = now;
    this.onEligibilityInvalidated = onEligibilityInvalidated;
  }

  private get isPresented(): boolean {
    return (
      this.enabled &&
      this.presented.active &&
      this.presented.visible &&
      this.presented.pageVisible &&
      this.presented.focused
    );
  }

  private get shouldSubscribe(): boolean {
    return this.isPresented && this.primary;
  }

  canSync(): boolean {
    return this.shouldSubscribe && this.hasOpenSocket;
  }

  canReadLocalClipboard(): boolean {
    return this.shouldSubscribe;
  }

  private get hasOpenSocket(): boolean {
    return this.socket?.readyState === 1;
  }

  private clearClipboardContents(): void {
    this.lastRemoteText = null;
    this.lastRemoteAppliedAt = Number.NEGATIVE_INFINITY;
    this.lastLocalText = null;
    this.lastLocalUpdateId = null;
    this.lastLocalWrittenAt = Number.NEGATIVE_INFINITY;
    this.pendingLocalText = null;
  }

  private invalidateEligibility(): void {
    this.eligibilityGeneration += 1;
    this.onEligibilityInvalidated();
  }

  createEligibilityToken(): number | null {
    return this.canSync() ? this.eligibilityGeneration : null;
  }

  isEligibilityTokenCurrent(token: number | null): boolean {
    return (
      token !== null &&
      token === this.eligibilityGeneration &&
      this.canSync()
    );
  }

  private sendSubscription(): void {
    const enabled = this.shouldSubscribe;
    if (!this.hasOpenSocket) return;
    // Do not disclose clipboard capability at all before the server has
    // authoritatively promoted this socket. A false frame is needed only to
    // revoke an established subscription.
    if (!enabled && this.lastSubscription !== true) return;
    if (this.lastSubscription === enabled) return;
    try {
      this.socket?.send(
        JSON.stringify({ type: "clipboard_subscribe", enabled }),
      );
      this.lastSubscription = enabled;
    } catch {
      // A reconnect will re-send the current state.
    }
  }

  openSocket(socket: ClipboardSyncSocket): void {
    this.invalidateEligibility();
    this.socket = socket;
    this.primary = false;
    this.lastSubscription = null;
    // Revision is scoped to the terminal-server broker process. A reconnect
    // may land after that process restarted and began again at revision 1.
    this.lastRemoteRevision = -1;
    this.lastRemoteText = null;
    this.lastRemoteAppliedAt = Number.NEGATIVE_INFINITY;
  }

  closeSocket(socket?: ClipboardSyncSocket): void {
    if (socket && socket !== this.socket) return;
    // A replacement broker has no clipboard history. Preserve the latest
    // eligible value in memory so it can be seeded immediately after the new
    // subscription is established, even if the OS emits no clipboard event.
    if (this.shouldSubscribe && this.pendingLocalText === null) {
      this.pendingLocalText = this.lastLocalText ?? this.lastRemoteText;
    }
    this.socket = null;
    this.primary = false;
    this.lastSubscription = null;
    this.invalidateEligibility();
  }

  setPrimary(primary: boolean, socket: ClipboardSyncSocket): void {
    if (socket !== this.socket || this.primary === primary) return;
    this.primary = primary;
    if (!primary) {
      const pending = this.pendingLocalText;
      this.lastRemoteText = null;
      this.lastRemoteAppliedAt = Number.NEGATIVE_INFINITY;
      this.lastLocalText = null;
      this.lastLocalUpdateId = null;
      this.lastLocalWrittenAt = Number.NEGATIVE_INFINITY;
      this.pendingLocalText = pending;
      this.invalidateEligibility();
    }
    this.sendSubscription();
    if (primary) this.flushPendingLocalText();
  }

  private flushPendingLocalText(): void {
    if (
      !this.shouldSubscribe ||
      this.lastSubscription !== true ||
      this.pendingLocalText === null
    ) {
      return;
    }
    const pending = this.pendingLocalText;
    this.pendingLocalText = null;
    if (!this.sendLocalText(pending)) {
      this.pendingLocalText = pending;
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    const wasPresented = this.isPresented;
    this.enabled = enabled;
    if (!this.isPresented) this.clearClipboardContents();
    if (wasPresented && !this.isPresented) this.invalidateEligibility();
    this.sendSubscription();
    if (this.shouldSubscribe) this.flushPendingLocalText();
  }

  setPresented(next: Partial<PresentedState>): void {
    const wasPresented = this.isPresented;
    this.presented = { ...this.presented, ...next };
    if (!this.isPresented) this.clearClipboardContents();
    if (wasPresented && !this.isPresented) this.invalidateEligibility();
    this.sendSubscription();
    if (this.shouldSubscribe) this.flushPendingLocalText();
  }

  resetSession(): void {
    this.socket = null;
    this.primary = false;
    this.lastSubscription = null;
    this.lastRemoteRevision = -1;
    this.clearClipboardContents();
    this.generatedUpdateIds.clear();
    this.generatedUpdateIdOrder.length = 0;
    this.invalidateEligibility();
  }

  writeLocalText(text: string): boolean {
    if (!this.isPresented) return false;
    if (!isClipboardTextWithinLimit(text)) return false;
    const now = this.now();
    if (
      text === this.lastRemoteText &&
      now - this.lastRemoteAppliedAt <= LOCAL_CLIPBOARD_DEDUPE_MS
    ) {
      return false;
    }
    if (
      !this.shouldSubscribe ||
      !this.hasOpenSocket ||
      this.lastSubscription !== true
    ) {
      if (text === this.pendingLocalText) return false;
      this.pendingLocalText = text;
      return true;
    }
    if (
      text === this.lastLocalText &&
      now - this.lastLocalWrittenAt <= LOCAL_CLIPBOARD_DEDUPE_MS
    ) {
      return false;
    }
    if (this.sendLocalText(text, now)) return true;
    // Treat a send failure as a transient disconnect and preserve only the
    // latest eligible text for the next socket generation.
    this.pendingLocalText = text;
    return true;
  }

  private sendLocalText(text: string, now = this.now()): boolean {
    if (
      !this.hasOpenSocket ||
      !this.shouldSubscribe ||
      this.lastSubscription !== true
    ) {
      return false;
    }
    const updateId = this.createUpdateId();
    try {
      this.socket?.send(
        JSON.stringify({ type: "clipboard_write", data: text, updateId }),
      );
    } catch {
      return false;
    }

    this.pendingLocalText = null;
    this.lastRemoteText = null;
    this.lastRemoteAppliedAt = Number.NEGATIVE_INFINITY;
    this.lastLocalText = text;
    this.lastLocalUpdateId = updateId;
    this.lastLocalWrittenAt = now;
    this.generatedUpdateIds.add(updateId);
    this.generatedUpdateIdOrder.push(updateId);
    // Bound loop-suppression metadata; clipboard contents themselves only
    // retain the latest local/remote values.
    while (this.generatedUpdateIdOrder.length > 64) {
      const oldest = this.generatedUpdateIdOrder.shift();
      if (oldest && oldest !== this.lastLocalUpdateId) {
        this.generatedUpdateIds.delete(oldest);
      }
    }
    return true;
  }

  async receive(
    message: ServerMessage,
    source: ClipboardSyncSocket,
  ): Promise<boolean> {
    if (
      source !== this.socket ||
      message.type !== "clipboard_update" ||
      !this.shouldSubscribe
    ) {
      return false;
    }
    if (
      !Number.isSafeInteger(message.revision) ||
      message.revision < 0 ||
      message.revision <= this.lastRemoteRevision ||
      !isClipboardTextWithinLimit(message.data)
    ) {
      return false;
    }

    this.lastRemoteRevision = message.revision;
    const now = this.now();
    if (
      message.data === this.lastLocalText &&
      now - this.lastLocalWrittenAt <= LOCAL_CLIPBOARD_DEDUPE_MS
    ) {
      return false;
    }

    this.lastLocalText = null;
    this.lastLocalUpdateId = null;
    this.lastLocalWrittenAt = Number.NEGATIVE_INFINITY;
    this.lastRemoteText = message.data;
    this.lastRemoteAppliedAt = now;
    await this.applyRemote(message.data, message.revision);
    return true;
  }
}
