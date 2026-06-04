/**
 * Standalone TS brand types for the Supervisor schema.
 *
 * These narrow the inferred type of certain `text` columns via `.$type<X>()`.
 * They live in their OWN module (not the generated dialect files) so both the
 * generated `schema.sqlite.ts` / `schema.pg.ts` and the runtime barrel can
 * import them, and so the hand-maintained `schema.def.ts` can re-export them
 * for the `@/db/schema` consumers that depend on these names.
 */

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

/**
 * [oyej] Warm-pool entry status (epic remote-dev-oyej.8). A pooled instance is
 * pre-provisioned (`provisioning`), becomes `ready` once its instance row hits
 * `ready`, is `claimed` by an agent run, and `terminating` when GC'd.
 */
export type WarmPoolStatus =
  | "provisioning"
  | "ready"
  | "claimed"
  | "terminating";
