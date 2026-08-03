import {
  CLIPBOARD_MAX_BYTES,
  ClipboardValidationError,
  type ClipboardSnapshot,
  validateClipboardSessionId,
} from "./clipboard-broker";

/**
 * JSON can expand each one-byte control character to a six-byte `\\u00xx`
 * escape. Six MiB plus a small envelope allowance therefore accepts every
 * valid one-MiB clipboard string while bounding pre-parse request memory.
 */
export const CLIPBOARD_HTTP_MAX_BODY_BYTES = CLIPBOARD_MAX_BYTES * 6 + 1024;

export interface ClipboardHttpOperation {
  method?: string;
  querySessionId?: unknown;
  body?: unknown;
}

interface ClipboardHttpBackend {
  read(sessionId: string): ClipboardSnapshot | null;
  write(
    sessionId: string,
    data: string,
  ): { revision: number; delivered: boolean };
}

export interface ClipboardHttpResult {
  status: number;
  contentType: "application/json" | "text/plain; charset=utf-8";
  body: Record<string, unknown> | string;
}

export interface ClipboardHttpStreamRequest {
  method?: string;
  querySessionId?: unknown;
  bodyStream?: AsyncIterable<unknown>;
}

function errorResult(status: number, error: string): ClipboardHttpResult {
  return {
    status,
    contentType: "application/json",
    body: { error },
  };
}

function validationError(error: ClipboardValidationError): ClipboardHttpResult {
  return errorResult(
    error.code === "too_large" ? 413 : 400,
    error.message,
  );
}

async function readClipboardJsonBody(
  bodyStream: AsyncIterable<unknown>,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string }
> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;

  try {
    for await (const value of bodyStream) {
      if (tooLarge) continue;
      // IncomingMessage yields raw Buffer chunks. Reject pre-decoded strings:
      // their original byte validity and chunk boundaries are already lost.
      const chunk =
        value instanceof Uint8Array
          ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          : null;
      if (!chunk) {
        return { ok: false, status: 400, error: "Invalid request body" };
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > CLIPBOARD_HTTP_MAX_BODY_BYTES) {
        // Keep draining the request so the connection remains usable, but drop
        // every retained byte immediately and never accumulate further chunks.
        chunks.length = 0;
        tooLarge = true;
        continue;
      }
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, status: 400, error: "Invalid request body" };
  }

  if (tooLarge) {
    return {
      ok: false,
      status: 413,
      error: `Clipboard request body exceeds ${CLIPBOARD_HTTP_MAX_BODY_BYTES} bytes`,
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
}

/** Resolve the streaming HTTP endpoint without decoding partial UTF-8 chunks. */
export async function resolveClipboardHttpStreamRequest(
  request: ClipboardHttpStreamRequest,
  backend: ClipboardHttpBackend,
): Promise<ClipboardHttpResult> {
  if (request.method !== "POST") {
    return resolveClipboardHttpOperation(
      {
        method: request.method,
        querySessionId: request.querySessionId,
      },
      backend,
    );
  }
  if (!request.bodyStream) {
    return errorResult(400, "Missing request body");
  }

  const parsed = await readClipboardJsonBody(request.bodyStream);
  if (!parsed.ok) return errorResult(parsed.status, parsed.error);
  return resolveClipboardHttpOperation(
    { method: request.method, body: parsed.body },
    backend,
  );
}

/** Pure routing/validation for GET and POST /internal/clipboard. */
export function resolveClipboardHttpOperation(
  request: ClipboardHttpOperation,
  backend: ClipboardHttpBackend,
): ClipboardHttpResult {
  if (request.method === "GET") {
    try {
      validateClipboardSessionId(request.querySessionId);
      const snapshot = backend.read(request.querySessionId);
      return {
        status: snapshot ? 200 : 204,
        contentType: "text/plain; charset=utf-8",
        body: snapshot?.data ?? "",
      };
    } catch (error) {
      if (error instanceof ClipboardValidationError) return validationError(error);
      throw error;
    }
  }

  if (request.method === "POST") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      return errorResult(400, "request body must be a JSON object");
    }
    const { sessionId, data } = request.body as Record<string, unknown>;
    if (typeof data !== "string") {
      return errorResult(400, "data must be a string");
    }
    try {
      validateClipboardSessionId(sessionId);
      return {
        status: 200,
        contentType: "application/json",
        body: backend.write(sessionId, data),
      };
    } catch (error) {
      if (error instanceof ClipboardValidationError) return validationError(error);
      throw error;
    }
  }

  return errorResult(405, "Method not allowed");
}
