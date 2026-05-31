/**
 * /api/instances/:id
 *   GET    (viewer) — detail from DB, owner-checked.
 *   DELETE (admin)  — terminate; 501 PHASE1_PENDING (teardown is jvcx.4).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth, phase1Pending } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";

/** GET /api/instances/:id — owner-checked detail. */
export const GET = withSupervisorAuth("viewer", async (_request, { user, params }) => {
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

  // 404 both when missing AND when the caller may not see it — don't leak
  // existence of other owners' instances to non-admins.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json({ instance: row });
});

/**
 * DELETE /api/instances/:id — terminate the instance.
 * Teardown (delete namespace → confirm gone → mark deleted) is jvcx.4.
 */
export const DELETE = withSupervisorAuth("admin", async () => {
  return phase1Pending();
});
