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
 * Providers:
 *   - AppearanceProvider is mounted here because Terminal.tsx (rendered
 *     inside EmbeddedSessionView via TerminalWithKeyboard) calls
 *     useTerminalTheme()/useAppearance(). The desktop AppShell normally
 *     mounts AppearanceProvider, but the /m/* layout deliberately
 *     excludes AppShell to keep the embed bundle minimal — so the
 *     provider lives here, scoped to this route.
 *   - PreferencesProvider is mounted here so the embedded terminal
 *     respects the user's font size + font family. Without it, the /m
 *     bundle never fetches `/api/preferences` and the terminal renders
 *     at the xterm.js default (~15px) which is "too large" on a phone.
 *     Scoped to /m/session (NOT mounted in the /m layout) because
 *     /m/channel and /m/recording have their own provider stacks.
 *   - NotificationProvider is mounted here so foreground notification
 *     toasts surface in the embedded session view. EmbeddedSessionView's
 *     `onNotification` callback forwards terminal-server broadcasts
 *     (job done, agent waiting, peer message) into this context via
 *     `addNotification`, which fires the toast pipeline. Without this
 *     provider, the embed silently drops in-app notifications even
 *     though the desktop/PWA path surfaces them.
 *
 * No SessionContext / ProjectTree are mounted — the embed surface only
 * needs the session row + WS URL + user prefs.
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { getAuthSession } from "@/lib/auth-utils";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { EmbeddedSessionView } from "@/components/mobile/embed/EmbeddedSessionView";
import { resolveTerminalWsUrlFromHeaders } from "@/lib/terminal-ws-url";
import { BASE_PATH } from "@/lib/base-path";

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

  // Resolve WS URL so the WebView talks back to the same Remote Dev origin
  // it loaded the page from. Uses the shared resolver so the mobile WebView
  // and the desktop client agree on the URL shape (notably
  // `wss://host{basePath}/ws` for Cloudflare-tunneled prod, not a direct hit
  // on the terminal-server port).
  //
  // basePath: server-side, the resolver has no `window.__RDV_BASE_PATH__`
  // to read from, so we pass the validated BASE_PATH constant explicitly.
  // Without this, multi-instance deployments under `/alpha` would point
  // the embed WebSocket at `/ws` and be rejected by the upgrade gate.
  //
  // Behind the supervisor-router the inbound `Host` is the INTERNAL upstream
  // (`rdv.<ns>.svc.cluster.local:6001`); derive the WS URL from the
  // edge-forwarded host (same precedence as the proxy) so the WebView connects
  // back to the public origin (e.g. wss://rdv.joyful.house/<slug>/ws).
  const h = await headers();
  const wsUrl = resolveTerminalWsUrlFromHeaders((name) => h.get(name), BASE_PATH);

  // Provider order mirrors `src/app/page.tsx` and `/m/channel/[id]`:
  // PreferencesProvider is the outermost context-bearing wrapper; the
  // theme provider sits inside it. NotificationProvider lives inside
  // both so the toast pipeline can read the active preferences and
  // theme. All three are no-op on the server (they fetch on mount), so
  // this order is a presentation detail rather than a correctness
  // constraint.
  return (
    <PreferencesProvider>
      <AppearanceProvider>
        <NotificationProvider>
          <EmbeddedSessionView
            session={{
              id: row.id,
              name: row.name,
              tmuxSessionName: row.tmuxSessionName,
              status: row.status as "active" | "suspended" | "closed",
              terminalType: row.terminalType ?? "shell",
              projectPath: row.projectPath ?? null,
              worktreeBranch: row.worktreeBranch ?? null,
              githubRepoId: row.githubRepoId ?? null,
            }}
            wsUrl={wsUrl}
          />
        </NotificationProvider>
      </AppearanceProvider>
    </PreferencesProvider>
  );
}
