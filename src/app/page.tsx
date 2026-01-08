import { signOut } from "@/auth";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { terminalSessions, accounts } from "@/db/schema";
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
import { OrchestratorProvider } from "@/contexts/OrchestratorContext";
import { ErrorBoundary } from "@/components/ui/error-boundary";
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
    agentProvider: s.agentProvider as "claude" | "codex" | "gemini" | "opencode" | "none" | null,
    isOrchestratorSession: s.isOrchestratorSession,
    splitGroupId: s.splitGroupId,
    splitOrder: s.splitOrder,
    splitSize: s.splitSize ?? 0.5,
    status: s.status as "active" | "suspended" | "closed",
    tabOrder: s.tabOrder,
    lastActivityAt: new Date(s.lastActivityAt),
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));

  return (
    <PreferencesProvider>
      <FolderProvider>
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
                          <ErrorBoundary name="OrchestratorProvider">
                            <OrchestratorProvider>
                          <div className="flex h-screen flex-col bg-background">
                          {/* Header with glassmorphism - hidden on mobile, shown in sidebar instead */}
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
                            </OrchestratorProvider>
                          </ErrorBoundary>
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
