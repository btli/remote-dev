"use client";

import { useState } from "react";
import { Folder, Github, Terminal, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RepositoryPicker } from "@/components/github/RepositoryPicker";
import { BranchPicker } from "@/components/github/BranchPicker";
import type { GitHubRepository, GitHubBranch } from "@/types/github";

interface NewSessionWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    projectPath?: string;
    githubRepoId?: string;
    worktreeBranch?: string;
  }) => Promise<void>;
  isGitHubConnected: boolean;
}

type WizardStep = "choose-type" | "simple-form" | "github-repo" | "github-branch" | "github-confirm";
type SessionType = "simple" | "github" | "folder";

export function NewSessionWizard({
  open,
  onClose,
  onCreate,
  isGitHubConnected,
}: NewSessionWizardProps) {
  const [step, setStep] = useState<WizardStep>("choose-type");
  const [sessionType, setSessionType] = useState<SessionType | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub flow state
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<GitHubBranch | null>(null);
  const [createWorktree, setCreateWorktree] = useState(false);
  const [newBranchName, setNewBranchName] = useState<string | undefined>();
  const [cloningStatus, setCloningStatus] = useState<string | null>(null);

  const resetWizard = () => {
    setStep("choose-type");
    setSessionType(null);
    setSessionName("");
    setProjectPath("");
    setError(null);
    setIsCreating(false);
    setSelectedRepo(null);
    setSelectedBranch(null);
    setCreateWorktree(false);
    setNewBranchName(undefined);
    setCloningStatus(null);
  };

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const handleTypeSelect = (type: SessionType) => {
    setSessionType(type);
    if (type === "simple" || type === "folder") {
      setStep("simple-form");
    } else {
      setStep("github-repo");
    }
  };

  const handleRepoSelect = (repo: GitHubRepository) => {
    setSelectedRepo(repo);
    setSessionName(repo.name);
    setStep("github-branch");
  };

  const handleBranchSelect = (
    branch: GitHubBranch | null,
    shouldCreateWorktree: boolean,
    branchName?: string
  ) => {
    setSelectedBranch(branch);
    setCreateWorktree(shouldCreateWorktree);
    setNewBranchName(branchName);
    setStep("github-confirm");
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      await onCreate({
        name: sessionName || "Terminal",
        projectPath: projectPath || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  const handleGitHubCreate = async () => {
    if (!selectedRepo) return;

    setIsCreating(true);
    setError(null);

    try {
      // Step 1: Clone or check if repo exists
      setCloningStatus("Checking repository...");
      const cloneResponse = await fetch(`/api/github/repositories/${selectedRepo.id}`, {
        method: "POST",
      });

      if (!cloneResponse.ok) {
        const data = await cloneResponse.json();
        throw new Error(data.error || "Failed to clone repository");
      }

      const cloneData = await cloneResponse.json();
      let workingPath = cloneData.localPath;

      // Step 2: Create worktree if requested
      if (createWorktree && (selectedBranch || newBranchName)) {
        setCloningStatus("Creating worktree...");

        const worktreeResponse = await fetch("/api/github/worktrees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repositoryPath: cloneData.localPath,
            branchName: newBranchName || selectedBranch?.name,
            baseBranch: newBranchName ? selectedBranch?.name : undefined,
            createBranch: !!newBranchName,
          }),
        });

        if (!worktreeResponse.ok) {
          const data = await worktreeResponse.json();
          throw new Error(data.error || "Failed to create worktree");
        }

        const worktreeData = await worktreeResponse.json();
        workingPath = worktreeData.path;
      }

      // Step 3: Create session
      setCloningStatus("Creating session...");
      await onCreate({
        name: sessionName || selectedRepo.name,
        projectPath: workingPath,
        githubRepoId: String(selectedRepo.id),
        worktreeBranch: newBranchName || selectedBranch?.name,
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
      setCloningStatus(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            New Terminal Session
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {step === "choose-type" && "Choose how to start your session"}
            {step === "simple-form" && "Configure your terminal session"}
            {step === "github-repo" && "Select a GitHub repository"}
            {step === "github-branch" && `Choose a branch for ${selectedRepo?.name}`}
            {step === "github-confirm" && "Review and create your session"}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {/* Step 1: Choose Type */}
          {step === "choose-type" && (
            <div className="grid gap-3">
              <SessionTypeCard
                icon={<Terminal className="w-5 h-5" />}
                title="Quick Start"
                description="Open a new terminal in your home directory"
                onClick={() => handleTypeSelect("simple")}
              />
              <SessionTypeCard
                icon={<Folder className="w-5 h-5" />}
                title="Open Folder"
                description="Start a terminal in a specific directory"
                onClick={() => handleTypeSelect("folder")}
              />
              <SessionTypeCard
                icon={<Github className="w-5 h-5" />}
                title="From GitHub"
                description="Clone a repo and optionally create a worktree"
                onClick={() => handleTypeSelect("github")}
                disabled={!isGitHubConnected}
                badge={!isGitHubConnected ? "Connect GitHub first" : undefined}
              />
            </div>
          )}

          {/* Step 2: Simple/Folder Form */}
          {step === "simple-form" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="session-name" className="text-sm text-slate-300">
                  Session Name
                </Label>
                <Input
                  id="session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Terminal"
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                />
              </div>

              {sessionType === "folder" && (
                <div className="space-y-2">
                  <Label htmlFor="project-path" className="text-sm text-slate-300">
                    Working Directory
                  </Label>
                  <Input
                    id="project-path"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="/path/to/project"
                    className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                  />
                  <p className="text-xs text-slate-500">
                    Leave empty to use your home directory
                  </p>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-slate-400"
                >
                  Back
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Session"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: GitHub Repo Selection */}
          {step === "github-repo" && (
            <RepositoryPicker
              onSelect={handleRepoSelect}
              onBack={() => setStep("choose-type")}
            />
          )}

          {/* Step 4: GitHub Branch Selection */}
          {step === "github-branch" && selectedRepo && (
            <BranchPicker
              repository={selectedRepo}
              onSelect={handleBranchSelect}
              onBack={() => setStep("github-repo")}
            />
          )}

          {/* Step 5: GitHub Confirmation */}
          {step === "github-confirm" && selectedRepo && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10 space-y-3">
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5 text-violet-400" />
                  <div>
                    <p className="text-sm text-slate-400">Repository</p>
                    <p className="font-medium text-white">{selectedRepo.fullName}</p>
                  </div>
                </div>

                {(selectedBranch || newBranchName) && (
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">
                        {newBranchName ? "New Branch" : "Branch"}
                      </p>
                      <p className="font-medium text-white">
                        {newBranchName || selectedBranch?.name}
                      </p>
                    </div>
                  </div>
                )}

                {createWorktree && (
                  <div className="flex items-center gap-3">
                    <Folder className="w-5 h-5 text-amber-400" />
                    <div>
                      <p className="text-sm text-slate-400">Worktree</p>
                      <p className="font-medium text-white">
                        Will be created automatically
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Session Name */}
              <div className="space-y-2">
                <Label htmlFor="github-session-name" className="text-sm text-slate-300">
                  Session Name
                </Label>
                <Input
                  id="github-session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={selectedRepo.name}
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("github-branch")}
                  className="text-slate-400"
                  disabled={isCreating}
                >
                  Back
                </Button>
                <Button
                  onClick={handleGitHubCreate}
                  disabled={isCreating}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {cloningStatus || "Creating..."}
                    </>
                  ) : (
                    "Create Session"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SessionTypeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
}

function SessionTypeCard({
  icon,
  title,
  description,
  onClick,
  disabled,
  badge,
}: SessionTypeCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex items-center gap-4 p-4 rounded-lg text-left transition-all duration-200",
        "border border-white/10",
        disabled
          ? "opacity-50 cursor-not-allowed bg-slate-800/30"
          : "bg-slate-800/50 hover:bg-slate-800/80 hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10"
      )}
    >
      <div
        className={cn(
          "p-2.5 rounded-lg",
          disabled
            ? "bg-slate-700/50 text-slate-400"
            : "bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-violet-400 group-hover:from-violet-500/30 group-hover:to-purple-500/30"
        )}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-white">{title}</h3>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400 mt-0.5">{description}</p>
      </div>
      {!disabled && (
        <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-violet-400 transition-colors" />
      )}
    </button>
  );
}
