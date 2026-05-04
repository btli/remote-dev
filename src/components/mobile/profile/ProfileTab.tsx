"use client";

/**
 * ProfileTab — Phase 6 mobile redesign.
 *
 * The Profile tab is a pushed-row stack: an index of rows that each push
 * a sub-screen onto a tab-local navigation stack. There are no modals
 * for routine settings; sub-screens own the chrome and the back stack.
 *
 * Sign-out is the only flow that "fully works" in Phase 6 — it shows an
 * {@link ActionSheet}, not a dialog (per DESIGN.md: prefer sheets to
 * modal confirmations for routine actions). All other rows push stub
 * sub-screens that include a TODO pointing at the desktop component to
 * port.
 *
 * Composition (top to bottom):
 *
 *   1. Identity strip: signed-in-as line + GitHub badge.
 *   2. Section: Account, GitHub accounts.
 *   3. Section: Projects, Agent profiles.
 *   4. Section: Secrets, Ports, Trash.
 *   5. Section: Settings, About.
 *   6. Sign out (destructive, terminal row).
 *
 * Sections are separated by a small gap and a hairline; rows inside a
 * section are flush with hairline dividers.
 */

import { useCallback, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Boxes,
  CircleAlert,
  CircleUser,
  FolderTree,
  Github,
  Info,
  KeyRound,
  LogOut,
  Network,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ActionSheet, type ActionSheetItem } from "../common/ActionSheet";

import { ProfileRow } from "./ProfileRow";
import { useProfileNavStack } from "./useProfileNavStack";
import { AccountScreen } from "./screens/AccountScreen";
import { GithubAccountsScreen } from "./screens/GithubAccountsScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { AgentProfilesScreen } from "./screens/AgentProfilesScreen";
import { SecretsScreen } from "./screens/SecretsScreen";
import { PortsScreen } from "./screens/PortsScreen";
import { TrashScreen } from "./screens/TrashScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { AboutScreen } from "./screens/AboutScreen";

export type ProfileScreen =
  | "account"
  | "github"
  | "projects"
  | "agent-profiles"
  | "secrets"
  | "ports"
  | "trash"
  | "settings"
  | "about";

export interface ProfileTabProps {
  email: string | null | undefined;
  displayName: string | null | undefined;
  isGitHubConnected: boolean;
  /** Optional override (test seam). Defaults to NextAuth's signOut(). */
  signOut?: () => Promise<void> | void;
  /** Optional override (test seam). Defaults to redirecting to the link route. */
  onConnectGitHub?: () => void;
  className?: string;
}

const DEFAULT_GITHUB_LINK_HREF = "/api/auth/github/link";

