/**
 * Supervisor RBAC roles + owner-scoping helpers.
 *
 * Role matrix (spec §6.6):
 *   - viewer   : read instances / nodes / storage
 *   - operator : create / suspend / resume instances
 *   - admin    : delete instances, register storage targets, manage users
 *
 * Roles are hierarchical: admin ⊇ operator ⊇ viewer.
 *
 * Ownership (LOCKED product decision): instances are owner-scoped. Operators
 * may manage only the instances they created; admins may manage all.
 */

export const ROLES = ["viewer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Higher rank = more privilege. */
const RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Minimal shape needed for authorization decisions. */
export interface RoleUser {
  id: string;
  role: Role;
}

/** Minimal shape of an instance needed for owner-scoping decisions. */
export interface OwnedInstance {
  ownerId: string;
}

/**
 * True if `user` holds at least the `required` role (hierarchical).
 *
 * @example hasRole({ id, role: "admin" }, "operator") === true
 */
export function hasRole(
  user: Pick<RoleUser, "role"> | null | undefined,
  required: Role,
): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[required];
}

/**
 * True if `user` may manage `instance`: admins manage everything; everyone else
 * manages only instances they own. This is the single owner-scoping gate —
 * the API list/detail/mutation handlers all funnel through it.
 */
export function canManageInstance(
  user: Pick<RoleUser, "id" | "role"> | null | undefined,
  instance: OwnedInstance | null | undefined,
): boolean {
  if (!user || !instance) return false;
  if (user.role === "admin") return true;
  return instance.ownerId === user.id;
}
