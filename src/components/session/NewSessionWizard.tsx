"use client";

import { useState, useEffect } from "react";
import { Folder, Github, Terminal, ChevronRight, Loader2, Sparkles, GitBranch, FileBox, Clock, Fingerprint } from "lucide-react";
import { PathInput } from "@/components/common";
import { ProfileSelector } from "@/components/profiles/ProfileSelector";
import { useProfileContext } from "@/contexts/ProfileContext";
import { useTemplateContext } from "@/contexts/TemplateContext";
import { expandNamePattern, type SessionTemplate } from "@/types/template";
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
import { AGENT_PRESETS, type AgentPreset } from "@/types/session";

interface NewSessionWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    projectPath?: string;
    githubRepoId?: string;
    worktreeBranch?: string;
    folderId?: string;
    startupCommand?: string;
    featureDescription?: string;
    createWorktree?: boolean;
    baseBranch?: string;
    profileId?: string;
  }) => Promise<void>;
  isGitHubConnected: boolean;
}

type WizardStep =
  | "choose-type"
  | "simple-form"
  | "github-repo"
  | "github-branch"
  | "github-confirm"
  | "feature-form"
  | "feature-confirm"
  | "template-list"
  | "save-template";
type SessionType = "simple" | "github" | "folder" | "feature" | "template";

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

  // Template state
  const { templates, recordUsage } = useTemplateContext();
  const [templateCounter, setTemplateCounter] = useState(1);

  // Profile state
  const { profiles } = useProfileContext();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Feature session state
  const [featureDescription, setFeatureDescription] = useState("");
  const [generatedBranchName, setGeneratedBranchName] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentPreset>("claude");
  const [customAgentCommand, setCustomAgentCommand] = useState("");
  const [featureProjectPath, setFeatureProjectPath] = useState("");
  const [featureCreateWorktree, setFeatureCreateWorktree] = useState(false);
  const [featureBaseBranch, setFeatureBaseBranch] = useState("main");
  const [isGitRepoValid, setIsGitRepoValid] = useState<boolean | null>(null);
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);

  // Auto-generate branch name from feature description
  useEffect(() => {
    if (featureDescription.trim()) {
      const sanitized = featureDescription
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      setGeneratedBranchName(`feature/${sanitized}`);
    } else {
      setGeneratedBranchName("");
    }
  }, [featureDescription]);

  // Validate project path is a git repo when worktree is enabled
  useEffect(() => {
    if (featureCreateWorktree && featureProjectPath) {
      const validateGitRepo = async () => {
        try {
          const response = await fetch(
            `/api/git/validate?path=${encodeURIComponent(featureProjectPath)}`
          );
          const data = await response.json();
          setIsGitRepoValid(data.isGitRepo);
          if (data.branches) {
            setAvailableBranches(data.branches);
            // Set default base branch
            if (data.branches.includes("main")) {
              setFeatureBaseBranch("main");
            } else if (data.branches.includes("master")) {
              setFeatureBaseBranch("master");
            } else if (data.branches.length > 0) {
              setFeatureBaseBranch(data.branches[0]);
            }
          }
        } catch {
          setIsGitRepoValid(false);
        }
      };
      validateGitRepo();
    } else {
      setIsGitRepoValid(null);
      setAvailableBranches([]);
    }
  }, [featureCreateWorktree, featureProjectPath]);

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
    setSelectedProfileId(null);
    // Feature session reset
    setFeatureDescription("");
    setGeneratedBranchName("");
    setSelectedAgent("claude");
    setCustomAgentCommand("");
    setFeatureProjectPath("");
    setFeatureCreateWorktree(false);
    setFeatureBaseBranch("main");
    setIsGitRepoValid(null);
    setAvailableBranches([]);
  };

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const handleTypeSelect = (type: SessionType) => {
    setSessionType(type);
    if (type === "simple" || type === "folder") {
      setStep("simple-form");
    } else if (type === "feature") {
      setStep("feature-form");
    } else if (type === "template") {
      setStep("template-list");
    } else {
      setStep("github-repo");
    }
  };

  const handleTemplateSelect = async (template: SessionTemplate) => {
    setIsCreating(true);
    setError(null);

    try {
      // Record template usage
      await recordUsage(template.id);

      // Expand name pattern
      const name = expandNamePattern(template.sessionNamePattern, templateCounter);
      setTemplateCounter((c) => c + 1);

      // Create session with template settings
      await onCreate({
        name,
        projectPath: template.projectPath || undefined,
        folderId: template.folderId || undefined,
        startupCommand: template.startupCommand || undefined,
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
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
        profileId: selectedProfileId || undefined,
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
        throw new Error(data.error || "Failed to prepare repository");
      }

      const cloneData = await cloneResponse.json();

      // Debug: log cloneData to verify we have repositoryId
      console.log("Clone response:", cloneData);

      if (!cloneData.repositoryId) {
        throw new Error("Repository ID not returned from clone operation");
      }

      let workingPath = cloneData.localPath;

      // Step 2: Create worktree if requested
      if (createWorktree && (selectedBranch || newBranchName)) {
        setCloningStatus("Creating worktree...");

        const worktreeResponse = await fetch("/api/github/worktrees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repositoryId: cloneData.repositoryId,
            branch: newBranchName || selectedBranch?.name,
            baseBranch: newBranchName ? selectedBranch?.name : undefined,
            createNewBranch: !!newBranchName,
          }),
        });

        if (!worktreeResponse.ok) {
          const data = await worktreeResponse.json();
          const errorMsg = data.details
            ? `${data.error}: ${data.details}`
            : data.error || "Failed to create worktree";
          throw new Error(errorMsg);
        }

        const worktreeData = await worktreeResponse.json();
        workingPath = worktreeData.worktreePath;
      }

      // Step 3: Create session
      setCloningStatus("Creating session...");
      await onCreate({
        name: sessionName || selectedRepo.name,
        projectPath: workingPath,
        // Use database ID returned from clone API (not GitHub's numeric ID)
        githubRepoId: cloneData.repositoryId,
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

  const handleFeatureCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const agentCommand =
        selectedAgent === "custom"
          ? customAgentCommand
          : AGENT_PRESETS.find((a) => a.id === selectedAgent)?.command;

      await onCreate({
        name: sessionName || featureDescription || "Feature Session",
        projectPath: featureProjectPath || undefined,
        startupCommand: agentCommand,
        featureDescription,
        createWorktree: featureCreateWorktree,
        baseBranch: featureBaseBranch,
        worktreeBranch: featureCreateWorktree ? generatedBranchName : undefined,
        profileId: selectedProfileId || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
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
            {step === "feature-form" && "Configure your feature session"}
            {step === "feature-confirm" && "Review and create your session"}
            {step === "template-list" && "Select a saved template to use"}
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
              <SessionTypeCard
                icon={<Sparkles className="w-5 h-5" />}
                title="Feature Session"
                description="Start an AI agent session for a new feature"
                onClick={() => handleTypeSelect("feature")}
              />
              {templates.length > 0 && (
                <SessionTypeCard
                  icon={<FileBox className="w-5 h-5" />}
                  title="From Template"
                  description={`Use a saved configuration (${templates.length} available)`}
                  onClick={() => handleTypeSelect("template")}
                />
              )}
            </div>
          )}

          {/* Template List */}
          {step === "template-list" && (
            <div className="space-y-4">
              <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleTemplateSelect(template)}
                    disabled={isCreating}
                    className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-white/5 hover:border-violet-500/50 hover:bg-slate-800 transition-all text-left group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <FileBox className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">
                          {template.name}
                        </span>
                        {template.usageCount > 0 && (
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {template.usageCount}x
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-xs text-slate-400 truncate">
                          {template.description}
                        </p>
                      )}
                      <div className="flex gap-2 mt-1 text-[10px] text-slate-500">
                        {template.projectPath && (
                          <span className="truncate max-w-[150px]">
                            {template.projectPath}
                          </span>
                        )}
                        {template.startupCommand && (
                          <span className="truncate max-w-[100px]">
                            $ {template.startupCommand}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-violet-400 flex-shrink-0" />
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-slate-400"
                >
                  Back
                </Button>
              </div>
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

              {/* Profile Selection */}
              {profiles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-slate-300 flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-violet-400" />
                    Profile
                  </Label>
                  <ProfileSelector
                    value={selectedProfileId}
                    onChange={setSelectedProfileId}
                    placeholder="Select a profile (optional)"
                    showProviderBadge={true}
                  />
                  <p className="text-xs text-slate-500">
                    Apply git identity, secrets, and MCP servers from a profile
                  </p>
                </div>
              )}

              {sessionType === "folder" && (
                <div className="space-y-2">
                  <Label htmlFor="project-path" className="text-sm text-slate-300">
                    Working Directory
                  </Label>
                  <PathInput
                    id="project-path"
                    value={projectPath}
                    onChange={setProjectPath}
                    placeholder="/path/to/project"
                    browserTitle="Select Working Directory"
                    browserDescription="Choose a directory to start your terminal session in"
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

          {/* Feature Session Form */}
          {step === "feature-form" && (
            <div className="space-y-4">
              {/* Feature Description */}
              <div className="space-y-2">
                <Label htmlFor="feature-desc" className="text-sm text-slate-300">
                  Feature Description
                </Label>
                <Input
                  id="feature-desc"
                  value={featureDescription}
                  onChange={(e) => setFeatureDescription(e.target.value)}
                  placeholder="Add user authentication"
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                />
                {generatedBranchName && (
                  <p className="text-xs text-slate-500">
                    Branch: <code className="text-violet-400">{generatedBranchName}</code>
                  </p>
                )}
              </div>

              {/* Agent Selector */}
              <div className="space-y-2">
                <Label className="text-sm text-slate-300">AI Agent</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AGENT_PRESETS.filter((a) => a.id !== "custom").map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgent(agent.id)}
                      className={cn(
                        "p-3 rounded-lg text-left transition-all border",
                        selectedAgent === agent.id
                          ? "border-violet-500 bg-violet-500/10"
                          : "border-white/10 bg-slate-800/50 hover:border-white/20"
                      )}
                    >
                      <p className="font-medium text-white text-sm">{agent.label}</p>
                      <p className="text-xs text-slate-400">{agent.description}</p>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAgent("custom")}
                  className={cn(
                    "w-full p-3 rounded-lg text-left transition-all border",
                    selectedAgent === "custom"
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-white/10 bg-slate-800/50 hover:border-white/20"
                  )}
                >
                  <p className="font-medium text-white text-sm">Custom Command</p>
                  <p className="text-xs text-slate-400">Enter your own command</p>
                </button>
                {selectedAgent === "custom" && (
                  <Input
                    value={customAgentCommand}
                    onChange={(e) => setCustomAgentCommand(e.target.value)}
                    placeholder="e.g., aider --model gpt-4"
                    className="mt-2 bg-slate-800/50 border-white/10"
                  />
                )}
              </div>

              {/* Project Path */}
              <div className="space-y-2">
                <Label htmlFor="feature-path" className="text-sm text-slate-300">
                  Project Path
                </Label>
                <PathInput
                  id="feature-path"
                  value={featureProjectPath}
                  onChange={setFeatureProjectPath}
                  placeholder="/path/to/project"
                  browserTitle="Select Project"
                  browserDescription="Choose a project directory for your feature session"
                />
              </div>

              {/* Profile Selection */}
              {profiles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-slate-300 flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-violet-400" />
                    Profile
                  </Label>
                  <ProfileSelector
                    value={selectedProfileId}
                    onChange={setSelectedProfileId}
                    placeholder="Select a profile (optional)"
                    showProviderBadge={true}
                  />
                </div>
              )}

              {/* Create Worktree Toggle */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-white/10">
                <input
                  type="checkbox"
                  id="create-worktree"
                  checked={featureCreateWorktree}
                  onChange={(e) => setFeatureCreateWorktree(e.target.checked)}
                  className="rounded border-white/20 bg-slate-800 text-violet-500 focus:ring-violet-500"
                />
                <div>
                  <Label htmlFor="create-worktree" className="text-sm text-white cursor-pointer">
                    Create isolated worktree
                  </Label>
                  <p className="text-xs text-slate-400">
                    Separate directory for this feature branch
                  </p>
                </div>
              </div>

              {/* Base Branch (shown when worktree enabled) */}
              {featureCreateWorktree && featureProjectPath && (
                <div className="space-y-2">
                  {isGitRepoValid === false && (
                    <p className="text-sm text-red-400">Not a git repository</p>
                  )}
                  {isGitRepoValid && availableBranches.length > 0 && (
                    <>
                      <Label className="text-sm text-slate-300">Base Branch</Label>
                      <select
                        value={featureBaseBranch}
                        onChange={(e) => setFeatureBaseBranch(e.target.value)}
                        className="w-full p-2.5 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none"
                      >
                        {availableBranches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-slate-400"
                >
                  Back
                </Button>
                <Button
                  onClick={() => setStep("feature-confirm")}
                  disabled={
                    !featureDescription.trim() ||
                    (selectedAgent === "custom" && !customAgentCommand.trim()) ||
                    (featureCreateWorktree && isGitRepoValid === false)
                  }
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                >
                  Review
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Feature Session Confirmation */}
          {step === "feature-confirm" && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10 space-y-3">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-violet-400" />
                  <div>
                    <p className="text-sm text-slate-400">Feature</p>
                    <p className="font-medium text-white">{featureDescription}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-sm text-slate-400">Agent Command</p>
                    <p className="font-medium text-white font-mono text-sm">
                      {selectedAgent === "custom"
                        ? customAgentCommand
                        : AGENT_PRESETS.find((a) => a.id === selectedAgent)?.command}
                    </p>
                  </div>
                </div>

                {featureCreateWorktree && generatedBranchName && (
                  <div className="flex items-center gap-3">
                    <GitBranch className="w-5 h-5 text-amber-400" />
                    <div>
                      <p className="text-sm text-slate-400">Branch</p>
                      <p className="font-medium text-white font-mono text-sm">
                        {generatedBranchName}
                      </p>
                    </div>
                  </div>
                )}

                {featureCreateWorktree && (
                  <div className="flex items-center gap-3">
                    <Folder className="w-5 h-5 text-blue-400" />
                    <div>
                      <p className="text-sm text-slate-400">Worktree</p>
                      <p className="font-medium text-white">
                        Will be created from {featureBaseBranch}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Session Name */}
              <div className="space-y-2">
                <Label htmlFor="feature-session-name" className="text-sm text-slate-300">
                  Session Name
                </Label>
                <Input
                  id="feature-session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={featureDescription || "Feature Session"}
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("feature-form")}
                  className="text-slate-400"
                  disabled={isCreating}
                >
                  Back
                </Button>
                <Button
                  onClick={handleFeatureCreate}
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
