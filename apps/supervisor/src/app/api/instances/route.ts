/**
 * /api/instances
 *   GET  (viewer)   — owner-scoped list (admins see all).
 *   POST (operator) — validate slug + body, then 501 PHASE1_PENDING for the
 *                     actual k8s provisioning (provisioner is jvcx.4).
 */
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { validateSlug, namespaceForSlug } from "@/lib/slug";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances");

/** GET /api/instances — owner-scoped list. */
export const GET = withSupervisorAuth("viewer", async (_request, { user }) => {
  const rows =
    user.role === "admin"
      ? await db.select().from(instance).orderBy(desc(instance.createdAt))
      : await db
          .select()
          .from(instance)
          .where(eq(instance.ownerId, user.id))
          .orderBy(desc(instance.createdAt));

  return NextResponse.json({ instances: rows });
});

interface CreateInstanceBody {
  slug?: unknown;
  displayName?: unknown;
  storageTargetId?: unknown;
}

/**
 * POST /api/instances — create an instance.
 *
 * Phase 1: we validate the slug + body and the namespace mapping, but the k8s
 * provisioning (Namespace/Secret/Service/StatefulSet, readyz poll, rollback) is
 * jvcx.4. We therefore do NOT persist a row or touch the cluster — we return
 * 501 PHASE1_PENDING after validation so the contract (and validation errors)
 * are exercisable now without leaving orphaned `requested` rows behind.
 */
export const POST = withSupervisorAuth("operator", async (request, { user }) => {
  let body: CreateInstanceBody;
  try {
    body = (await request.json()) as CreateInstanceBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const slugResult = validateSlug(body.slug);
  if (!slugResult.valid) {
    return NextResponse.json(
      { error: slugResult.message, code: "INVALID_SLUG" },
      { status: 400 },
    );
  }
  const slug = body.slug as string;

  if (typeof body.displayName !== "string" || body.displayName.trim() === "") {
    return NextResponse.json(
      { error: "displayName is required", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  // Uniqueness pre-check (the unique index is the source of truth once we
  // actually insert in jvcx.4).
  const existing = await db.query.instance.findFirst({
    where: eq(instance.slug, slug),
  });
  if (existing) {
    return NextResponse.json(
      { error: `Slug "${slug}" is already in use`, code: "SLUG_TAKEN" },
      { status: 409 },
    );
  }

  log.info("Instance create requested (provisioning deferred to jvcx.4)", {
    slug,
    namespace: namespaceForSlug(slug),
    ownerId: user.id,
  });

  // TODO(jvcx.4): generate AUTH_SECRET, insert `requested` row (+ optional seed
  // row), and hand off to the provisioner/reconciler. Until then:
  return NextResponse.json(
    { error: "not implemented", code: "PHASE1_PENDING" },
    { status: 501 },
  );
});
