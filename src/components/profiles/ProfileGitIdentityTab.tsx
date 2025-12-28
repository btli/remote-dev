"use client";

import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw, GitBranch, Mail, Key, User, Github } from "lucide-react";
import { PathInput } from "@/components/common/PathInput";
import { useProfileContext } from "@/contexts/ProfileContext";
import type { GitIdentity } from "@/types/agent";

interface ProfileGitIdentityTabProps {
  profileId: string;
}

export function ProfileGitIdentityTab({ profileId }: ProfileGitIdentityTabProps) {
  const { getGitIdentity, setGitIdentity } = useProfileContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [gpgKeyId, setGpgKeyId] = useState("");
  const [githubUsername, setGithubUsername] = useState("");

  // Original values for reset
  const [original, setOriginal] = useState<GitIdentity | null>(null);

  // Load identity on mount
  useEffect(() => {
    let mounted = true;

    const loadIdentity = async () => {
      setLoading(true);
      setError(null);

      try {
        const identity = await getGitIdentity(profileId);
        if (mounted) {
          if (identity) {
            setUserName(identity.userName || "");
            setUserEmail(identity.userEmail || "");
            setSshKeyPath(identity.sshKeyPath || "");
            setGpgKeyId(identity.gpgKeyId || "");
            setGithubUsername(identity.githubUsername || "");
            setOriginal(identity);
          } else {
            setUserName("");
            setUserEmail("");
            setSshKeyPath("");
            setGpgKeyId("");
            setGithubUsername("");
            setOriginal(null);
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load git identity");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadIdentity();

    return () => {
      mounted = false;
    };
  }, [profileId, getGitIdentity]);

  const handleSave = useCallback(async () => {
    if (!userName.trim() || !userEmail.trim()) {
      setError("Name and email are required");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await setGitIdentity(profileId, {
        userName: userName.trim(),
        userEmail: userEmail.trim(),
        sshKeyPath: sshKeyPath.trim() || undefined,
        gpgKeyId: gpgKeyId.trim() || undefined,
        githubUsername: githubUsername.trim() || undefined,
      });

      setOriginal({
        userName: userName.trim(),
        userEmail: userEmail.trim(),
        sshKeyPath: sshKeyPath.trim() || undefined,
        gpgKeyId: gpgKeyId.trim() || undefined,
        githubUsername: githubUsername.trim() || undefined,
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save git identity");
    } finally {
      setSaving(false);
    }
  }, [profileId, userName, userEmail, sshKeyPath, gpgKeyId, githubUsername, setGitIdentity]);

  const handleReset = useCallback(() => {
    if (original) {
      setUserName(original.userName || "");
      setUserEmail(original.userEmail || "");
      setSshKeyPath(original.sshKeyPath || "");
      setGpgKeyId(original.gpgKeyId || "");
      setGithubUsername(original.githubUsername || "");
    } else {
      setUserName("");
      setUserEmail("");
      setSshKeyPath("");
      setGpgKeyId("");
      setGithubUsername("");
    }
    setError(null);
  }, [original]);

  const hasChanges =
    userName !== (original?.userName || "") ||
    userEmail !== (original?.userEmail || "") ||
    sshKeyPath !== (original?.sshKeyPath || "") ||
    gpgKeyId !== (original?.gpgKeyId || "") ||
    githubUsername !== (original?.githubUsername || "");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground pb-2 border-b border-border">
        <GitBranch className="w-4 h-4" />
        <span>Configure Git identity for this profile</span>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="git-name" className="text-muted-foreground flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          User Name <span className="text-red-400">*</span>
        </Label>
        <Input
          id="git-name"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="John Doe"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="git-email" className="text-muted-foreground flex items-center gap-2">
          <Mail className="w-3.5 h-3.5" />
          Email <span className="text-red-400">*</span>
        </Label>
        <Input
          id="git-email"
          type="email"
          value={userEmail}
          onChange={(e) => setUserEmail(e.target.value)}
          placeholder="john@example.com"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
      </div>

      {/* SSH Key Path */}
      <div className="space-y-2">
        <Label htmlFor="git-ssh" className="text-muted-foreground flex items-center gap-2">
          <Key className="w-3.5 h-3.5" />
          SSH Key Path
        </Label>
        <PathInput
          id="git-ssh"
          value={sshKeyPath}
          onChange={setSshKeyPath}
          placeholder="~/.ssh/id_ed25519"
          mode="file"
          showHidden={true}
          browserTitle="Select SSH Private Key"
          browserDescription="Navigate to your .ssh directory and select a private key file"
          inputClassName="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
        <p className="text-xs text-muted-foreground/70">
          Path to SSH private key for Git operations
        </p>
      </div>

      {/* GPG Key ID */}
      <div className="space-y-2">
        <Label htmlFor="git-gpg" className="text-muted-foreground flex items-center gap-2">
          <Key className="w-3.5 h-3.5" />
          GPG Key ID
        </Label>
        <Input
          id="git-gpg"
          value={gpgKeyId}
          onChange={(e) => setGpgKeyId(e.target.value)}
          placeholder="ABCD1234EFGH5678"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
        <p className="text-xs text-muted-foreground/70">
          GPG key ID for signing commits
        </p>
      </div>

      {/* GitHub Username */}
      <div className="space-y-2">
        <Label htmlFor="git-github" className="text-muted-foreground flex items-center gap-2">
          <Github className="w-3.5 h-3.5" />
          GitHub Username
        </Label>
        <Input
          id="git-github"
          value={githubUsername}
          onChange={(e) => setGithubUsername(e.target.value)}
          placeholder="johndoe"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
      </div>

      {/* Error/Success messages */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          Git identity saved successfully
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          onClick={handleReset}
          disabled={saving || !hasChanges}
          className="text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Identity
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
