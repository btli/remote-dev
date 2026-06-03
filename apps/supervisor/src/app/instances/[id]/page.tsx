export const dynamic = "force-dynamic";

import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import { canManageInstance, hasRole } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { StatusBadge } from "@/components/status-badge";
import { InstanceActions } from "@/components/instance-actions";
import { InstanceLogs } from "@/components/instance-logs";
import { InstanceEvents } from "@/components/instance-events";
import { InstanceStorage } from "@/components/instance-storage";

function NotVisible({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold">Instance</h1>
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      <Link
        href="/"
        className="mt-6 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        Back to dashboard
      </Link>
    </main>
  );
}

function fmt(value: Date | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm">{children}</dd>
    </div>
  );
}

export default async function InstanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <NotVisible message="Not authenticated." />;
  }

  const { id } = await params;
  const row = await db.query.instance.findFirst({
    where: eq(instance.id, id),
  });

  // 404-equivalent: don't leak existence of other owners' instances.
  if (!row || !canManageInstance(user, row)) {
    return <NotVisible message="Instance not found." />;
  }

  const auditRows = await db
    .select()
    .from(instanceAuditLog)
    .where(eq(instanceAuditLog.instanceId, id))
    .orderBy(desc(instanceAuditLog.createdAt));

  const canOperate = hasRole(user, "operator");
  const canDelete = hasRole(user, "admin");

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {row.displayName}
            </h1>
            <StatusBadge status={row.status} />
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            /{row.slug} · {row.namespace}
          </p>
        </div>
        {row.baseUrl ? (
          <a
            href={row.baseUrl}
            className="shrink-0 truncate font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {row.baseUrl}
          </a>
        ) : null}
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">Metadata</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
          <MetaItem label="Image">
            <span className="font-mono text-xs">{row.imageTag ?? "default"}</span>
          </MetaItem>
          <MetaItem label="Storage">
            <span className="font-mono text-xs">{row.storageRequest ?? "—"}</span>
          </MetaItem>
          <MetaItem label="Owner">
            <span className="font-mono text-xs">{row.ownerId}</span>
          </MetaItem>
          <MetaItem label="Created">{fmt(row.createdAt)}</MetaItem>
          <MetaItem label="Provisioned">{fmt(row.provisionedAt)}</MetaItem>
          <MetaItem label="Last reconciled">{fmt(row.lastReconciledAt)}</MetaItem>
          {row.status === "suspended" ? (
            <MetaItem label="Suspended">{fmt(row.suspendedAt)}</MetaItem>
          ) : null}
          {row.errorMessage ? (
            <MetaItem label="Error">
              <span className="text-destructive">{row.errorMessage}</span>
            </MetaItem>
          ) : null}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">Actions</h2>
        <div className="mt-3">
          <InstanceActions
            instanceId={row.id}
            slug={row.slug}
            status={row.status}
            storageRequest={row.storageRequest}
            imageTag={row.imageTag}
            canOperate={canOperate}
            canDelete={canDelete}
          />
        </div>
      </section>

      {canOperate ? (
        <section className="mt-10">
          <h2 className="text-sm font-medium text-muted-foreground">Storage</h2>
          <div className="mt-3">
            <InstanceStorage instanceId={row.id} />
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">Logs</h2>
        <div className="mt-3">
          <InstanceLogs instanceId={row.id} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">Events</h2>
        <div className="mt-3">
          <InstanceEvents instanceId={row.id} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">Audit log</h2>
        {auditRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No audit entries yet.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Transition</th>
                  <th className="px-4 py-2 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditRows.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {fmt(a.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-xs">{a.actorEmail ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {a.previousStatus ?? "—"} → {a.newStatus ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {a.metadata ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
