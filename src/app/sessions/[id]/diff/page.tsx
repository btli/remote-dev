export const dynamic = "force-dynamic";

/**
 * /sessions/[id]/diff — [n6uc.6] in-app worktree diff/review viewer.
 *
 * Route-level auth comes from `src/proxy.ts` (gates everything except
 * /login + /api). We additionally verify the caller OWNS this session here and
 * redirect home otherwise, so a stray id can't render a shell for someone
 * else's session. The actual diff is fetched client-side from the
 * ownership-checked `/api/sessions/:id/diff` endpoint.
 */

import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import { prefixPath } from "@/lib/base-path";
import { SessionDiffViewer } from "@/components/session/diff/SessionDiffViewer";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionDiffPage({ params }: PageProps) {
  const { id } = await params;
  const auth = await getAuthSession();
  if (!auth?.user?.id) {
    redirect(prefixPath("/login"));
  }
  const session = await SessionService.getSession(id, auth.user.id);
  if (!session) {
    redirect(prefixPath("/"));
  }

  return (
    <main className="h-screen overflow-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 text-sm">
        <span className="font-medium">Worktree diff</span>
        <span className="truncate text-muted-foreground">{session.name}</span>
      </header>
      <SessionDiffViewer sessionId={id} />
    </main>
  );
}
