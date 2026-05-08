export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { terminalSessions, accounts, githubAccountMetadata } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { SessionProvider } from "@/contexts/SessionContext";
import { ProjectTreeProvider } from "@/contexts/ProjectTreeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { PeerChatProvider } from "@/contexts/PeerChatContext";
import { ChannelProvider } from "@/contexts/ChannelContext";
import { MobileViewportSwitch } from "@/components/mobile/MobileViewportSwitch";
import type { TerminalSession } from "@/types/session";

// NOTE (c9aq): Desktop-only context providers (Template, Recording,
// Trash, Schedule, Secrets, LiteLLM, Profile, GitHubAccount, GitHubStats,
// GitHubIssues, Port, SessionMCP, Beads) used to be imported and wrapped
// here. They've moved into `DesktopProviders` (loaded with the dynamic
// `DesktopApp` chunk) so a mobile viewport never downloads their
// dependency graphs or runs their mount-time side effects (WebSocket
// connects, polls, etc.).
//
// `ProfileProvider` + `TemplateProvider` are mounted inside the mobile
// `NewSessionSheet` (which is itself `dynamic(ssr: false)`), so on
// mobile they only hydrate when the user opens the New Session wizard.

// Quick UA-based mobile hint for SSR. Used as the *initial* branch
// pick for `MobileViewportSwitch` so the server pre-renders only the
// composition the client is most likely to mount, eliminating the
// "load skeleton, then load real chunk" round-trip on first paint.
// `useSyncExternalStore` corrects any miss on the client.
function detectMobileUA(ua: string): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export default async function Home() {
  const session = await getAuthSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const requestHeaders = await headers();
  const initialIsMobile = detectMobileUA(requestHeaders.get("user-agent") ?? "");

  // Fetch user's active and suspended sessions
  const dbSessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, session.user.id),
      inArray(terminalSessions.status, ["active", "suspended"])
    ),
    orderBy: (sessions, { asc }) => [asc(sessions.tabOrder)],
  });

  // Check if GitHub is connected (any OAuth account or metadata entries)
  const githubAccount = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.userId, session.user.id),
      eq(accounts.provider, "github")
    ),
  });
  const isGitHubConnected = !!githubAccount;

  // Check if user has GitHub account metadata (for multi-account context)
  const hasGitHubAccounts = await db.query.githubAccountMetadata.findFirst({
    where: eq(githubAccountMetadata.userId, session.user.id),
    columns: { providerAccountId: true },
  });
  const initialHasGitHubAccounts = !!hasGitHubAccounts;

  // Map database sessions to TypeScript type
  const initialSessions: TerminalSession[] = dbSessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    name: s.name,
    tmuxSessionName: s.tmuxSessionName,
    projectPath: s.projectPath,
    githubRepoId: s.githubRepoId,
    worktreeBranch: s.worktreeBranch,
    worktreeType: s.worktreeType ?? null,
    projectId: s.projectId ?? null,
    profileId: s.profileId,
    terminalType: s.terminalType ?? "shell",
    scopeKey: s.scopeKey ?? null,
    agentProvider: s.agentProvider as "claude" | "codex" | "gemini" | "opencode" | "none" | null,
    agentExitState: s.agentExitState as "running" | "exited" | "restarting" | "closed" | null,
    agentExitCode: s.agentExitCode ?? null,
    agentExitedAt: s.agentExitedAt ? new Date(s.agentExitedAt) : null,
    agentRestartCount: s.agentRestartCount ?? 0,
    agentActivityStatus: s.agentActivityStatus ?? null,
    typeMetadata: s.typeMetadata ? JSON.parse(s.typeMetadata) : null,
    parentSessionId: s.parentSessionId ?? null,
    status: s.status as "active" | "suspended" | "closed" | "trashed",
    pinned: s.pinned ?? false,
    tabOrder: s.tabOrder,
    lastActivityAt: new Date(s.lastActivityAt),
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));

  return (
    <PreferencesProvider>
      <ProjectTreeProvider>
        <SessionProvider initialSessions={initialSessions}>
          <NotificationProvider>
            <ChannelProvider>
              <PeerChatProvider>
                <MobileViewportSwitch
                  initialIsMobile={initialIsMobile}
                  isGitHubConnected={isGitHubConnected}
                  initialHasGitHubAccounts={initialHasGitHubAccounts}
                  initialUser={{
                    email: session.user.email ?? null,
                    name: session.user.name ?? null,
                  }}
                  userEmail={session.user.email || ""}
                  onSignOut={async () => {
                    "use server";
                    await signOut();
                  }}
                />
              </PeerChatProvider>
            </ChannelProvider>
          </NotificationProvider>
        </SessionProvider>
      </ProjectTreeProvider>
    </PreferencesProvider>
  );
}