export function ProfileTab({
  email,
  displayName,
  isGitHubConnected,
  signOut: signOutOverride,
  onConnectGitHub,
  className,
}: ProfileTabProps) {
  const nav = useProfileNavStack<ProfileScreen>();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const handleConnectGitHub = useCallback(() => {
    if (onConnectGitHub) {
      onConnectGitHub();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.href = DEFAULT_GITHUB_LINK_HREF;
    }
  }, [onConnectGitHub]);

  const handleSignOutConfirm = useCallback(async () => {
    if (signOutOverride) {
      await signOutOverride();
      return;
    }
    // NextAuth's client `signOut` redirects to the post-logout URL. We
    // explicitly send the user back to /login so the CF Access cookie
    // (if any) can re-issue cleanly on the next visit.
    await signOut({ callbackUrl: "/login" });
  }, [signOutOverride]);

  const signOutItems: ActionSheetItem[] = [
    {
      id: "confirm-sign-out",
      label: "Sign out",
      destructive: true,
      onSelect: handleSignOutConfirm,
    },
  ];

  // When the user has pushed a screen, render that instead of the index.
  // We keep mount/unmount semantics simple: each screen is a fresh
  // component tree, no animation between them in Phase 6. Phase 7 may
  // add a slide transition; gesture-back is owned by the platform.
  if (nav.current !== null) {
    return (
      <div
        data-testid="mobile-profile-tab"
        data-screen={nav.current}
        className={cn("flex h-full w-full flex-col", className)}
      >
        {nav.current === "account" ? (
          <AccountScreen email={email} displayName={displayName} onBack={nav.pop} />
        ) : null}
        {nav.current === "github" ? (
          <GithubAccountsScreen onBack={nav.pop} onAddAccount={handleConnectGitHub} />
        ) : null}
        {nav.current === "projects" ? <ProjectsScreen onBack={nav.pop} /> : null}
        {nav.current === "agent-profiles" ? (
          <AgentProfilesScreen onBack={nav.pop} />
        ) : null}
        {nav.current === "secrets" ? <SecretsScreen onBack={nav.pop} /> : null}
        {nav.current === "ports" ? <PortsScreen onBack={nav.pop} /> : null}
        {nav.current === "trash" ? <TrashScreen onBack={nav.pop} /> : null}
        {nav.current === "settings" ? <SettingsScreen onBack={nav.pop} /> : null}
        {nav.current === "about" ? <AboutScreen onBack={nav.pop} /> : null}
      </div>
    );
  }

  // Index.
  return (
    <div
      data-testid="mobile-profile-tab"
      data-screen="index"
      className={cn("flex h-full w-full flex-col", className)}
    >
      <header className="flex flex-col gap-1 px-4 py-4">
        <p className="text-[20px] font-semibold leading-tight tracking-tight text-foreground">
          Profile
        </p>
        {email ? (
          <p
            data-testid="mobile-profile-signed-in-as"
            className="text-[13px] leading-snug text-muted-foreground"
          >
            Signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        ) : null}
      </header>

      <Section>
        <ProfileRow
          rowId="account"
          icon={CircleUser}
          label="Account"
          onPress={() => nav.push("account")}
        />
        <Divider />
        <ProfileRow
          rowId="github"
          icon={Github}
          label="GitHub accounts"
          value={isGitHubConnected ? "Connected" : "Not connected"}
          onPress={() => nav.push("github")}
        />
      </Section>

      <Section>
        <ProfileRow
          rowId="projects"
          icon={FolderTree}
          label="Projects"
          onPress={() => nav.push("projects")}
        />
        <Divider />
        <ProfileRow
          rowId="agent-profiles"
          icon={Sparkles}
          label="Agent profiles"
          onPress={() => nav.push("agent-profiles")}
        />
      </Section>

      <Section>
        <ProfileRow
          rowId="secrets"
          icon={KeyRound}
          label="Secrets"
          onPress={() => nav.push("secrets")}
        />
        <Divider />
        <ProfileRow
          rowId="ports"
          icon={Network}
          label="Ports"
          onPress={() => nav.push("ports")}
        />
        <Divider />
        <ProfileRow
          rowId="trash"
          icon={Trash2}
          label="Trash"
          onPress={() => nav.push("trash")}
        />
      </Section>

      <Section>
        <ProfileRow
          rowId="settings"
          icon={Settings}
          label="Settings"
          onPress={() => nav.push("settings")}
        />
        <Divider />
        <ProfileRow
          rowId="about"
          icon={Info}
          label="About"
          onPress={() => nav.push("about")}
        />
      </Section>

      <Section>
        <ProfileRow
          rowId="sign-out"
          icon={LogOut}
          label="Sign out"
          destructive
          hideChevron
          onPress={() => setSignOutOpen(true)}
        />
      </Section>

      <ActionSheet
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out of Remote Dev?"
        subtitle={email ? `${email}` : undefined}
        items={signOutItems}
      />

      {/* Aria-hidden visual sentinel that hands off to the page padding. */}
      <div aria-hidden="true" className="flex-1" />
      <Footnote />
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      role="group"
      className={cn(
        "mt-4 border-y border-border bg-card",
        // Section visually separates from the page; never wraps in a card
        // per DESIGN.md ("Don't wrap every list row in a card").
      )}
    >
      {children}
    </section>
  );
}

function Divider() {
  return <div role="separator" aria-hidden="true" className="ml-12 border-t border-border" />;
}

function Footnote() {
  return (
    <div className="px-4 py-4 text-center">
      <p
        aria-hidden="true"
        className="inline-flex items-center gap-1 text-[11px] leading-snug text-muted-foreground/70"
      >
        <CircleAlert className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
        <span>Some screens are stubbed in this build.</span>
        <Boxes className="hidden" aria-hidden="true" />
      </p>
    </div>
  );
}
