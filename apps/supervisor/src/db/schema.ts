/**
 * Supervisor Drizzle schema (sqlite / libsql).
 *
 * Phase-1 tables only — see the k3s supervisor spec §6.2. The `machine` and
 * `capacity_event` tables (machine autoscaling, §8.7) are Phase 3 and are
 * intentionally OMITTED here; add them when Phase 3 lands.
 *
 * Instances are OWNER-SCOPED: `instance.ownerId` references the creating
 * supervisor_user. Operators manage only their own instances; admins see all.
 * Owner-scope enforcement lives in `src/lib/roles.ts` (`canManageInstance`).
 */

import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

/** Supervisor RBAC role. Mirrors the union in src/lib/roles.ts. */
export type SupervisorRole = "admin" | "operator" | "viewer";

/**
 * Instance lifecycle status (§6.3 state machine):
 *   requested → provisioning → ready ↔ suspended → terminating → deleted
 *   (+ error from any state)
 */
export type InstanceStatus =
  | "requested"
  | "provisioning"
  | "ready"
  | "suspended"
  | "terminating"
  | "deleted"
  | "error";

/** Storage target backend kind (§7). */
export type StorageTargetKind =
  | "local-path"
  | "storage-class"
  | "nfs"
  | "cloud-csi";

const now = () => new Date();

/**
 * Operators/admins/viewers of the Supervisor. The role concept the main app
 * lacks. First admin is seeded from SUPERVISOR_ADMIN_EMAIL (see src/lib/auth.ts).
 */
export const supervisorUser = sqliteTable("supervisor_user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  role: text("role").$type<SupervisorRole>().notNull().default("viewer"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now)
    .$onUpdateFn(now),
});

/**
 * A provisioned (or to-be-provisioned) Remote Dev instance.
 *
 * Namespace model (§15 B2): ONE namespace per instance, `rdv-<slug>`, with a
 * Service named `rdv` inside it. The `namespace` column stores `rdv-<slug>`.
 */
export const instance = sqliteTable(
  "instance",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    // Owner-scoping: the supervisor_user who created this instance.
    // Explicit RESTRICT (no cascade): deleting a user must NOT nuke their
    // running instances — reassign or delete the instances first.
    ownerId: text("owner_id")
      .notNull()
      .references(() => supervisorUser.id, { onDelete: "restrict" }),
    status: text("status").$type<InstanceStatus>().notNull().default("requested"),
    errorMessage: text("error_message"),
    // One namespace per instance: "rdv-<slug>" (§15 B2). notNull() with NO
    // insert-time default: jvcx.4's create path MUST set
    // `namespace: namespaceForSlug(slug)` (== `rdv-<slug>`); omitting it fails
    // at insert.
    namespace: text("namespace").notNull(),
    imageTag: text("image_tag"),
    baseUrl: text("base_url"),
    // FK is soft (no .references) so deleting a storage target cannot cascade
    // into live instances; the chosen config is snapshotted below.
    storageTargetId: text("storage_target_id"),
    // Snapshot of the chosen storage target's config at provision time so later
    // edits/deletes of the target don't corrupt existing instances (§7). JSON text.
    storageConfigSnapshot: text("storage_config_snapshot"),
    cpuRequest: text("cpu_request"),
    cpuLimit: text("cpu_limit"),
    memRequest: text("mem_request"),
    memLimit: text("mem_limit"),
    storageRequest: text("storage_request"),
    lastReconciledAt: integer("last_reconciled_at", { mode: "timestamp_ms" }),
    provisionedAt: integer("provisioned_at", { mode: "timestamp_ms" }),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(now)
      .$onUpdateFn(now),
  },
  (t) => [
    index("instance_owner_idx").on(t.ownerId),
    index("instance_status_idx").on(t.status),
  ],
);

/**
 * Storage targets that are NOT live-discoverable (NFS / custom). StorageClasses
 * and nodes are discovered from the cluster at request time, not stored here.
 */
export const registeredStorageTarget = sqliteTable("registered_storage_target", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  kind: text("kind").$type<StorageTargetKind>().notNull(),
  config: text("config").notNull(), // JSON text
  resiliencyNote: text("resiliency_note"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
});

/** Append-only audit trail of instance lifecycle actions. */
export const instanceAuditLog = sqliteTable(
  "instance_audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    instanceId: text("instance_id")
      .notNull()
      .references(() => instance.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    previousStatus: text("previous_status").$type<InstanceStatus>(),
    newStatus: text("new_status").$type<InstanceStatus>(),
    metadata: text("metadata"), // JSON text
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(now),
  },
  (t) => [index("instance_audit_log_instance_idx").on(t.instanceId)],
);

/** First-boot seed bookkeeping for an instance (authorized users → seed Job). */
export const instanceSeed = sqliteTable("instance_seed", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  instanceId: text("instance_id")
    .notNull()
    .unique()
    .references(() => instance.id, { onDelete: "cascade" }),
  authorizedEmails: text("authorized_emails"), // JSON text (array of emails)
  jobDispatched: integer("job_dispatched", { mode: "boolean" })
    .notNull()
    .default(false),
  jobName: text("job_name"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

// --- Phase 3 (NOT in this scaffold) -----------------------------------------
// `machine(machineId, providerId, providerType, displayName, nodeName, arch,
//   instanceType, phase, provisionedAt, readyAt, errorMessage, labels,
//   pinnedPvcCount, timestamps)` and
// `capacity_event(id, eventType, machineId, pendingPods, workerCount, detail,
//   createdAt)` are added when machine autoscaling lands (spec §8.7).

// Inferred row types for convenience in services / route handlers.
export type SupervisorUserRow = typeof supervisorUser.$inferSelect;
export type InstanceRow = typeof instance.$inferSelect;
export type RegisteredStorageTargetRow =
  typeof registeredStorageTarget.$inferSelect;
export type InstanceAuditLogRow = typeof instanceAuditLog.$inferSelect;
export type InstanceSeedRow = typeof instanceSeed.$inferSelect;
