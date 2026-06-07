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
import {
  resolveStorageTarget,
  StorageTargetResolutionError,
} from "@/lib/storage";
import {
  normalizeAuthorizedEmailsStrict,
  AuthorizedEmailsError,
} from "@/lib/authorized-emails";
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

/**
 * Parse the optional authorizedEmails field to a plain `string[]` (or null when the
 * field is absent/malformed). SHAPE only — content normalization (trim, comma/
 * control-char rejection, caps, dedupe) is the shared strict normalizer's job.
 */
function parseAuthorizedEmails(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input) || !input.every((e) => typeof e === "string")) {
    return null;
  }
  return input as string[];
}

/**
 * POST /api/instances — create an instance.
 *
 * Validates slug + body, enforces uniqueness, then inserts a `requested` row
 * (namespace `rdv-<slug>`, owner = caller, snapshotted default storage config)
 * plus an `instance_seed` row carrying the authorized emails (an explicit list, or
 * a default of just the creator so the instance is always loginable), writes a
 * `create` audit-log entry, and returns 202. The reconciler picks the `requested`
 * row up on its next tick, generates the AUTH_SECRET, injects the emails as the
 * StatefulSet's AUTHORIZED_USERS env, and provisions the k8s objects.
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

  // Normalize the optional authorizedEmails (trim, reject comma/control-char
  // entries, cap, dedupe). An absent/empty list DEFAULTS to the authenticated
  // creator below so a creator can always log into their own instance (the UI
  // create path sends no emails — without this default it would provision an
  // instance nobody can log into; remote-dev-sb98).
  let authorizedEmails: string[] | null = null;
  if (body.authorizedEmails !== undefined) {
    const parsed = parseAuthorizedEmails(body.authorizedEmails);
    if (parsed === null) {
      return NextResponse.json(
        { error: "authorizedEmails must be an array of email strings", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
    try {
      authorizedEmails = normalizeAuthorizedEmailsStrict(parsed);
    } catch (err) {
      if (err instanceof AuthorizedEmailsError) {
        return NextResponse.json(
          { error: err.reason, code: "INVALID_BODY" },
          { status: 400 },
        );
      }
      throw err;
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

  // Resolve the chosen storage target NOW so its config is snapshotted onto the
  // row. The snapshot is authoritative (§7): the reconciler builds the PVC
  // template from `storageConfigSnapshot`, never by re-resolving the target —
  // so a later edit/delete of the target can't change this instance's volume.
  // A bad/unknown id → 400 (404 for a missing registered row).
  const storageTargetId =
    typeof body.storageTargetId === "string" ? body.storageTargetId : null;
  let storage;
  try {
    storage = await resolveStorageTarget(storageTargetId);
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

  // Always seed at least the creator so a provisioned instance is loginable:
  // an explicit non-empty list wins; otherwise default to [user.email] (the UI
  // create path supplies no list). The reconciler injects these as the
  // StatefulSet's AUTHORIZED_USERS env and the instance seeds itself at boot.
  // user.email is the authenticated creator's address — it never contains a
  // comma/control char, so the strict normalizer is a safe pass-through.
  const seedEmails =
    authorizedEmails && authorizedEmails.length > 0
      ? authorizedEmails
      : normalizeAuthorizedEmailsStrict([user.email]);
  if (seedEmails.length > 0) {
    await db.insert(instanceSeed).values({
      instanceId: created.id,
      authorizedEmails: JSON.stringify(seedEmails),
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
