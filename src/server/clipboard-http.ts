import {
  ClipboardValidationError,
  type ClipboardSnapshot,
  validateClipboardSessionId,
} from "./clipboard-broker";

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
