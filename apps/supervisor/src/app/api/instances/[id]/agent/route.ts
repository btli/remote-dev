/**
 * POST /api/instances/:id/agent (operator) — launch an agent run on instance
 * `:id` by proxying into its REAL agent-run launcher (epic remote-dev-oyej.10).
 *
 * Owner-scoped (404, not 403, when missing or not visible — matches the existing
 * instance routes). A suspended instance is woken first (wake-on-traffic); a
 * terminating/provisioning instance yields 409. Returns the proxied run handle.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { dispatchAgentRun, type AgentRunBody } from "@/lib/agent-dispatch";

export const POST = withSupervisorAuth(
  "operator",
  async (request, { user, params }) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Missing instance id", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
    const row = await db.query.instance.findFirst({
      where: eq(instance.id, id),
    });
    // 404 (not 403) when missing OR not visible — never leak other owners.
    if (!row || !canManageInstance(user, row)) {
      return NextResponse.json(
        { error: "Instance not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    let body: AgentRunBody;
    try {
      body = (await request.json()) as AgentRunBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body", code: "INVALID_JSON" },
        { status: 400 },
      );
    }
    if (!body.projectId || !body.prompt) {
      return NextResponse.json(
        { error: "projectId and prompt are required", code: "INVALID_BODY" },
        { status: 400 },
      );
    }

    return dispatchAgentRun(user, row, body);
  },
);
