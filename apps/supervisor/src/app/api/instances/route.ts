/**
 * /api/instances
 *   GET  (viewer)   — owner-scoped list (admins see all).
 *   POST (operator) — validate, insert a `requested` instance row (+ optional
 *                     seed row), and return 202. The controller's reconciler
 *                     (jvcx.4) generates the AUTH_SECRET and provisions k8s.
 *
 * AUTH_SECRET is intentionally NOT generated here: it is created in the
 * reconciler at the requested→provisioning step so it lives only in the
 * controller process and never touches the API response, this process, or the
 * DB (spec Change 6). This route therefore stores no secret.
 */
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceSeed, instanceAuditLog } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { validateSlug, namespaceForSlug } from "@/lib/slug";
import { resolveDefaultStorageTarget } from "@/lib/storage";
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
  authorizedEmails?: unknown;
}

/** Parse + validate the optional authorizedEmails array (strings only). */
function parseAuthorizedEmails(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (
    !Array.isArray(input) ||
    !input.every((e) => typeof e === "string" && e.length > 0)
  ) {
    return null;
  }
  return input as string[];
}

/**
 * POST /api/instances — create an instance.
 *
 * Validates slug + body, enforces uniqueness, then inserts a `requested` row
 * (namespace `rdv-<slug>`, owner = caller, snapshotted default storage config)
 * plus an optional `instance_seed` row, writes a `create` audit-log entry, and
 * returns 202. The reconciler picks the `requested` row up on its next tick,
 * generates the AUTH_SECRET, and provisions the k8s objects.
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
  const displayName = body.displayName.trim();

  if (body.storageTargetId !== undefined && typeof body.storageTargetId !== "string") {
    return NextResponse.json(
      { error: "storageTargetId must be a string", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  let authorizedEmails: string[] | null = null;
  if (body.authorizedEmails !== undefined) {
    authorizedEmails = parseAuthorizedEmails(body.authorizedEmails);
    if (authorizedEmails === null) {
      return NextResponse.json(
        { error: "authorizedEmails must be an array of email strings", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
  }

  // Uniqueness pre-check (the unique index is the ultimate source of truth).
  const existing = await db.query.instance.findFirst({
    where: eq(instance.slug, slug),
  });
  if (existing) {
    return NextResponse.json(
      { error: `Slug "${slug}" is already in use`, code: "SLUG_TAKEN" },
      { status: 409 },
    );
  }

  // Resolve storage now so the chosen config is snapshotted onto the row (jvcx.5
  // will resolve by storageTargetId; Phase 1 always uses the cluster default).
  const storage = resolveDefaultStorageTarget();

  let created;
  try {
    const [row] = await db
      .insert(instance)
      .values({
        slug,
        displayName,
        ownerId: user.id,
        status: "requested",
        namespace: namespaceForSlug(slug),
        storageTargetId: storage.id,
        storageConfigSnapshot: JSON.stringify(storage.configSnapshot),
        storageRequest: storage.size,
      })
      .returning();
    created = row;
  } catch (err) {
    // Only a UNIQUE violation means the slug was taken (race with a concurrent
    // create). Any OTHER DB error must NOT be masked as a slug collision —
    // rethrow so withSupervisorAuth returns a 500.
    if (/unique/i.test(String(err))) {
      log.warn("instance insert hit slug uniqueness race", { slug });
      return NextResponse.json(
        { error: `Slug "${slug}" is already in use`, code: "SLUG_TAKEN" },
        { status: 409 },
      );
    }
    throw err;
  }

  if (authorizedEmails && authorizedEmails.length > 0) {
    await db.insert(instanceSeed).values({
      instanceId: created.id,
      authorizedEmails: JSON.stringify(authorizedEmails),
    });
  }

  await db.insert(instanceAuditLog).values({
    instanceId: created.id,
    actorId: user.id,
    actorEmail: user.email,
    action: "create",
    previousStatus: null,
    newStatus: "requested",
  });

  log.info("instance created (queued for provisioning)", {
    slug,
    namespace: created.namespace,
    ownerId: user.id,
  });

  return NextResponse.json({ instance: created }, { status: 202 });
});
