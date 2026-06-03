// Source-of-truth schema definition for the SUPERVISOR app (neutral, dialect-
// agnostic).
//
// This file is HAND-MAINTAINED. Edit it to change the schema, then run
// `bun run db:codegen` (in apps/supervisor) to regenerate src/db/schema.sqlite.ts,
// src/db/schema.pg.ts and the src/db/schema.ts barrel. The structural snapshot
// (root scripts/schema-structural-snapshot.ts) proves the generated SQLite
// schema is behavior-identical to the historical hand-written schema.
//
// Phase-1 tables only — see the k3s supervisor spec §6.2. The `machine` and
// `capacity_event` tables (machine autoscaling, §8.7) are Phase 3 and are
// intentionally OMITTED here; add them when Phase 3 lands.
//
// Instances are OWNER-SCOPED: `instance.ownerId` references the creating
// supervisor_user. Operators manage only their own instances; admins see all.
// Owner-scope enforcement lives in `src/lib/roles.ts` (`canManageInstance`).
//
// NOTE: the type-import block below is reused VERBATIM by the generator so the
// emitted dialect files carry the same `.$type<X>()` brands as before.
import type { AdapterAccountType } from "next-auth/adapters";
import type {
  SupervisorRole,
  InstanceStatus,
  StorageTargetKind,
} from "./schema-types";

// Re-exported so the verbatim import block above (consumed by the codegen
// extractor) is not flagged as unused, and so the `@/db/schema` barrel keeps
// surfacing these brand names to their consumers.
export type { AdapterAccountType, SupervisorRole, InstanceStatus, StorageTargetKind };

// DSL vocabulary lives in the shared generator core. Imported BELOW the verbatim
// brand-import block above so the codegen extractor (which stops at the first
// `export type`) does not copy it into the generated dialect files.
import type {
  ColumnKind,
  DefaultValue,
  DefaultFn,
  DefaultRaw,
  ColumnDefault,
  ColumnReference,
  ColumnDefinition,
  IndexDefinition,
  TableDefinition,
  SchemaDefinition,
} from "../../../../scripts/lib/schema-codegen";

export type {
  ColumnKind,
  DefaultValue,
  DefaultFn,
  DefaultRaw,
  ColumnDefault,
  ColumnReference,
  ColumnDefinition,
  IndexDefinition,
  TableDefinition,
  SchemaDefinition,
};

