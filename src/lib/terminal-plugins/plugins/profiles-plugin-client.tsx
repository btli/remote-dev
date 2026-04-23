/**
 * ProfilesPlugin (client half) — React rendering for the agent-profile
 * manager rendered as a terminal tab. Hosts a 3-level navigation structure
 * (profile list → profile config → 5 sub-tabs), with navigation state
 * persisted into `session.typeMetadata` so reloads / pane-swaps land on the
 * same view.
 *
 * The inner profile-form / config / git / secrets / MCP panels are the same
 * components the legacy `ProfilesModal` uses. This plugin owns only the
 * outer shell + navigation state.
 *
 * @see ./profiles-plugin-server.ts for lifecycle.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Fingerprint,
  Plus,
  ChevronLeft,
  GitBranch,
  KeyRound,
  Server,
  Loader2,
  Settings2,
  UserCog,
} from "lucide-react";

import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useProfileContext } from "@/contexts/ProfileContext";
import { useSessionContext } from "@/contexts/SessionContext";

import { ProfileCard } from "@/components/profiles/ProfileCard";
import { ProfileForm } from "@/components/profiles/ProfileForm";
import { ProfileConfigTab } from "@/components/profiles/ProfileConfigTab";
import { ProfileGitIdentityTab } from "@/components/profiles/ProfileGitIdentityTab";
import { ProfileSecretsTab } from "@/components/profiles/ProfileSecretsTab";
import { ProfileMcpServersTab } from "@/components/profiles/ProfileMcpServersTab";

import type {
  AgentProfile,
  CreateAgentProfileInput,
  UpdateAgentProfileInput,
} from "@/types/agent";
import type {
  ProfilesActiveTab,
  ProfilesSessionMetadata,
} from "./profiles-plugin-server";

const VALID_TABS: ReadonlySet<ProfilesActiveTab> = new Set([
  "general",
  "config",
  "git",
  "secrets",
  "mcp",
]);

function normalizeTab(value: unknown): ProfilesActiveTab {
  if (typeof value === "string" && VALID_TABS.has(value as ProfilesActiveTab)) {
    return value as ProfilesActiveTab;
  }
  return "general";
}

/**
 * Main component for `terminalType === "profiles"`.
 *
 * Navigation state (which profile is open, which sub-tab is active) lives
 * in `session.typeMetadata` and is patched via `updateSession` so a reload
 * restores the exact same view. Purely-ephemeral state (in-flight creates,
 * pending deletes) stays in local `useState`.
 */
