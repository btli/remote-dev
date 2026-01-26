"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Fingerprint,
  Plus,
  ChevronLeft,
  GitBranch,
  KeyRound,
  Server,
  Loader2,
  Settings2,
} from "lucide-react";
import { useProfileContext } from "@/contexts/ProfileContext";
import { ProfileCard } from "./ProfileCard";
import { ProfileForm } from "./ProfileForm";
import { ProfileGitIdentityTab } from "./ProfileGitIdentityTab";
import { ProfileSecretsTab } from "./ProfileSecretsTab";
import { ProfileMcpServersTab } from "./ProfileMcpServersTab";
import { ProfileConfigTab } from "./ProfileConfigTab";
import type { AgentProfile, CreateAgentProfileInput, UpdateAgentProfileInput } from "@/types/agent";

interface ProfilesModalProps {
  open: boolean;
  onClose: () => void;
  initialProfileId?: string | null;
}

type ConfigTab = "general" | "config" | "git" | "secrets" | "mcp";

export function ProfilesModal({
  open,
  onClose,
  initialProfileId,
}: ProfilesModalProps) {
  const {
    profiles,
    folderProfileLinks,
    loading,
    createProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
  } = useProfileContext();

  // Two-phase view: profile list OR profile config
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    initialProfileId || null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>("general");
  const [deleteConfirm, setDeleteConfirm] = useState<AgentProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Determine which view to show
  const showProfileList = !selectedProfileId && !isCreating;

  // Get selected profile
  const selectedProfile = useMemo(() => {
    if (!selectedProfileId) return null;
    return profiles.find((p) => p.id === selectedProfileId) || null;
  }, [profiles, selectedProfileId]);

  // Count linked folders per profile
  const linkedFolderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [, profileId] of folderProfileLinks) {
      counts[profileId] = (counts[profileId] || 0) + 1;
    }
    return counts;
  }, [folderProfileLinks]);

  // Handle profile selection
  const handleSelectProfile = useCallback((profileId: string) => {
    setSelectedProfileId(profileId);
    setIsCreating(false);
    setActiveConfigTab("general");
  }, []);

  // Handle back to profile list
  const handleBackToProfiles = useCallback(() => {
    setSelectedProfileId(null);
    setIsCreating(false);
  }, []);

  // Handle create new profile
  const handleCreateNew = useCallback(() => {
    setSelectedProfileId(null);
    setIsCreating(true);
    setActiveConfigTab("general");
  }, []);

  // Handle form submit
  const handleFormSubmit = useCallback(
    async (input: CreateAgentProfileInput | UpdateAgentProfileInput) => {
      if (isCreating) {
        const created = await createProfile(input as CreateAgentProfileInput);
        setSelectedProfileId(created.id);
        setIsCreating(false);
      } else if (selectedProfileId) {
        await updateProfile(selectedProfileId, input as UpdateAgentProfileInput);
      }
    },
    [isCreating, selectedProfileId, createProfile, updateProfile]
  );

  // Handle form cancel (when creating)
  const handleFormCancel = useCallback(() => {
    setIsCreating(false);
    setSelectedProfileId(null);
  }, []);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await deleteProfile(deleteConfirm.id);
      if (selectedProfileId === deleteConfirm.id) {
        setSelectedProfileId(null);
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, deleteProfile, selectedProfileId]);

  // Handle set default
  const handleSetDefault = useCallback(
    async (profileId: string) => {
      await setDefaultProfile(profileId);
    },
    [setDefaultProfile]
  );

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setSelectedProfileId(initialProfileId || null);
    setIsCreating(false);
    setActiveConfigTab("general");
    onClose();
  }, [initialProfileId, onClose]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Fingerprint className="w-5 h-5 text-primary" />
              {showProfileList ? "Agent Profiles" : (
                <>
                  <span className="text-muted-foreground">Agent Profiles</span>
                  <span className="text-muted-foreground">/</span>
                  <span>{isCreating ? "New Profile" : selectedProfile?.name}</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {showProfileList
                ? "Manage isolated configurations for AI coding agents"
                : isCreating
                  ? "Create a new agent profile"
                  : "Configure profile settings"
              }
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : showProfileList ? (
            /* Profile List View */
            <div className="flex-1 flex flex-col min-h-0">
              {profiles.length === 0 ? (
                /* Empty state with prominent Create button */
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <Fingerprint className="w-16 h-16 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No profiles yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 text-center max-w-[300px]">
                    Create a profile to isolate agent configurations, git identities, and secrets
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
                /* Profile list */
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
                  <ScrollArea className="flex-1">
                    <div className="space-y-2 pr-4">
                      {profiles.map((profile) => (
                        <ProfileCard
                          key={profile.id}
                          profile={profile}
                          linkedFolderCount={linkedFolderCounts[profile.id] || 0}
                          isSelected={false}
                          onSelect={() => handleSelectProfile(profile.id)}
                          onEdit={() => handleSelectProfile(profile.id)}
                          onDelete={() => setDeleteConfirm(profile)}
                          onSetDefault={() => handleSetDefault(profile.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          ) : (
            /* Profile Config View */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Back button */}
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
                value={activeConfigTab}
                onValueChange={(v) => setActiveConfigTab(v as ConfigTab)}
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
                    <ScrollArea className="h-full pr-4">
                      <ProfileForm
                        profile={isCreating ? null : selectedProfile}
                        onSubmit={handleFormSubmit}
                        onCancel={isCreating ? handleFormCancel : undefined}
                        isCreating={isCreating}
                      />
                    </ScrollArea>
                  </TabsContent>

                  {/* Config Tab - Agent-specific settings */}
                  <TabsContent value="config" className="h-full m-0 overflow-hidden min-h-0">
                    {selectedProfileId && selectedProfile && (
                      <ProfileConfigTab
                        profileId={selectedProfileId}
                        provider={selectedProfile.provider}
                      />
                    )}
                  </TabsContent>

                  {/* Git Identity Tab */}
                  <TabsContent value="git" className="h-full m-0">
                    <ScrollArea className="h-full pr-4">
                      {selectedProfileId && (
                        <ProfileGitIdentityTab profileId={selectedProfileId} />
                      )}
                    </ScrollArea>
                  </TabsContent>

                  {/* Secrets Tab */}
                  <TabsContent value="secrets" className="h-full m-0">
                    <ScrollArea className="h-full pr-4">
                      {selectedProfileId && (
                        <ProfileSecretsTab profileId={selectedProfileId} />
                      )}
                    </ScrollArea>
                  </TabsContent>

                  {/* MCP Servers Tab */}
                  <TabsContent value="mcp" className="h-full m-0">
                    <ScrollArea className="h-full pr-4">
                      {selectedProfileId && (
                        <ProfileMcpServersTab profileId={selectedProfileId} />
                      )}
                    </ScrollArea>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-popover/95 backdrop-blur-xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Profile</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete <span className="text-foreground font-medium">{deleteConfirm?.name}</span>?
              This will unlink all folders using this profile.
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