export const schema: SchemaDefinition = [
  // --- Supervisor control-plane tables --------------------------------------
  {
    exportName: "supervisorUser",
    sqlName: "supervisor_user",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "email", dbName: "email", kind: "text", notNull: true, unique: true },
      { field: "role", dbName: "role", kind: "text", notNull: true, typeBrand: "SupervisorRole", default: { kind: "value", value: "\"viewer\"" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" }, onUpdateNow: true },
    ],
  },
  {
    exportName: "instance",
    sqlName: "instance",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "slug", dbName: "slug", kind: "text", notNull: true, unique: true },
      { field: "displayName", dbName: "display_name", kind: "text", notNull: true },
      // Explicit RESTRICT (no cascade): deleting a user must NOT nuke their
      // running instances — reassign or delete the instances first.
      { field: "ownerId", dbName: "owner_id", kind: "text", notNull: true, references: { table: "supervisorUser", column: "id", onDelete: "restrict" } },
      { field: "status", dbName: "status", kind: "text", notNull: true, typeBrand: "InstanceStatus", default: { kind: "value", value: "\"requested\"" } },
      { field: "errorMessage", dbName: "error_message", kind: "text" },
      // One namespace per instance: "rdv-<slug>" (§15 B2). notNull() with NO
      // insert-time default; the create path MUST set it.
      { field: "namespace", dbName: "namespace", kind: "text", notNull: true },
      { field: "imageTag", dbName: "image_tag", kind: "text" },
      { field: "baseUrl", dbName: "base_url", kind: "text" },
      // Soft FK (no .references): deleting a storage target cannot cascade into
      // live instances; the chosen config is snapshotted below.
      { field: "storageTargetId", dbName: "storage_target_id", kind: "text" },
      { field: "storageConfigSnapshot", dbName: "storage_config_snapshot", kind: "text" },
      // Postgres dual-backend (Unit 8): when the supervisor runs on Postgres,
      // each instance gets its OWN database on the shared CNPG cluster. This
      // mirrors storageConfigSnapshot — nullable; stores the JSON
      // {type:"postgres", dbName, roleName, poolerHost} the provisioner wrote at
      // create time, or null for the SQLite (per-PVC sqlite.db) path.
      { field: "dbConfigSnapshot", dbName: "db_config_snapshot", kind: "text" },
      { field: "cpuRequest", dbName: "cpu_request", kind: "text" },
      { field: "cpuLimit", dbName: "cpu_limit", kind: "text" },
      { field: "memRequest", dbName: "mem_request", kind: "text" },
      { field: "memLimit", dbName: "mem_limit", kind: "text" },
      { field: "storageRequest", dbName: "storage_request", kind: "text" },
      { field: "lastReconciledAt", dbName: "last_reconciled_at", kind: "timestampMs" },
      { field: "provisionedAt", dbName: "provisioned_at", kind: "timestampMs" },
      { field: "suspendedAt", dbName: "suspended_at", kind: "timestampMs" },
      { field: "deletedAt", dbName: "deleted_at", kind: "timestampMs" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
      { field: "updatedAt", dbName: "updated_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" }, onUpdateNow: true },
    ],
    indexes: [
      { name: "instance_owner_idx", columns: ["ownerId"] },
      { name: "instance_status_idx", columns: ["status"] },
    ],
  },
  {
    exportName: "registeredStorageTarget",
    sqlName: "registered_storage_target",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "name", dbName: "name", kind: "text", notNull: true, unique: true },
      { field: "kind", dbName: "kind", kind: "text", notNull: true, typeBrand: "StorageTargetKind" },
      { field: "config", dbName: "config", kind: "text", notNull: true },
      { field: "resiliencyNote", dbName: "resiliency_note", kind: "text" },
      { field: "isDefault", dbName: "is_default", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
  },
  {
    exportName: "instanceAuditLog",
    sqlName: "instance_audit_log",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "instanceId", dbName: "instance_id", kind: "text", notNull: true, references: { table: "instance", column: "id", onDelete: "cascade" } },
      { field: "actorId", dbName: "actor_id", kind: "text" },
      { field: "actorEmail", dbName: "actor_email", kind: "text" },
      { field: "action", dbName: "action", kind: "text", notNull: true },
      { field: "previousStatus", dbName: "previous_status", kind: "text", typeBrand: "InstanceStatus" },
      { field: "newStatus", dbName: "new_status", kind: "text", typeBrand: "InstanceStatus" },
      { field: "metadata", dbName: "metadata", kind: "text" },
      { field: "createdAt", dbName: "created_at", kind: "timestampMs", notNull: true, default: { kind: "fn", fn: "now" } },
    ],
    indexes: [
      { name: "instance_audit_log_instance_idx", columns: ["instanceId"] },
    ],
  },
  {
    exportName: "instanceSeed",
    sqlName: "instance_seed",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "instanceId", dbName: "instance_id", kind: "text", notNull: true, unique: true, references: { table: "instance", column: "id", onDelete: "cascade" } },
      { field: "authorizedEmails", dbName: "authorized_emails", kind: "text" },
      { field: "jobDispatched", dbName: "job_dispatched", kind: "boolean", notNull: true, default: { kind: "value", value: "false" } },
      { field: "jobName", dbName: "job_name", kind: "text" },
      { field: "completedAt", dbName: "completed_at", kind: "timestampMs" },
    ],
  },
  // --- NextAuth (Auth.js) identity tables -------------------------------------
  // Standard NextAuth Drizzle schema (table names `user` / `account` /
  // `session` / `verificationToken`), mirroring the root app so
  // `@auth/drizzle-adapter` works identically. These store the OIDC *identity*
  // only. AUTHORIZATION lives in `supervisor_user` (the role table), linked to
  // this identity BY EMAIL, never by id. `instance.ownerId` keeps referencing
  // `supervisor_user.id` (NOT `user.id`).
  {
    exportName: "users",
    sqlName: "user",
    columns: [
      { field: "id", dbName: "id", kind: "text", primaryKey: true, default: { kind: "fn", fn: "uuid" } },
      { field: "name", dbName: "name", kind: "text" },
      { field: "email", dbName: "email", kind: "text", unique: true },
      { field: "emailVerified", dbName: "emailVerified", kind: "timestampMs" },
      { field: "image", dbName: "image", kind: "text" },
    ],
  },
  {
    exportName: "accounts",
    sqlName: "account",
    columns: [
      { field: "userId", dbName: "userId", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "type", dbName: "type", kind: "text", notNull: true, typeBrand: "AdapterAccountType" },
      { field: "provider", dbName: "provider", kind: "text", notNull: true },
      { field: "providerAccountId", dbName: "providerAccountId", kind: "text", notNull: true },
      { field: "refresh_token", dbName: "refresh_token", kind: "text" },
      { field: "access_token", dbName: "access_token", kind: "text" },
      { field: "expires_at", dbName: "expires_at", kind: "integer" },
      { field: "token_type", dbName: "token_type", kind: "text" },
      { field: "scope", dbName: "scope", kind: "text" },
      { field: "id_token", dbName: "id_token", kind: "text" },
      { field: "session_state", dbName: "session_state", kind: "text" },
    ],
    primaryKey: ["provider", "providerAccountId"],
    indexes: [
      { name: "account_user_idx", columns: ["userId"] },
    ],
  },
  {
    exportName: "sessions",
    sqlName: "session",
    columns: [
      { field: "sessionToken", dbName: "sessionToken", kind: "text", primaryKey: true },
      { field: "userId", dbName: "userId", kind: "text", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
      { field: "expires", dbName: "expires", kind: "timestampMs", notNull: true },
    ],
  },
  {
    exportName: "verificationTokens",
    sqlName: "verificationToken",
    columns: [
      { field: "identifier", dbName: "identifier", kind: "text", notNull: true },
      { field: "token", dbName: "token", kind: "text", notNull: true },
      { field: "expires", dbName: "expires", kind: "timestampMs", notNull: true },
    ],
    primaryKey: ["identifier", "token"],
  },
];
