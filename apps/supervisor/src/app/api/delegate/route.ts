/**
 * POST /api/delegate (operator) — cross-instance delegation (epic
 * remote-dev-oyej.11).
 *
 * Resolve the target instance by slug. If missing and `provisionIfMissing`,
 * create it via jvcx's create path (insert `requested` — do NOT reimplement
 * provisioning) and return 202 `{status:"provisioning"}` so the caller polls.
 * If `ready`/`suspended`, delegate via the SAME shared `dispatchAgentRun`
 * helper the per-instance agent-launch route (oyej.10) uses.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { validateSlug, namespaceForSlug } from "@/lib/slug";
import { resolveStorageTarget, StorageTargetResolutionError } from "@/lib/storage";
import { dispatchAgentRun, type AgentRunBody } from "@/lib/agent-dispatch";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/delegate");

interface DelegateBody extends AgentRunBody {
  toSlug?: string;
  provisionIfMissing?: boolean;
}

export const POST = withSupervisorAuth("operator", async (request, { user }) => {
  let body: DelegateBody;
  try {
    body = (await request.json()) as DelegateBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  if (!body.toSlug || typeof body.toSlug !== "string") {
    return NextResponse.json(
      { error: "toSlug is required", code: "INVALID_BODY" },
      { status: 400 },
    );
  }
  if (!body.projectId || !body.prompt) {
    return NextResponse.json(
      { error: "projectId and prompt are required", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const existing = await db.query.instance.findFirst({
    where: eq(instance.slug, body.toSlug),
  });

  // Target exists + visible → delegate via the shared dispatch helper.
  if (existing) {
    if (!canManageInstance(user, existing)) {
      return NextResponse.json(
        { error: "Instance not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return dispatchAgentRun(user, existing, body);
  }

  // Missing + no provisioning requested → 404.
  if (!body.provisionIfMissing) {
    return NextResponse.json(
      {
        error: `Instance "${body.toSlug}" not found (pass provisionIfMissing to create it)`,
        code: "NOT_FOUND",
      },
      { status: 404 },
    );
  }

  // Provision via jvcx's create path: insert a `requested` instance row.
  const slugResult = validateSlug(body.toSlug);
  if (!slugResult.valid) {
    return NextResponse.json(
      { error: slugResult.message, code: "INVALID_SLUG" },
      { status: 400 },
    );
  }
  let storage;
  try {
    storage = await resolveStorageTarget(null);
  } catch (err) {
    if (err instanceof StorageTargetResolutionError) {
      return NextResponse.json(
        { error: err.message, code: "INVALID_STORAGE_TARGET" },
        { status: err.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    throw err;
  }

  let created;
  try {
    const [inst] = await db
      .insert(instance)
      .values({
        slug: body.toSlug,
        displayName: `Delegated ${body.toSlug}`,
        ownerId: user.id,
        status: "requested",
        namespace: namespaceForSlug(body.toSlug),
        storageTargetId: storage.id,
        storageConfigSnapshot: JSON.stringify(storage.configSnapshot),
        storageRequest: storage.size,
      })
      .returning();
    created = inst;
  } catch (err) {
    if (/unique/i.test(String(err))) {
      return NextResponse.json(
        { error: `Slug "${body.toSlug}" is already in use`, code: "SLUG_TAKEN" },
        { status: 409 },
      );
    }
    throw err;
  }

  await db.insert(instanceAuditLog).values({
    instanceId: created.id,
    actorId: user.id,
    actorEmail: user.email,
    action: "create",
    previousStatus: null,
    newStatus: "requested",
  });

  log.info("delegation provisioned a new instance (queued)", {
    slug: body.toSlug,
    actor: user.email,
  });

  // The caller polls until ready, then re-delegates (or the run is dispatched
  // once ready by a follow-up call).
  return NextResponse.json(
    { status: "provisioning", instanceId: created.id, slug: created.slug },
    { status: 202 },
  );
});
