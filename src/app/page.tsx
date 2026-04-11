export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { terminalSessions, accounts, sessionFolders, githubAccountMetadata } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { SessionProvider } from "@/contexts/SessionContext";
import { FolderProvider } from "@/contexts/FolderContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { TemplateProvider } from "@/contexts/TemplateContext";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { TrashProvider } from "@/contexts/TrashContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { SecretsProvider } from "@/contexts/SecretsContext";
import { LiteLLMProvider } from "@/contexts/LiteLLMContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { GitHubStatsProvider } from "@/contexts/GitHubStatsContext";
import { GitHubIssuesProvider } from "@/contexts/GitHubIssuesContext";
import { PortProvider } from "@/contexts/PortContext";
import { SessionMCPProvider } from "@/contexts/SessionMCPContext";
import { BeadsProvider } from "@/contexts/BeadsContext";
import { GitHubAccountProvider } from "@/contexts/GitHubAccountContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { PeerChatProvider } from "@/contexts/PeerChatContext";
import { ChannelProvider } from "@/contexts/ChannelContext";
import { SessionManager } from "@/components/session/SessionManager";
import { Header } from "@/components/header/Header";
import type { TerminalSession } from "@/types/session";

export default async function Home() {
  const session = await getAuthSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Fetch user's active and suspended sessions
  const dbSessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, session.user.id),
      inArray(terminalSessions.status, ["active", "suspended"])
    ),
    orderBy: (sessions, { asc }) => [asc(sessions.tabOrder)],
  });

  // Fetch user's folders
  const dbFolders = await db.query.sessionFolders.findMany({
    where: eq(sessionFolders.userId, session.user.id),
    orderBy: (folders, { asc }) => [asc(folders.sortOrder)],
  });

  // Build sessionFolders map (sessionId -> folderId) from sessions that have a folderId
  const sessionFoldersMap: Record<string, string> = {};
  for (const s of dbSessions) {
    if (s.folderId) {
      sessionFoldersMap[s.id] = s.folderId;
    }
  }

  // Map database folders to TypeScript type
  const initialFolders = dbFolders.map((f) => ({
    id: f.id,
    parentId: f.parentId ?? null,
    name: f.name,
    collapsed: f.collapsed ?? false,
    sortOrder: f.sortOrder ?? 0,
  }));

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
    folderId: s.folderId,
    profileId: s.profileId,
    terminalType: s.terminalType ?? "shell",
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
      <FolderProvider initialFolders={initialFolders} initialSessionFolders={sessionFoldersMap}>
        <SecretsProvider>
          <LiteLLMProvider>
          <ProfileProvider>
            <TemplateProvider>
              <RecordingProvider>
                <GitHubAccountProvider initialHasAccounts={initialHasGitHubAccounts}>
                <GitHubStatsProvider isGitHubConnected={isGitHubConnected}>
                  <GitHubIssuesProvider>
                    <SessionProvider initialSessions={initialSessions}>
                        <TrashProvider>
                          <PortProvider>
                            <ScheduleProvider>
                              <BeadsProvider>
                                <SessionMCPProvider>
                                  <NotificationProvider>
                                    <ChannelProvider>
                                    <PeerChatProvider>
                                    <div className="flex h-screen flex-col bg-background">
                                      {/* Header - hidden on mobile, shown in sidebar instead */}
                                      <Header
                                        isGitHubConnected={isGitHubConnected}
                                        userEmail={session.user.email || ""}
                                        onSignOut={async () => {
                                          "use server";
                                          await signOut();
                                        }}
                                      />
                                      {/* Main content */}
                                      <SessionManager isGitHubConnected={isGitHubConnected} />
                                    </div>
                                    </PeerChatProvider>
                                    </ChannelProvider>
                                  </NotificationProvider>
                                </SessionMCPProvider>
                              </BeadsProvider>
                            </ScheduleProvider>
                          </PortProvider>
                        </TrashProvider>
                    </SessionProvider>
                  </GitHubIssuesProvider>
                </GitHubStatsProvider>
                </GitHubAccountProvider>
              </RecordingProvider>
            </TemplateProvider>
          </ProfileProvider>
          </LiteLLMProvider>
        </SecretsProvider>
      </FolderProvider>
    </PreferencesProvider>
  );
}