function ProfilesTabContent({ session }: TerminalTypeClientComponentProps) {
  const {
    profiles,
    folderProfileLinks,
    loading,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
  } = useProfileContext();
  const { updateSession } = useSessionContext();

  const metadata = (session.typeMetadata ?? null) as ProfilesSessionMetadata | null;
  const activeProfileId = metadata?.activeProfileId ?? null;
  const activeTab = normalizeTab(metadata?.activeTab);

  // Purely-ephemeral UI state. Navigation state is persisted through
  // typeMetadata; these flags are not.
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AgentProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showProfileList = !activeProfileId && !isCreating;

  const selectedProfile = useMemo(() => {
    if (!activeProfileId) return null;
    return profiles.find((p) => p.id === activeProfileId) ?? null;
  }, [profiles, activeProfileId]);

  const linkedProjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [, profileId] of folderProfileLinks) {
      counts[profileId] = (counts[profileId] ?? 0) + 1;
    }
    return counts;
  }, [folderProfileLinks]);

  // --- navigation helpers --------------------------------------------------
  // Each helper patches metadata via `updateSession({ typeMetadataPatch })`.
  // activeProfileId and activeTab are independent keys in the patch so they
  // can be cleared/set individually (null in a patch deletes the key).

  const persistNav = useCallback(
    (
      patch: {
        activeProfileId?: string | null;
        activeTab?: ProfilesActiveTab | null;
      }
    ) => {
      updateSession(session.id, { typeMetadataPatch: patch }).catch(() => {
        // Swallow — session context already logs, and navigation is a
        // best-effort UX affordance.
      });
    },
    [session.id, updateSession]
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      setIsCreating(false);
      persistNav({ activeProfileId: profileId, activeTab: "general" });
    },
    [persistNav]
  );

  const handleBackToProfiles = useCallback(() => {
    setIsCreating(false);
    persistNav({ activeProfileId: null, activeTab: null });
  }, [persistNav]);

  const handleCreateNew = useCallback(() => {
    setIsCreating(true);
    persistNav({ activeProfileId: null, activeTab: "general" });
  }, [persistNav]);

  const handleActiveTabChange = useCallback(
    (value: string) => {
      persistNav({ activeTab: normalizeTab(value) });
    },
    [persistNav]
  );

  // --- mutation handlers ---------------------------------------------------

  const handleFormSubmit = useCallback(
    async (input: CreateAgentProfileInput | UpdateAgentProfileInput) => {
      if (isCreating) {
        const created = await createProfile(input as CreateAgentProfileInput);
        setIsCreating(false);
        persistNav({ activeProfileId: created.id, activeTab: "general" });
      } else if (activeProfileId) {
        await updateProfile(activeProfileId, input as UpdateAgentProfileInput);
      }
    },
    [isCreating, activeProfileId, createProfile, updateProfile, persistNav]
  );

  const handleFormCancel = useCallback(() => {
    setIsCreating(false);
    persistNav({ activeProfileId: null, activeTab: null });
  }, [persistNav]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await deleteProfile(deleteConfirm.id);
      if (activeProfileId === deleteConfirm.id) {
        persistNav({ activeProfileId: null, activeTab: null });
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, deleteProfile, activeProfileId, persistNav]);

  const handleSetDefault = useCallback(
    async (profileId: string) => {
      await setDefaultProfile(profileId);
    },
    [setDefaultProfile]
  );

  // --- render --------------------------------------------------------------

  return (
    <>
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
        {/* Header */}
        <div className="shrink-0 border-b border-border/50 px-6 py-4">
          <div className="flex items-center gap-2 text-foreground text-base font-semibold">
            <Fingerprint className="w-5 h-5 text-primary" />
            {showProfileList ? (
              "Agent Profiles"
            ) : (
              <>
                <span className="text-muted-foreground font-normal">
                  Agent Profiles
                </span>
                <span className="text-muted-foreground font-normal">/</span>
                <span>
                  {isCreating ? "New Profile" : (selectedProfile?.name ?? "Profile")}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {showProfileList
              ? "Manage isolated configurations for AI coding agents"
              : isCreating
                ? "Create a new agent profile"
                : "Configure profile settings"}
          </p>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : showProfileList ? (
          /* Profile list view */
          <div className="flex-1 flex flex-col min-h-0 px-6 py-4">
            {profiles.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12">
                <Fingerprint className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  No profiles yet
                </h3>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-[300px]">
                  Create a profile to isolate agent configurations, git
                  identities, and secrets
                </p>
                <Button
                  onClick={handleCreateNew}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Profile
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <p className="text-xs text-muted-foreground">
                    {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
                  </p>
                  <Button
                    size="sm"
                    onClick={handleCreateNew}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    New Profile
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                  <div className="space-y-2 pr-1 pb-2">
                    {profiles.map((profile) => (
                      <ProfileCard
                        key={profile.id}
                        profile={profile}
                        linkedProjectCount={
                          linkedProjectCounts[profile.id] ?? 0
                        }
                        isSelected={false}
                        onSelect={() => handleSelectProfile(profile.id)}
                        onEdit={() => handleSelectProfile(profile.id)}
                        onDelete={() => setDeleteConfirm(profile)}
                        onSetDefault={() => handleSetDefault(profile.id)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Profile config view */
          <div className="flex-1 flex flex-col min-h-0 px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToProfiles}
              className="self-start -ml-2 mb-2 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Profiles
            </Button>

            <Tabs
              value={activeTab}
              onValueChange={handleActiveTabChange}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="w-full bg-muted/50 shrink-0">
                <TabsTrigger
                  value="general"
                  className="data-[state=active]:bg-primary/20"
                >
                  <Fingerprint className="w-4 h-4 mr-2" />
                  General
                </TabsTrigger>
                <TabsTrigger
                  value="config"
                  disabled={isCreating}
                  className="data-[state=active]:bg-primary/20"
                >
                  <Settings2 className="w-4 h-4 mr-2" />
                  Config
                </TabsTrigger>
                <TabsTrigger
                  value="git"
                  disabled={isCreating}
                  className="data-[state=active]:bg-primary/20"
                >
                  <GitBranch className="w-4 h-4 mr-2" />
                  Git
                </TabsTrigger>
                <TabsTrigger
                  value="secrets"
                  disabled={isCreating}
                  className="data-[state=active]:bg-primary/20"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Secrets
                </TabsTrigger>
                <TabsTrigger
                  value="mcp"
                  disabled={isCreating}
                  className="data-[state=active]:bg-primary/20"
                >
                  <Server className="w-4 h-4 mr-2" />
                  MCP
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0 mt-4 overflow-hidden">
                {/* General Tab */}
                <TabsContent value="general" className="h-full m-0">
                  <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
                    <ProfileForm
                      profile={isCreating ? null : selectedProfile}
                      onSubmit={handleFormSubmit}
                      onCancel={isCreating ? handleFormCancel : undefined}
                      isCreating={isCreating}
                    />
                  </div>
                </TabsContent>

                {/* Config Tab */}
                <TabsContent
                  value="config"
                  className="h-full m-0 overflow-hidden min-h-0"
                >
                  {activeProfileId && selectedProfile && (
                    <ProfileConfigTab
                      profileId={activeProfileId}
                      provider={selectedProfile.provider}
                    />
                  )}
                </TabsContent>

                {/* Git Tab */}
                <TabsContent value="git" className="h-full m-0">
                  <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
                    {activeProfileId && (
                      <ProfileGitIdentityTab profileId={activeProfileId} />
                    )}
                  </div>
                </TabsContent>

                {/* Secrets Tab */}
                <TabsContent value="secrets" className="h-full m-0">
                  <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
                    {activeProfileId && (
                      <ProfileSecretsTab profileId={activeProfileId} />
                    )}
                  </div>
                </TabsContent>

                {/* MCP Tab */}
                <TabsContent value="mcp" className="h-full m-0">
                  <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
                    {activeProfileId && (
                      <ProfileMcpServersTab profileId={activeProfileId} />
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </div>

      {/* Delete confirmation — rendered outside the main flow so the alert
          dialog overlays the entire viewport. */}
      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <AlertDialogContent className="bg-popover/95 backdrop-blur-xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Delete Profile
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="text-foreground font-medium">
                {deleteConfirm?.name}
              </span>
              ? This will unlink all folders using this profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-transparent border-border text-muted-foreground hover:bg-accent"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Default profiles client plugin instance */
export const ProfilesClientPlugin: TerminalTypeClientPlugin = {
  type: "profiles",
  displayName: "Profiles",
  description: "Agent profile manager",
  icon: UserCog,
  priority: 80,
  builtIn: true,
  component: ProfilesTabContent,
  deriveTitle(session: TerminalSession): string | null {
    const md = session.typeMetadata as ProfilesSessionMetadata | null;
    return md?.activeProfileId ? "Profile config" : "Profiles";
  },
};
