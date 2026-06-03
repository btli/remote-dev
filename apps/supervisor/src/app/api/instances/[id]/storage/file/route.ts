/**
 * GET /api/instances/:id/storage/file?path=<p> (operator + owner) — stream a
 * SINGLE file from the instance's persistent data volume (PVC `data-rdv-0`),
 * READ-ONLY, via an ephemeral inspector Job (src/lib/inspector-service.ts).
 *
 * Returns the file bytes as an attachment (Content-Disposition). Errors:
 *   - 400 INVALID_PATH       — traversal / missing ?path.
 *   - 413 FILE_TOO_LARGE     — over the inspector's 5 MiB cap (use a terminal).
 *   - 404 NOT_FOUND          — instance not visible, OR the file is missing.
 *   - 503 + note             — no cluster reachable (never 500).
 *
 * Single-writer note: same as the storage list route — the inspector Job is
 * ephemeral, read-only, namespaced, and self-deleting; it never touches instance
 * lifecycle state. Owner-scoped → 404 when not visible.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import {
  readFile,
  defaultClients,
  InspectorError,
  InspectorPathError,
  InspectorPendingError,
  InspectorTimeoutError,
  type FileContent,
} from "@/lib/inspector-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/storage/file");

/** The base name (last path segment) for the download filename. */
function baseName(p: string): string {
  const parts = p.split("/").filter((s) => s.length > 0);
  return parts[parts.length - 1] || "download";
}

/**
 * Sanitize a base name for safe use in the Content-Disposition header.
 * `safeRelativePath` only rejects `\0` and `..`, so a segment can still carry
 * CR/LF/`;`/`"`/`\` — which would split or corrupt the header (and on a strict
 * runtime throw, breaking this route's never-500 contract). We strip every
 * non-printable-ASCII char (incl. \x00-\x1F and \x7F) and the quoting-sensitive
 * `"`/`\`, then fall back to "download" if nothing usable remains. The returned
 * value is safe to embed in BOTH the `filename="…"` token and (URI-encoded) the
 * RFC 5987 `filename*` form.
 */
function safeDownloadName(p: string): string {
  const sanitized = baseName(p)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "");
  return sanitized.trim() || "download";
}

export const GET = withSupervisorAuth("operator", async (request, { user, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing instance id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const row = await db.query.instance.findFirst({ where: eq(instance.id, id) });

  // 404 (not 403) when missing OR not visible to the caller.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const path = new URL(request.url).searchParams.get("path");
  if (!path || path.trim() === "") {
    return NextResponse.json(
      { error: "Missing ?path", code: "INVALID_PATH" },
      { status: 400 },
    );
  }

  // No cluster → 503 + note (the file endpoint cannot degrade to empty bytes).
  let clients;
  try {
    clients = defaultClients();
  } catch (err) {
    log.debug("k8s unavailable for storage file; 503", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json(
      { error: "Cluster unavailable", code: "K8S_UNAVAILABLE", note: "k8s unavailable" },
      { status: 503 },
    );
  }

  let file: FileContent;
  try {
    file = await readFile(row.slug, path, clients);
  } catch (err) {
    if (err instanceof InspectorPathError) {
      return NextResponse.json(
        { error: String(err.message), code: "INVALID_PATH" },
        { status: 400 },
      );
    }
    if (err instanceof InspectorPendingError || err instanceof InspectorTimeoutError) {
      return NextResponse.json(
        { error: String(err.message), code: "VOLUME_UNAVAILABLE", note: String(err.message) },
        { status: 503 },
      );
    }
    if (err instanceof InspectorError) {
      const msg = String(err.message);
      // The in-pod script reports "file too large (...)" + "not a regular file"
      // and missing-file errors via ok:false → InspectorError. Map them to the
      // appropriate HTTP status.
      if (msg.includes("too large")) {
        return NextResponse.json(
          { error: msg, code: "FILE_TOO_LARGE" },
          { status: 413 },
        );
      }
      if (msg.includes("not a regular file") || msg.toLowerCase().includes("no such file")) {
        return NextResponse.json({ error: msg, code: "NOT_FOUND" }, { status: 404 });
      }
      log.warn("readFile inspector error", { slug: row.slug, error: msg });
      return NextResponse.json({ error: msg, code: "INSPECTOR_ERROR" }, { status: 502 });
    }
    log.warn("readFile failed", { slug: row.slug, error: String(err) });
    return NextResponse.json(
      { error: "Could not read file", code: "INSPECTOR_ERROR" },
      { status: 502 },
    );
  }

  const filename = safeDownloadName(file.path || path);
  return new NextResponse(new Uint8Array(file.content), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(file.size),
      // RFC 6266: the `filename="…"` token is the ASCII-safe fallback;
      // `filename*=UTF-8''…` is the encoded canonical form. Both derive from the
      // sanitized name (no control chars / quotes reach the header).
      "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});
