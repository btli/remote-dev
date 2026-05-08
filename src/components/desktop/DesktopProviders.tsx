"use client";

/**
 * DesktopProviders — wraps the desktop-only React context providers.
 *
 * Lives inside the dynamically imported `DesktopApp` chunk so a mobile
 * viewport never downloads any of these providers' module graphs (or
 * runs their `useEffect` mount-time initialization, which fires
 * WebSockets, polls, and other side effects). See
 * {@link MobileViewportSwitch} for the code-split boundary.
 *
 * **Mobile-core providers** (Preferences, ProjectTree, Session, Channel,
 * Notification, PeerChat) stay in `app/page.tsx` so they wrap *both*
 * branches.
 *
 * `ProfileProvider` + `TemplateProvider` are also desktop-only at the
 * top level: mobile mounts them on demand inside its `NewSessionSheet`
 * (which is itself `dynamic(ssr: false)`), so the wizard's two
 * dependencies don't hydrate with mobile's initial bundle.
 *
 * Server-fetched bootstrap data (`isGitHubConnected`,
 * `initialHasGitHubAccounts`) is forwarded from `app/page.tsx` through
 * `DesktopApp` props and threaded into the GitHub-related providers so
 * the SSR HTML for desktop renders identically to before this split.
 */

import type { ReactNode } from "react";

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

export interface DesktopProvidersProps {
  children: ReactNode;
  isGitHubConnected: boolean;
  initialHasGitHubAccounts: boolean;
}

export function DesktopProviders({
  children,
  isGitHubConnected,
  initialHasGitHubAccounts,
}: DesktopProvidersProps) {
  return (
    <SecretsProvider>
      <LiteLLMProvider>
        <ProfileProvider>
          <TemplateProvider>
            <RecordingProvider>
              <GitHubAccountProvider initialHasAccounts={initialHasGitHubAccounts}>
                <GitHubStatsProvider isGitHubConnected={isGitHubConnected}>
                  <GitHubIssuesProvider>
                    <TrashProvider>
                      <PortProvider>
                        <ScheduleProvider>
                          <BeadsProvider>
                            <SessionMCPProvider>
                              {children}
                            </SessionMCPProvider>
                          </BeadsProvider>
                        </ScheduleProvider>
                      </PortProvider>
                    </TrashProvider>
                  </GitHubIssuesProvider>
                </GitHubStatsProvider>
              </GitHubAccountProvider>
            </RecordingProvider>
          </TemplateProvider>
        </ProfileProvider>
      </LiteLLMProvider>
    </SecretsProvider>
  );
}
