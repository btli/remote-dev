/**
 * Default-project seeding for brand-new users (remote-dev-bxcn).
 *
 * A freshly provisioned instance (or a fresh single-server install) seeds its
 * `authorized_users` from `AUTHORIZED_USERS` at boot (`src/db/boot-seed.ts`),
 * but seeds NO project — boot runs before any `user` row exists (users are
 * minted on first login via `getOrCreateUserByEmail`), and `project.user_id` is
 * an FK to `user.id`, so a project cannot be seeded at boot.
 *
 * The result was a first-run trap: the user logs in but lands with zero
 * projects, and `terminal_session.project_id` is NOT NULL (Phase G0a), so the
 * client-side session-create guard hard-throws "Cannot create a session without
 * a project" — no network request fires and the UI looks dead.
 *
 * This module closes that gap from the OTHER side of boot: it gives every NEW
 * user a usable default "Home" group + "workspace" project the first time they
 * are created, reusing the EXACT same creation path the UI uses
 * (`GroupService.create` / `ProjectService.create` → the `CreateProjectGroup` /
 * `CreateProject` use-cases) so the seeded nodes are byte-identical to
 * UI-created ones except for `isAutoCreated = true`. It also wires the project's
 * default channels (`ensureProjectChannels`) so the project is immediately
 * usable, matching the lazy channel-bootstrap the UI relies on.
 *
 * IDEMPOTENT: it only seeds when the user has ZERO projects, so re-running on an
 * existing user (or racing a parallel login) is a no-op. NON-FATAL: any failure
 * is caught + warned (structured) — a seed failure must never break login.
 *
 * DIALECT-AGNOSTIC: pure row inserts into existing tables via the repositories,
 * so it works unchanged on both the SQLite (default) and Postgres backends with
 * no schema change.
 */

import { ProjectService } from "@/services/project-service";
import { GroupService } from "@/services/group-service";
import { ensureProjectChannels } from "@/services/channel-service";
import { container } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("EnsureDefaultProject");

/** Name of the default group seeded for a new user. */
export const DEFAULT_GROUP_NAME = "Home";
/** Name of the default project seeded for a new user. */
export const DEFAULT_PROJECT_NAME = "workspace";

/**
 * Ensure a freshly-created user has at least one usable project.
 *
 * No-ops (returns `false`) when the user already owns ≥1 project. Otherwise
 * creates a default group + project (owned by `userId`, `isAutoCreated = true`)
 * via the same use-cases the API routes use, ensures the project's default
 * channels, and returns `true`.
 *
 * Never throws: a failure is logged at WARN and swallowed so login is never
 * blocked by seeding. Returns `false` on a swallowed failure.
 */
export async function ensureDefaultProjectForUser(userId: string): Promise<boolean> {
  try {
    // Idempotency guard: only seed when the user has no projects at all. This
    // makes the helper safe to call on every login and collapses a race between
    // two concurrent first-logins (the loser sees the winner's project).
    const existing = await container.projectRepository.listByUser(userId);
    if (existing.length > 0) return false;

    const group = await GroupService.create({
      userId,
      name: DEFAULT_GROUP_NAME,
      parentGroupId: null,
    });

    const project = await ProjectService.create({
      userId,
      groupId: group.id,
      name: DEFAULT_PROJECT_NAME,
      isAutoCreated: true,
    });

    // Wire the project's default "#general" channel so it is immediately usable
    // (the UI ensures channels lazily on first listing; do it eagerly here so a
    // never-opened seeded project still has them).
    await ensureProjectChannels(project.id);

    log.info("Seeded default project for new user", {
      userId,
      groupId: group.id,
      projectId: project.id,
    });
    return true;
  } catch (error) {
    // NON-FATAL: a seeding failure must not break login. Make the warning loud +
    // structured so a genuinely-broken seed is impossible to miss.
    log.warn("Failed to seed default project for new user (non-fatal; login continues)", {
      userId,
      error: String(error),
    });
    return false;
  }
}
