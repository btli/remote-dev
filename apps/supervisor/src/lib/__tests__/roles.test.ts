import { describe, it, expect } from "vitest";
import {
  hasRole,
  canManageInstance,
  isRole,
  ROLES,
  type Role,
} from "@/lib/roles";

describe("roles hierarchy", () => {
  it("admin satisfies every required role", () => {
    const admin = { id: "u1", role: "admin" as Role };
    expect(hasRole(admin, "viewer")).toBe(true);
    expect(hasRole(admin, "operator")).toBe(true);
    expect(hasRole(admin, "admin")).toBe(true);
  });

  it("operator satisfies viewer + operator but not admin", () => {
    const op = { role: "operator" as Role };
    expect(hasRole(op, "viewer")).toBe(true);
    expect(hasRole(op, "operator")).toBe(true);
    expect(hasRole(op, "admin")).toBe(false);
  });

  it("viewer satisfies only viewer", () => {
    const viewer = { role: "viewer" as Role };
    expect(hasRole(viewer, "viewer")).toBe(true);
    expect(hasRole(viewer, "operator")).toBe(false);
    expect(hasRole(viewer, "admin")).toBe(false);
  });

  it("null/undefined user never has a role", () => {
    expect(hasRole(null, "viewer")).toBe(false);
    expect(hasRole(undefined, "viewer")).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts known roles", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
  });
  it("rejects unknown values", () => {
    expect(isRole("superadmin")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("canManageInstance owner-scoping", () => {
  const owner = { id: "owner-1", role: "operator" as Role };
  const otherOperator = { id: "owner-2", role: "operator" as Role };
  const admin = { id: "admin-1", role: "admin" as Role };
  const viewer = { id: "owner-1", role: "viewer" as Role };
  const inst = { ownerId: "owner-1" };

  it("owner can manage their own instance", () => {
    expect(canManageInstance(owner, inst)).toBe(true);
  });

  it("a different operator cannot manage someone else's instance", () => {
    expect(canManageInstance(otherOperator, inst)).toBe(false);
  });

  it("admin can manage any instance regardless of owner", () => {
    expect(canManageInstance(admin, inst)).toBe(true);
    expect(canManageInstance(admin, { ownerId: "owner-2" })).toBe(true);
  });

  it("ownership is checked by id, even for a viewer who owns it", () => {
    // (role gating for the action is separate; this only checks ownership.)
    expect(canManageInstance(viewer, inst)).toBe(true);
  });

  it("null user or null instance is never manageable", () => {
    expect(canManageInstance(null, inst)).toBe(false);
    expect(canManageInstance(owner, null)).toBe(false);
    expect(canManageInstance(admin, null)).toBe(false);
  });
});
