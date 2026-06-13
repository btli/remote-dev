/**
 * /api/migrations — SOURCE-side migration jobs (server-to-server migration).
 *   GET  — list the caller's jobs (filter by projectId/status).
 *   POST — create a job and start it asynchronously (202 { jobId }).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as MigrationService from "@/services/migration-service";
import { MigrationServiceError } from "@/services/migration-errors";
import type { MigrationJobStatus } from "@/types/migration";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migrations");

const createSchema = z.object({
  projectId: z.string().min(1),
  peerInstanceId: z.string().min(1),
  options: z
    .object({
      workingTreeMode: z.enum(["full_tar", "git_essentials", "none"]).optional(),
      includeDotEnv: z.boolean().optional(),
      includeAgentCreds: z.boolean().optional(),
      includeSshKeys: z.boolean().optional(),
      includeAgentSettings: z.boolean().optional(),
      includeChannelHistory: z.boolean().optional(),
      removeSourceAfterVerify: z.boolean().optional(),
    })
    .optional(),
});

export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const jobs = await MigrationService.listJobs(userId, {
      projectId: searchParams.get("projectId") ?? undefined,
      status: (searchParams.get("status") as MigrationJobStatus | null) ?? undefined,
    });
    return NextResponse.json({ jobs });
  } catch (error) {
    log.error("Error listing migration jobs", { error: String(error) });
    return errorResponse("Failed to list migration jobs", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<unknown>(request);
  if ("error" in result) return result.error;
  const parsed = createSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const job = await MigrationService.createJob(userId, parsed.data);
    // Fire-and-forget: startJob NEVER throws — all failures land on the row.
    void MigrationService.startJob(job.id);
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    if (error instanceof MigrationServiceError) {
      return errorResponse(error.message, error.status, error.code);
    }
    log.error("Error creating migration job", { error: String(error) });
    return errorResponse("Failed to create migration job", 500);
  }
});
