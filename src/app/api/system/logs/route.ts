/**
 * System Logs API
 *
 * GET /api/system/logs - Query application log entries with filtering and pagination
 * DELETE /api/system/logs - Clear log entries
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { queryLogsUseCase, pruneLogsUseCase } from "@/infrastructure/container";
import type { LogLevelValue } from "@/domain/value-objects/LogLevel";
import type { LogSource } from "@/application/ports/LogRepository";

const VALID_LEVELS = new Set(["error", "warn", "info", "debug", "trace"]);
const VALID_SOURCES = new Set(["nextjs", "terminal"]);

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  return parseInt(value, 10);
}

export const GET = withApiAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get("level");
    const source = searchParams.get("source");

    if (level && !VALID_LEVELS.has(level)) {
      return errorResponse("Invalid level parameter", 400);
    }
    if (source && !VALID_SOURCES.has(source)) {
      return errorResponse("Invalid source parameter", 400);
    }

    const before = parseIntParam(searchParams.get("before"));
    if (Number.isNaN(before)) return errorResponse("Invalid before parameter", 400);

    const limit = parseIntParam(searchParams.get("limit"));
    if (Number.isNaN(limit)) return errorResponse("Invalid limit parameter", 400);

    const result = queryLogsUseCase.execute({
      level: level as LogLevelValue | undefined,
      namespace: searchParams.get("namespace") ?? undefined,
      source: source as LogSource | undefined,
      search: searchParams.get("search") ?? undefined,
      before,
      limit,
    });

    const entries = result.entries.map((e) => ({
      id: e.id,
      timestamp: new Date(e.timestamp).toISOString(),
      level: e.level,
      namespace: e.namespace,
      message: e.message,
      data: e.data ? JSON.parse(e.data) : null,
      source: e.source,
    }));

    return NextResponse.json({ entries, hasMore: result.hasMore });
  } catch {
    return errorResponse("Failed to query logs", 500);
  }
});

export const DELETE = withApiAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseIntParam(searchParams.get("olderThanDays")) ?? 0;
    if (Number.isNaN(days)) return errorResponse("Invalid olderThanDays parameter", 400);

    const deleted = pruneLogsUseCase.execute(days);
    return NextResponse.json({ deleted });
  } catch {
    return errorResponse("Failed to clear logs", 500);
  }
});
