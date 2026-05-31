/**
 * /api/storage-targets (spec §6.7, §7)
 *   GET  (viewer) — live discovery: StorageClasses + schedulable nodes
 *                   (local-path) + registered NFS/custom targets, each with a
 *                   resiliencyNote for the create-instance dropdown.
 *   POST (admin)  — register an NFS/custom target (the kinds NOT discoverable
 *                   live). For NFS, `config` should reference the dynamic
 *                   `nfs-subdir-external-provisioner` StorageClass (§15 B3 — a
 *                   dynamic SC, NOT a static PV), e.g.
 *                   `{ "storageClassName": "nfs-client" }`.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { registeredStorageTarget, type StorageTargetKind } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { discoverStorageTargets } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/storage-targets");

/** GET /api/storage-targets — live discovery. */
export const GET = withSupervisorAuth("viewer", async () => {
  const options = await discoverStorageTargets();
  return NextResponse.json({ targets: options });
});

const VALID_KINDS: ReadonlySet<StorageTargetKind> = new Set([
  "local-path",
  "storage-class",
  "nfs",
  "cloud-csi",
]);

interface RegisterBody {
  name?: unknown;
  kind?: unknown;
  config?: unknown;
  resiliencyNote?: unknown;
  isDefault?: unknown;
}

/**
 * POST /api/storage-targets — register an NFS/custom target (admin only).
 *
 * Discovered kinds (StorageClasses, local-path nodes) are NOT stored — only
 * targets that can't be discovered live (NFS / custom). Validates the body,
 * inserts a `registered_storage_target` row, and returns 201. A duplicate name
 * (the unique index) → 409.
 */
export const POST = withSupervisorAuth("admin", async (request) => {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  if (typeof body.name !== "string" || body.name.trim() === "") {
    return NextResponse.json(
      { error: "name is required", code: "INVALID_BODY" },
      { status: 400 },
    );
  }
  const name = body.name.trim();

  if (typeof body.kind !== "string" || !VALID_KINDS.has(body.kind as StorageTargetKind)) {
    return NextResponse.json(
      {
        error: "kind must be one of: local-path, storage-class, nfs, cloud-csi",
        code: "INVALID_BODY",
      },
      { status: 400 },
    );
  }
  const kind = body.kind as StorageTargetKind;

  // config must be a JSON object (it's stored as JSON text and parsed back at
  // resolution time — for NFS it should carry the dynamic provisioner's
  // `storageClassName`).
  if (
    typeof body.config !== "object" ||
    body.config === null ||
    Array.isArray(body.config)
  ) {
    return NextResponse.json(
      { error: "config must be a JSON object", code: "INVALID_BODY" },
      { status: 400 },
    );
  }
  const config = body.config as Record<string, unknown>;

  // SC-backed kinds MUST carry a non-empty `config.storageClassName`. Per §15 B3
  // NFS is a dynamic `nfs-subdir-external-provisioner` StorageClass, so a
  // registered NFS (or storage-class / cloud-csi) target without one is unusable
  // (it would silently fall back to the cluster default SC at PVC binding).
  if (kind === "nfs" || kind === "storage-class" || kind === "cloud-csi") {
    if (
      typeof config.storageClassName !== "string" ||
      config.storageClassName.trim() === ""
    ) {
      return NextResponse.json(
        {
          error: `config.storageClassName (non-empty string) is required for kind "${kind}"`,
          code: "INVALID_CONFIG",
        },
        { status: 400 },
      );
    }
  }

  if (body.resiliencyNote !== undefined && typeof body.resiliencyNote !== "string") {
    return NextResponse.json(
      { error: "resiliencyNote must be a string", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") {
    return NextResponse.json(
      { error: "isDefault must be a boolean", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .insert(registeredStorageTarget)
      .values({
        name,
        kind,
        config: JSON.stringify(config),
        resiliencyNote: (body.resiliencyNote as string | undefined) ?? null,
        isDefault: (body.isDefault as boolean | undefined) ?? false,
      })
      .returning();

    log.info("registered storage target", { name, kind });
    return NextResponse.json({ target: row }, { status: 201 });
  } catch (err) {
    // Only a UNIQUE violation means the name is taken; any other error is a 500.
    if (/unique/i.test(String(err))) {
      return NextResponse.json(
        { error: `A storage target named "${name}" already exists`, code: "NAME_TAKEN" },
        { status: 409 },
      );
    }
    throw err;
  }
});
