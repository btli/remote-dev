/**
 * DELETE /api/storage-targets/:id (admin) — delete a REGISTERED storage target.
 *
 * Only registered (`reg:<uuid>`) targets are deletable. The `sc:` / `node:` /
 * `default` options are DISCOVERED live (not stored), so they can't be deleted
 * here → 400.
 *
 * IMPORTANT: deleting a registered target does NOT affect existing instances —
 * each instance snapshots its chosen storage config into
 * `instance.storageConfigSnapshot` at provision time (§7), and the reconciler
 * rebuilds the PVC template from that snapshot, never by re-resolving the target.
 * So a delete here only removes the option from future dropdowns.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { registeredStorageTarget } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/storage-targets/[id]");

export const DELETE = withSupervisorAuth("admin", async (_request, { params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing storage target id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  // Reject discovered ids — only `reg:<uuid>` rows are deletable.
  if (id === "default" || id.startsWith("sc:") || id.startsWith("node:")) {
    return NextResponse.json(
      {
        error:
          "Only registered (reg:<id>) storage targets can be deleted; StorageClasses and nodes are discovered, not stored.",
        code: "NOT_DELETABLE",
      },
      { status: 400 },
    );
  }

  // Accept either the bare uuid or the `reg:<uuid>` option-id form.
  const uuid = id.startsWith("reg:") ? id.slice("reg:".length) : id;

  const row = await db.query.registeredStorageTarget.findFirst({
    where: eq(registeredStorageTarget.id, uuid),
  });
  if (!row) {
    return NextResponse.json(
      { error: "Storage target not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  await db
    .delete(registeredStorageTarget)
    .where(eq(registeredStorageTarget.id, uuid));

  log.info("deleted registered storage target", { id: uuid, name: row.name });
  return NextResponse.json({ deleted: { id: uuid, name: row.name } });
});
