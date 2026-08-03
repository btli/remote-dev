export const CLIPBOARD_MAX_BYTES = 1024 * 1024;
export const CLIPBOARD_SESSION_ID_MAX_BYTES = 128;
export const CLIPBOARD_TTL_MS = 10 * 60 * 1000;

export type ClipboardValidationCode =
  | "invalid_session"
  | "invalid_text"
  | "too_large";

export class ClipboardValidationError extends Error {
  constructor(
    readonly code: ClipboardValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ClipboardValidationError";
  }
}

export interface ClipboardSnapshot {
  data: string;
  revision: number;
}

interface ClipboardEntry extends ClipboardSnapshot {
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface ClipboardBrokerOptions {
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validateClipboardSessionId(
  sessionId: unknown,
): asserts sessionId is string {
  if (
    typeof sessionId !== "string" ||
    sessionId.trim().length === 0 ||
    !isWellFormedUnicode(sessionId) ||
    Buffer.byteLength(sessionId, "utf8") > CLIPBOARD_SESSION_ID_MAX_BYTES
  ) {
    throw new ClipboardValidationError(
      "invalid_session",
      `sessionId must be a non-empty string of at most ${CLIPBOARD_SESSION_ID_MAX_BYTES} UTF-8 bytes`,
    );
  }
}

/**
 * Ephemeral, process-local clipboard state. The broker deliberately exposes no
 * serialization or persistence surface: text lives only in this map until its
 * TTL expires or the owning session is cleared.
 */
export class ClipboardBroker {
  private readonly entries = new Map<string, ClipboardEntry>();
  private readonly revisions = new Map<string, number>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxBytes: number;

  constructor(options: ClipboardBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CLIPBOARD_TTL_MS;
    this.maxBytes = options.maxBytes ?? CLIPBOARD_MAX_BYTES;
  }

  write(sessionId: string, data: string): { revision: number } {
    validateClipboardSessionId(sessionId);
    this.validateText(data);

    const revision = (this.revisions.get(sessionId) ?? 0) + 1;
    this.revisions.set(sessionId, revision);
    this.deleteEntry(sessionId);
    const entry: ClipboardEntry = {
      data,
      revision,
      expiresAt: this.now() + this.ttlMs,
    };
    entry.expiryTimer = setTimeout(() => {
      if (this.entries.get(sessionId) === entry) {
        this.entries.delete(sessionId);
      }
    }, this.ttlMs);
    entry.expiryTimer.unref?.();
    this.entries.set(sessionId, entry);
    return { revision };
  }

  read(sessionId: string): ClipboardSnapshot | null {
    validateClipboardSessionId(sessionId);
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.deleteEntry(sessionId);
      return null;
    }
    return { data: entry.data, revision: entry.revision };
  }

  clearSession(sessionId: string): void {
    this.deleteEntry(sessionId);
    this.revisions.delete(sessionId);
  }

  clear(): void {
    for (const sessionId of this.entries.keys()) {
      this.deleteEntry(sessionId);
    }
    this.revisions.clear();
  }

  private deleteEntry(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.expiryTimer) clearTimeout(entry.expiryTimer);
    this.entries.delete(sessionId);
  }

  private validateText(data: string): void {
    if (typeof data !== "string" || !isWellFormedUnicode(data)) {
      throw new ClipboardValidationError(
        "invalid_text",
        "clipboard data must be valid Unicode text",
      );
    }
    if (Buffer.byteLength(data, "utf8") > this.maxBytes) {
      throw new ClipboardValidationError(
        "too_large",
        `clipboard data exceeds ${this.maxBytes} UTF-8 bytes`,
      );
    }
  }
}
