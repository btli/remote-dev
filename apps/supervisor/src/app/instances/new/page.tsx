export const dynamic = "force-dynamic";

import Link from "next/link";
import { hasRole } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { CreateInstanceForm } from "@/components/create-instance-form";

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
