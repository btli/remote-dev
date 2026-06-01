export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { instance, type InstanceRow } from "@/db/schema";
import {
  validateAccessJWT,
  isCfAccessConfigured,
} from "@/lib/cf-access";
import Link from "next/link";
import { resolveSupervisorUser } from "@/lib/auth";
import { hasRole, type Role } from "@/lib/roles";
import { StatusBadge } from "@/components/status-badge";
import { createLogger } from "@/lib/logger";

const log = createLogger("Dashboard");

interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

/**
 * Resolve the current operator for a server-rendered page. Same precedence as
 * `withSupervisorAuth` (CF Access in prod, SUPERVISOR_ADMIN_EMAIL in local dev),
 * but reads headers via next/headers instead of a Request.
 */
async function getCurrentUser(): Promise<CurrentUser | null> {
  let email: string | null = null;

  if (isCfAccessConfigured()) {
    const hdrs = await headers();
    const headerToken = hdrs.get("cf-access-jwt-assertion");
    const cookie = hdrs.get("cookie");
    const cookieToken = cookie?.match(/CF_Authorization=([^;]+)/)?.[1] ?? null;
    const cfUser = await validateAccessJWT(headerToken ?? cookieToken);
    email = cfUser?.email ?? null;
  } else {
    const adminEmail = process.env.SUPERVISOR_ADMIN_EMAIL;
    email = adminEmail && adminEmail.length > 0 ? adminEmail : null;
  }

  if (!email) return null;

  try {
    const user = await resolveSupervisorUser(email);
    return { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    log.error("Failed to resolve current user", { error: String(error) });
    return null;
  }
}

/** Owner-scoped instance list: admins see all; others see only their own. */
async function listVisibleInstances(user: CurrentUser): Promise<InstanceRow[]> {
  if (user.role === "admin") {
    return db.select().from(instance).orderBy(desc(instance.createdAt));
  }
  return db
    .select()
    .from(instance)
    .where(eq(instance.ownerId, user.id))
    .orderBy(desc(instance.createdAt));
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">Remote Dev Supervisor</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Not authenticated. In production this UI is gated by Cloudflare Access;
          for local development set{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            SUPERVISOR_ADMIN_EMAIL
          </code>{" "}
          in <code className="font-mono text-xs">.env.local</code>.
        </p>
      </main>
    );
  }

  const instances = await listVisibleInstances(user);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Remote Dev Supervisor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.role === "admin"
              ? "All instances across the cluster."
              : "Instances you own."}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {hasRole(user, "operator") ? (
            <Link
              href="/instances/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Create instance
            </Link>
          ) : null}
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{user.email}</div>
            <div className="uppercase tracking-wide">{user.role}</div>
          </div>
        </div>
      </header>

      <section className="mt-8">
        {instances.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <h2 className="text-base font-medium">No instances yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {hasRole(user, "operator") ? (
                <>
                  Use{" "}
                  <span className="font-medium text-foreground">
                    Create instance
                  </span>{" "}
                  to provision one. It will be reachable at{" "}
                  <code className="font-mono text-xs">/&lt;slug&gt;</code> through
                  the router.
                </>
              ) : (
                <>
                  Instances appear here once an operator provisions them; each is
                  reachable at{" "}
                  <code className="font-mono text-xs">/&lt;slug&gt;</code> through
                  the router.
                </>
              )}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {instances.map((inst) => (
              <li key={inst.id}>
                <Link
                  href={`/instances/${inst.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {inst.displayName}
                      </span>
                      <StatusBadge status={inst.status} />
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      /{inst.slug} · {inst.namespace}
                    </div>
                  </div>
                  {inst.baseUrl ? (
                    <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
                      {inst.baseUrl}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 text-xs text-muted-foreground">
        Phase 2 — instance lifecycle (remote-dev-jvcx.8).
      </footer>
    </main>
  );
}
