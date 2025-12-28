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
  User,
  GitBranch,
  KeyRound,
  Server,
  Loader2,
} from "lucide-react";
import { useProfileContext } from "@/contexts/ProfileContext";
import { ProfileCard } from "./ProfileCard";
import { ProfileForm } from "./ProfileForm";
import { ProfileGitIdentityTab } from "./ProfileGitIdentityTab";
import { ProfileSecretsTab } from "./ProfileSecretsTab";
import { ProfileMcpServersTab } from "./ProfileMcpServersTab";
import type { AgentProfile, CreateAgentProfileInput, UpdateAgentProfileInput } from "@/types/agent";

interface ProfilesModalProps {
  open: boolean;
  onClose: () => void;
  initialProfileId?: string | null;
}

type TabValue = "overview" | "general" | "git" | "secrets" | "mcp";

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

  const [activeTab, setActiveTab] = useState<TabValue>("overview");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    initialProfileId || null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AgentProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setActiveTab("general");
  }, []);

  // Handle create new profile
  const handleCreateNew = useCallback(() => {
    setSelectedProfileId(null);
    setIsCreating(true);
    setActiveTab("general");
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

  // Handle form cancel
  const handleFormCancel = useCallback(() => {
    setIsCreating(false);
    if (!selectedProfileId && profiles.length > 0) {
      setActiveTab("overview");
    }
  }, [selectedProfileId, profiles.length]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await deleteProfile(deleteConfirm.id);
      if (selectedProfileId === deleteConfirm.id) {
        setSelectedProfileId(null);
        setActiveTab("overview");
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
    setActiveTab("overview");
    setSelectedProfileId(initialProfileId || null);
    setIsCreating(false);
    onClose();
  }, [initialProfileId, onClose]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Fingerprint className="w-5 h-5 text-primary" />
              Agent Profiles
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Manage isolated configurations for AI coding agents
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabValue)}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="w-full bg-muted/50 flex-shrink-0">
                <TabsTrigger
                  value="overview"
                  className="data-[state=active]:bg-primary/20"
                >
                  <User className="w-4 h-4 mr-2" />
                  Profiles
                </TabsTrigger>
                <TabsTrigger
                  value="general"
                  disabled={!selectedProfileId && !isCreating}
                  className="data-[state=active]:bg-primary/20"
                >
                  <Fingerprint className="w-4 h-4 mr-2" />
                  General
                </TabsTrigger>
                <TabsTrigger
                  value="git"
                  disabled={!selectedProfileId}
                  className="data-[state=active]:bg-primary/20"
                >
                  <GitBranch className="w-4 h-4 mr-2" />
                  Git
                </TabsTrigger>
                <TabsTrigger
                  value="secrets"
                  disabled={!selectedProfileId}
                  className="data-[state=active]:bg-primary/20"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Secrets
                </TabsTrigger>
                <TabsTrigger
                  value="mcp"
                  disabled={!selectedProfileId}
                  className="data-[state=active]:bg-primary/20"
                >
                  <Server className="w-4 h-4 mr-2" />
                  MCP
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0 mt-4">
                {/* Overview Tab */}
                <TabsContent value="overview" className="h-full m-0">
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3">
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
                      {profiles.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Fingerprint className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p className="text-xs">No profiles yet</p>
                          <p className="text-xs mt-1">
                            Create a profile to isolate agent configurations
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2 pr-4">
                          {profiles.map((profile) => (
                            <ProfileCard
                              key={profile.id}
                              profile={profile}
                              linkedFolderCount={linkedFolderCounts[profile.id] || 0}
                              isSelected={selectedProfileId === profile.id}
                              onSelect={() => handleSelectProfile(profile.id)}
                              onEdit={() => handleSelectProfile(profile.id)}
                              onDelete={() => setDeleteConfirm(profile)}
                              onSetDefault={() => handleSetDefault(profile.id)}
                            />
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </TabsContent>

                {/* General Tab */}
                <TabsContent value="general" className="h-full m-0">
                  <ScrollArea className="h-full pr-4">
                    <ProfileForm
                      profile={isCreating ? null : selectedProfile}
                      onSubmit={handleFormSubmit}
                      onCancel={handleFormCancel}
                      isCreating={isCreating}
                    />
                  </ScrollArea>
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
