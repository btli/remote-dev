export const dynamic = "force-dynamic";

/**
 * /m/session/[id] — terminal-only session view for the native Flutter
 * shell's WebView host.
 *
 * Auth: resolved via getAuthSession() (NextAuth credentials OR CF
 * Access JWT). Unauthenticated requests are redirected to /login by
 * src/middleware.ts before they reach this page.
 *
 * Session: loaded from DB by id; 404 if not found or not owned by the
 * current user.
 *
 * Providers: AppearanceProvider is mounted here because Terminal.tsx
 * (rendered inside EmbeddedSessionView via TerminalWithKeyboard) calls
 * useTerminalTheme()/useAppearance(). The desktop AppShell normally
 * mounts AppearanceProvider, but the /m/* layout deliberately excludes
 * AppShell to keep the embed bundle minimal — so the provider lives
 * here, scoped to this route.
 *
 * No SessionContext / ProjectTree / Preferences are mounted — the
 * embed surface only needs the session row + WS URL.
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { getAuthSession } from "@/lib/auth-utils";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { EmbeddedSessionView } from "@/components/mobile/embed/EmbeddedSessionView";
import { resolveTerminalWsUrlFromHostHeader } from "@/hooks/useTerminalWsUrl";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileSessionPage({ params }: PageProps) {
  const { id } = await params;
  const auth = await getAuthSession();
  if (!auth?.user?.id) {
    redirect("/login");
  }

  const row = await db.query.terminalSessions.findFirst({
    where: and(eq(terminalSessions.id, id), eq(terminalSessions.userId, auth.user.id)),
  });
  if (!row) notFound();

  // Resolve WS URL from the request host so the WebView talks back to
  // the same Remote Dev origin it loaded the page from. Uses the shared
  // resolver so the mobile WebView and the desktop client agree on the
  // URL shape (notably `wss://host/ws` for Cloudflare-tunneled prod, not
  // a direct hit on the terminal-server port).
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  const wsUrl = resolveTerminalWsUrlFromHostHeader({ host, protocol });

  return (
    <AppearanceProvider>
      <EmbeddedSessionView
        session={{
          id: row.id,
          name: row.name,
          tmuxSessionName: row.tmuxSessionName,
          status: row.status as "active" | "suspended" | "closed",
        }}
        wsUrl={wsUrl}
      />
    </AppearanceProvider>
  );
}
