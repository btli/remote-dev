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
import { GitHubStatsProvider } from "@/contexts/GitHubStatsContext";
import { SessionManager } from "@/components/session/SessionManager";
import { GitHubStatusIcon } from "@/components/header/GitHubStatusIcon";
import { SecretsStatusButton } from "@/components/header/SecretsStatusButton";
import { HeaderUserMenu } from "@/components/header/HeaderUserMenu";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import Image from "next/image";
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
          <TemplateProvider>
            <RecordingProvider>
              <GitHubStatsProvider isGitHubConnected={isGitHubConnected}>
                <SessionProvider initialSessions={initialSessions}>
                  <SplitProvider>
                    <TrashProvider>
                      <ScheduleProvider>
                        <div className="flex h-screen flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                          {/* Header with glassmorphism - hidden on mobile, shown in sidebar instead */}
                          <header className="hidden md:flex items-center justify-between px-4 py-2 border-b border-white/5 bg-slate-900/30 backdrop-blur-sm">
                            {/* Logo */}
                            <div className="flex items-center gap-3">
                              <Image
                                src="/favicon.svg"
                                alt="Remote Dev"
                                width={32}
                                height={32}
                                className="rounded-lg"
                              />
                              <h1 className="text-lg font-semibold text-white">Remote Dev</h1>
                            </div>

                            {/* User info and actions */}
                            <div className="flex items-center gap-4">
                              {/* Connection status icons */}
                              <div className="flex items-center gap-3 pr-2 border-r border-white/10">
                                <GitHubStatusIcon isConnected={isGitHubConnected} />
                                <SecretsStatusButton />
                              </div>

                              {/* User settings */}
                              <HeaderUserMenu email={session.user.email || ""} />

                              {/* Sign out */}
                              <form
                                action={async () => {
                                  "use server";
                                  await signOut();
                                }}
                              >
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  type="submit"
                                  className="text-slate-400 hover:text-white"
                                >
                                  <LogOut className="w-4 h-4 mr-2" />
                                  Sign out
                                </Button>
                              </form>
                            </div>
                          </header>

                          {/* Main content */}
                          <SessionManager isGitHubConnected={isGitHubConnected} />
                        </div>
                      </ScheduleProvider>
                    </TrashProvider>
                  </SplitProvider>
                </SessionProvider>
              </GitHubStatsProvider>
            </RecordingProvider>
          </TemplateProvider>
        </SecretsProvider>
      </FolderProvider>
    </PreferencesProvider>
  );
}
