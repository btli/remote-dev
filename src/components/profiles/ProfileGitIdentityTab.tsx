"use client";

import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw, GitBranch, Mail, Key, User, Github } from "lucide-react";
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
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-400 pb-2 border-b border-white/5">
        <GitBranch className="w-4 h-4" />
        <span>Configure Git identity for this profile</span>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="git-name" className="text-slate-300 flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          User Name <span className="text-red-400">*</span>
        </Label>
        <Input
          id="git-name"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="John Doe"
          className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="git-email" className="text-slate-300 flex items-center gap-2">
          <Mail className="w-3.5 h-3.5" />
          Email <span className="text-red-400">*</span>
        </Label>
        <Input
          id="git-email"
          type="email"
          value={userEmail}
          onChange={(e) => setUserEmail(e.target.value)}
          placeholder="john@example.com"
          className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
        />
      </div>

      {/* SSH Key Path */}
      <div className="space-y-2">
        <Label htmlFor="git-ssh" className="text-slate-300 flex items-center gap-2">
          <Key className="w-3.5 h-3.5" />
          SSH Key Path
        </Label>
        <Input
          id="git-ssh"
          value={sshKeyPath}
          onChange={(e) => setSshKeyPath(e.target.value)}
          placeholder="~/.ssh/id_ed25519"
          className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
        />
        <p className="text-xs text-slate-500">
          Path to SSH private key for Git operations
        </p>
      </div>

      {/* GPG Key ID */}
      <div className="space-y-2">
        <Label htmlFor="git-gpg" className="text-slate-300 flex items-center gap-2">
          <Key className="w-3.5 h-3.5" />
          GPG Key ID
        </Label>
        <Input
          id="git-gpg"
          value={gpgKeyId}
          onChange={(e) => setGpgKeyId(e.target.value)}
          placeholder="ABCD1234EFGH5678"
          className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
        />
        <p className="text-xs text-slate-500">
          GPG key ID for signing commits
        </p>
      </div>

      {/* GitHub Username */}
      <div className="space-y-2">
        <Label htmlFor="git-github" className="text-slate-300 flex items-center gap-2">
          <Github className="w-3.5 h-3.5" />
          GitHub Username
        </Label>
        <Input
          id="git-github"
          value={githubUsername}
          onChange={(e) => setGithubUsername(e.target.value)}
          placeholder="johndoe"
          className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
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
          className="text-slate-400 hover:text-white"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="bg-violet-600 hover:bg-violet-700 text-white"
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
