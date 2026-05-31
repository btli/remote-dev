export const dynamic = "force-dynamic";

import Link from "next/link";
import { headers } from "next/headers";
import { validateAccessJWT, isCfAccessConfigured } from "@/lib/cf-access";
import { resolveSupervisorUser } from "@/lib/auth";
import { hasRole, type Role } from "@/lib/roles";
import { createLogger } from "@/lib/logger";
import { CreateInstanceForm } from "@/components/create-instance-form";

const log = createLogger("instances/new");

interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

/**
 * Resolve the current operator for this server-rendered page. Same precedence as
 * `withSupervisorAuth` (CF Access in prod, SUPERVISOR_ADMIN_EMAIL in local dev).
 * Kept local to the page (mirrors the dashboard's resolver) — there is no shared
 * server-page auth helper yet.
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

export default async function NewInstancePage() {
  const user = await getCurrentUser();

  // Creating an instance requires operator (or admin). Viewers / unauthenticated
  // users see a gentle gate rather than the form.
  if (!user || !hasRole(user, "operator")) {
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">Create instance</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {user
            ? "You need the operator role to create instances."
            : "Not authenticated."}
        </p>
        <Link
          href="/"
          className="mt-6 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <header className="border-b border-border pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create instance
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provision a new Remote Dev instance. Choose where its persistent data
          lives — the resiliency note shows the trade-off for each option.
        </p>
      </header>

      <section className="mt-8">
        <CreateInstanceForm />
      </section>
    </main>
  );
}
