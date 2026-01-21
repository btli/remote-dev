import { signOut } from "@/auth";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { terminalSessions, accounts, sessionFolders } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { SessionProvider } from "@/contexts/SessionContext";
import { FolderProvider } from "@/contexts/FolderContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SplitProvider } from "@/contexts/SplitContext";
import { TemplateProvider } from "@/contexts/TemplateContext";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { TrashProvider } from "@/contexts/TrashContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { SecretsProvider } from "@/contexts/SecretsContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { GitHubStatsProvider } from "@/contexts/GitHubStatsContext";
import { GitHubIssuesProvider } from "@/contexts/GitHubIssuesContext";
import { PortProvider } from "@/contexts/PortContext";
import { SessionManager } from "@/components/session/SessionManager";
import { Header } from "@/components/header/Header";
import type { TerminalSession } from "@/types/session";

export default async function Home() {
  const session = await getAuthSession();

  if (!session?.user?.id) {
    return null;
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

  // Check if GitHub is connected
  const githubAccount = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.userId, session.user.id),
      eq(accounts.provider, "github")
    ),
  });
  const isGitHubConnected = !!githubAccount;

  // Map database sessions to TypeScript type
  const initialSessions: TerminalSession[] = dbSessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    name: s.name,
    tmuxSessionName: s.tmuxSessionName,
    projectPath: s.projectPath,
    githubRepoId: s.githubRepoId,
    worktreeBranch: s.worktreeBranch,
    folderId: s.folderId,
    profileId: s.profileId,
    terminalType: s.terminalType ?? "shell",
    agentProvider: s.agentProvider as "claude" | "codex" | "gemini" | "opencode" | "none" | null,
    agentExitState: s.agentExitState as "running" | "exited" | "restarting" | "closed" | null,
    agentExitCode: s.agentExitCode ?? null,
    agentExitedAt: s.agentExitedAt ? new Date(s.agentExitedAt) : null,
    agentRestartCount: s.agentRestartCount ?? 0,
    typeMetadata: s.typeMetadata ? JSON.parse(s.typeMetadata) : null,
    splitGroupId: s.splitGroupId,
    splitOrder: s.splitOrder,
    splitSize: s.splitSize ?? 0.5,
    status: s.status as "active" | "suspended" | "closed" | "trashed",
    tabOrder: s.tabOrder,
    lastActivityAt: new Date(s.lastActivityAt),
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));

  return (
    <PreferencesProvider>
      <FolderProvider initialFolders={initialFolders} initialSessionFolders={sessionFoldersMap}>
        <SecretsProvider>
          <ProfileProvider>
            <TemplateProvider>
              <RecordingProvider>
                <GitHubStatsProvider isGitHubConnected={isGitHubConnected}>
                  <GitHubIssuesProvider>
                    <SessionProvider initialSessions={initialSessions}>
                      <SplitProvider>
                        <TrashProvider>
                          <PortProvider>
                            <ScheduleProvider>
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
                            </ScheduleProvider>
                          </PortProvider>
                        </TrashProvider>
                      </SplitProvider>
                    </SessionProvider>
                  </GitHubIssuesProvider>
                </GitHubStatsProvider>
              </RecordingProvider>
            </TemplateProvider>
          </ProfileProvider>
        </SecretsProvider>
      </FolderProvider>
    </PreferencesProvider>
  );
}
