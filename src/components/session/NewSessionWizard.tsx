"use client";

import { useState, useEffect } from "react";
import { Folder, Github, Terminal, ChevronRight, Loader2, Sparkles, GitBranch, FileBox, Clock, Fingerprint, MessageCircle, Briefcase } from "lucide-react";
import { PathInput } from "@/components/common";
import { ProfileSelector } from "@/components/profiles/ProfileSelector";
import { ProjectPickerCombobox } from "./ProjectPickerCombobox";
import { useProfileContext } from "@/contexts/ProfileContext";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
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
import { AGENT_PRESETS, WORKTREE_TYPES, type AgentPreset, type WorktreeType } from "@/types/session";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NewSessionWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    projectPath?: string;
    githubRepoId?: string;
    worktreeBranch?: string;
    folderId?: string;
    projectId?: string;
    startupCommand?: string;
    featureDescription?: string;
    createWorktree?: boolean;
    baseBranch?: string;
    profileId?: string;
    // Terminal type for plugin-based rendering
    terminalType?: "shell" | "agent" | "file" | "loop";
    // Agent-aware session fields
    agentProvider?: "claude" | "codex" | "gemini" | "opencode" | "none";
    autoLaunchAgent?: boolean;
    agentFlags?: string[];
    worktreeType?: WorktreeType;
    // Loop agent session fields
    loopConfig?: import("@/types/loop-agent").LoopConfig;
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
  | "save-template"
  | "loop-form";
type SessionType = "simple" | "github" | "folder" | "feature" | "template" | "loop";

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

  // Project state (selects which project the new session is created under).
  // Defaults to the active project from ProjectTreeContext when the wizard opens.
  const projectTree = useProjectTree();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (selectedProjectId) return;
    const active = projectTree.activeNode;
    if (active?.type === "project") {
      setSelectedProjectId(active.id);
    }
  }, [open, projectTree.activeNode, selectedProjectId]);

  // Feature session state
  const [featureDescription, setFeatureDescription] = useState("");
  const [generatedBranchName, setGeneratedBranchName] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentPreset>("claude");
  const [customAgentCommand, setCustomAgentCommand] = useState("");
  const [featureProjectPath, setFeatureProjectPath] = useState("");
  const [featureCreateWorktree, setFeatureCreateWorktree] = useState(false);
  const [worktreeType, setWorktreeType] = useState<WorktreeType>("feature");
  const [featureBaseBranch, setFeatureBaseBranch] = useState("main");
  const [isGitRepoValid, setIsGitRepoValid] = useState<boolean | null>(null);
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);

  // Loop session state
  const [loopName, setLoopName] = useState("");
  const [loopProjectPath, setLoopProjectPath] = useState("");
  const [loopType, setLoopType] = useState<"conversational" | "monitoring">("conversational");
  const [loopAgent, setLoopAgent] = useState<"claude" | "codex" | "gemini" | "opencode">("claude");
  const [loopIntervalMinutes, setLoopIntervalMinutes] = useState(5);
  const [loopPromptTemplate, setLoopPromptTemplate] = useState("");

  // Auto-generate branch name from feature description
  useEffect(() => {
    if (featureDescription.trim()) {
      const sanitized = featureDescription
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      setGeneratedBranchName(`${worktreeType}/${sanitized}`);
    } else {
      setGeneratedBranchName("");
    }
  }, [featureDescription, worktreeType]);

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
    setSelectedProjectId(null);
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
    setWorktreeType("feature");
    // Loop session reset
    setLoopName("");
    setLoopProjectPath("");
    setLoopType("conversational");
    setLoopAgent("claude");
    setLoopIntervalMinutes(5);
    setLoopPromptTemplate("");
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
    } else if (type === "loop") {
      setStep("loop-form");
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
        projectId: template.projectId || undefined,
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
        projectId: selectedProjectId || undefined,
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
        projectId: selectedProjectId || undefined,
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
      // For custom commands, still pass as startupCommand (shell type)
      // For known agents, use the terminal type system
      const isKnownAgent = selectedAgent !== "custom";

      await onCreate({
        name: sessionName || featureDescription || "Feature Session",
        projectPath: featureProjectPath || undefined,
        projectId: selectedProjectId || undefined,
        featureDescription,
        createWorktree: featureCreateWorktree,
        baseBranch: featureBaseBranch,
        worktreeBranch: featureCreateWorktree ? generatedBranchName : undefined,
        worktreeType: featureCreateWorktree ? worktreeType : undefined,
        profileId: selectedProfileId || undefined,
        terminalType: isKnownAgent ? "agent" : "shell",
        // Map selected agent to provider (claude, codex, gemini, opencode)
        agentProvider: isKnownAgent
          ? (selectedAgent as "claude" | "codex" | "gemini" | "opencode")
          : "none",
        autoLaunchAgent: isKnownAgent,
        // For custom commands, pass the command directly
        startupCommand: !isKnownAgent ? customAgentCommand : undefined,
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
      <DialogContent className="sm:max-w-[500px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            New Terminal Session
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === "choose-type" && "Choose how to start your session"}
            {step === "simple-form" && "Configure your terminal session"}
            {step === "github-repo" && "Select a GitHub repository"}
            {step === "github-branch" && `Choose a branch for ${selectedRepo?.name}`}
            {step === "github-confirm" && "Review and create your session"}
            {step === "feature-form" && "Configure your feature session"}
            {step === "loop-form" && "Configure your loop agent session"}
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
              <SessionTypeCard
                icon={<MessageCircle className="w-5 h-5" />}
                title="Loop Agent"
                description="Chat-first agent session with loop scheduling"
                onClick={() => handleTypeSelect("loop")}
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
                    className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border hover:border-primary/50 hover:bg-card transition-all text-left group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <FileBox className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {template.name}
                        </span>
                        {template.usageCount > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {template.usageCount}x
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {template.description}
                        </p>
                      )}
                      <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
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
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-muted-foreground"
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
                <Label htmlFor="session-name" className="text-sm text-foreground">
                  Session Name
                </Label>
                <Input
                  id="session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Terminal"
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>

              {/* Project Selection */}
              {projectTree.projects.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-foreground flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" />
                    Project
                  </Label>
                  <ProjectPickerCombobox
                    value={selectedProjectId}
                    onChange={setSelectedProjectId}
                    placeholder="Select a project (optional)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Organize this session under a project
                  </p>
                </div>
              )}

              {/* Profile Selection */}
              {profiles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-foreground flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-primary" />
                    Profile
                  </Label>
                  <ProfileSelector
                    value={selectedProfileId}
                    onChange={setSelectedProfileId}
                    placeholder="Select a profile (optional)"
                    showProviderBadge={true}
                  />
                  <p className="text-xs text-muted-foreground">
                    Apply git identity, secrets, and MCP servers from a profile
                  </p>
                </div>
              )}

              {sessionType === "folder" && (
                <div className="space-y-2">
                  <Label htmlFor="project-path" className="text-sm text-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use your home directory
                  </p>
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-muted-foreground"
                >
                  Back
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
              <div className="p-4 rounded-lg bg-card/50 border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Repository</p>
                    <p className="font-medium text-foreground">{selectedRepo.fullName}</p>
                  </div>
                </div>

                {(selectedBranch || newBranchName) && (
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {newBranchName ? "New Branch" : "Branch"}
                      </p>
                      <p className="font-medium text-foreground">
                        {newBranchName || selectedBranch?.name}
                      </p>
                    </div>
                  </div>
                )}

                {createWorktree && (
                  <div className="flex items-center gap-3">
                    <Folder className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Worktree</p>
                      <p className="font-medium text-foreground">
                        Will be created automatically
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Session Name */}
              <div className="space-y-2">
                <Label htmlFor="github-session-name" className="text-sm text-foreground">
                  Session Name
                </Label>
                <Input
                  id="github-session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={selectedRepo.name}
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("github-branch")}
                  className="text-muted-foreground"
                  disabled={isCreating}
                >
                  Back
                </Button>
                <Button
                  onClick={handleGitHubCreate}
                  disabled={isCreating}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
                <Label htmlFor="feature-desc" className="text-sm text-foreground">
                  Feature Description
                </Label>
                <Input
                  id="feature-desc"
                  value={featureDescription}
                  onChange={(e) => setFeatureDescription(e.target.value)}
                  placeholder="Add user authentication"
                  className="bg-card/50 border-border focus:border-primary"
                />
                {featureDescription.trim() && featureCreateWorktree && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <span>Branch:</span>
                    <Select value={worktreeType} onValueChange={(v) => setWorktreeType(v as WorktreeType)}>
                      <SelectTrigger
                        size="sm"
                        className="h-6 px-2 py-0 text-xs border-border bg-card/50 hover:border-primary/50 w-fit gap-1 font-mono text-primary"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {WORKTREE_TYPES.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs font-mono">
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">/</span>
                    <code className="text-primary font-mono">
                      {generatedBranchName.split("/").slice(1).join("/")}
                    </code>
                  </div>
                )}
              </div>

              {/* Agent Selector */}
              <div className="space-y-2">
                <Label className="text-sm text-foreground">AI Agent</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AGENT_PRESETS.filter((a) => a.id !== "custom").map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgent(agent.id)}
                      className={cn(
                        "p-3 rounded-lg text-left transition-all border",
                        selectedAgent === agent.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card/50 hover:border-border/80"
                      )}
                    >
                      <p className="font-medium text-foreground text-sm">{agent.label}</p>
                      <p className="text-xs text-muted-foreground">{agent.description}</p>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAgent("custom")}
                  className={cn(
                    "w-full p-3 rounded-lg text-left transition-all border",
                    selectedAgent === "custom"
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card/50 hover:border-border/80"
                  )}
                >
                  <p className="font-medium text-foreground text-sm">Custom Command</p>
                  <p className="text-xs text-muted-foreground">Enter your own command</p>
                </button>
                {selectedAgent === "custom" && (
                  <Input
                    value={customAgentCommand}
                    onChange={(e) => setCustomAgentCommand(e.target.value)}
                    placeholder="e.g., aider --model gpt-4"
                    className="mt-2 bg-card/50 border-border"
                  />
                )}
              </div>

              {/* Project Path */}
              <div className="space-y-2">
                <Label htmlFor="feature-path" className="text-sm text-foreground">
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

              {/* Project Selection */}
              {projectTree.projects.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-foreground flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" />
                    Project
                  </Label>
                  <ProjectPickerCombobox
                    value={selectedProjectId}
                    onChange={setSelectedProjectId}
                    placeholder="Select a project (optional)"
                  />
                </div>
              )}

              {/* Profile Selection */}
              {profiles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-foreground flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-primary" />
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
              <div className="flex items-center gap-3 p-3 rounded-lg bg-card/30 border border-border">
                <input
                  type="checkbox"
                  id="create-worktree"
                  checked={featureCreateWorktree}
                  onChange={(e) => setFeatureCreateWorktree(e.target.checked)}
                  className="rounded border-border bg-card text-primary focus:ring-primary"
                />
                <div>
                  <Label htmlFor="create-worktree" className="text-sm text-foreground cursor-pointer">
                    Create isolated worktree
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Separate directory for this feature branch
                  </p>
                </div>
              </div>

              {/* Base Branch (shown when worktree enabled) */}
              {featureCreateWorktree && featureProjectPath && (
                <div className="space-y-2">
                  {isGitRepoValid === false && (
                    <p className="text-sm text-destructive">Not a git repository</p>
                  )}
                  {isGitRepoValid && availableBranches.length > 0 && (
                    <>
                      <Label className="text-sm text-foreground">Base Branch</Label>
                      <select
                        value={featureBaseBranch}
                        onChange={(e) => setFeatureBaseBranch(e.target.value)}
                        className="w-full p-2.5 rounded-lg bg-card/50 border border-border text-foreground text-sm focus:border-primary focus:outline-none"
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

              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose-type")}
                  className="text-muted-foreground"
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
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Review
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Loop Agent Form */}
          {step === "loop-form" && (
            <div className="space-y-4">
              {/* Session Name */}
              <div className="space-y-2">
                <Label htmlFor="loop-name" className="text-sm font-medium">Session Name</Label>
                <Input
                  id="loop-name"
                  value={loopName}
                  onChange={(e) => setLoopName(e.target.value)}
                  placeholder="My Loop Agent"
                  className="bg-card/50"
                />
              </div>

              {/* Project Path */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Project Directory</Label>
                <PathInput
                  value={loopProjectPath}
                  onChange={setLoopProjectPath}
                  placeholder="~/projects/my-app"
                />
              </div>

              {/* Loop Type */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Loop Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLoopType("conversational")}
                    className={cn(
                      "p-3 rounded-lg border text-left text-sm transition-all",
                      loopType === "conversational"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/50 text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <div className="font-medium">Conversational</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Long-running chat with the agent
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoopType("monitoring")}
                    className={cn(
                      "p-3 rounded-lg border text-left text-sm transition-all",
                      loopType === "monitoring"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/50 text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <div className="font-medium">Monitoring</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Re-fire a prompt on an interval
                    </div>
                  </button>
                </div>
              </div>

              {/* Monitoring config (only shown for monitoring type) */}
              {loopType === "monitoring" && (
                <div className="space-y-3 p-3 rounded-lg bg-card/30 border border-border/50">
                  <div className="space-y-2">
                    <Label htmlFor="loop-interval" className="text-sm font-medium">
                      Interval (minutes)
                    </Label>
                    <Input
                      id="loop-interval"
                      type="number"
                      min={1}
                      max={1440}
                      value={loopIntervalMinutes}
                      onChange={(e) => setLoopIntervalMinutes(Number(e.target.value) || 5)}
                      className="bg-card/50 w-24"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="loop-prompt" className="text-sm font-medium">
                      Prompt Template
                    </Label>
                    <textarea
                      id="loop-prompt"
                      value={loopPromptTemplate}
                      onChange={(e) => setLoopPromptTemplate(e.target.value)}
                      placeholder="Check for failing tests and fix them..."
                      rows={3}
                      className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Agent provider */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Agent</Label>
                <div className="grid grid-cols-4 gap-2">
                  {(["claude", "codex", "gemini", "opencode"] as const).map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      onClick={() => setLoopAgent(agent)}
                      className={cn(
                        "px-3 py-2 rounded-lg border text-sm font-medium capitalize transition-all",
                        loopAgent === agent
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card/50 text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {agent}
                    </button>
                  ))}
                </div>
              </div>

              {/* Project selector */}
              {projectTree.projects.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" />
                    Project
                  </Label>
                  <ProjectPickerCombobox
                    value={selectedProjectId}
                    onChange={setSelectedProjectId}
                    placeholder="Select a project (optional)"
                  />
                </div>
              )}

              {/* Profile selector */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-primary" />
                  Profile
                </Label>
                <ProfileSelector
                  value={selectedProfileId}
                  onChange={setSelectedProfileId}
                  placeholder="Select a profile (optional)"
                  showProviderBadge={true}
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep("choose-type")} className="flex-1">
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={isCreating || !loopName.trim()}
                  onClick={async () => {
                    setIsCreating(true);
                    setError(null);
                    try {
                      await onCreate({
                        name: loopName.trim(),
                        projectPath: loopProjectPath || undefined,
                        profileId: selectedProfileId || undefined,
                        projectId: selectedProjectId || undefined,
                        terminalType: "loop",
                        agentProvider: loopAgent,
                        autoLaunchAgent: true,
                        loopConfig: {
                          loopType,
                          intervalSeconds: loopType === "monitoring" ? loopIntervalMinutes * 60 : undefined,
                          promptTemplate: loopType === "monitoring" ? loopPromptTemplate : undefined,
                        },
                      });
                      handleClose();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to create session");
                    } finally {
                      setIsCreating(false);
                    }
                  }}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Loop Session"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Feature Session Confirmation */}
          {step === "feature-confirm" && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 rounded-lg bg-card/50 border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Feature</p>
                    <p className="font-medium text-foreground">{featureDescription}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Agent Command</p>
                    <p className="font-medium text-foreground font-mono text-sm">
                      {selectedAgent === "custom"
                        ? customAgentCommand
                        : AGENT_PRESETS.find((a) => a.id === selectedAgent)?.command}
                    </p>
                  </div>
                </div>

                {featureCreateWorktree && generatedBranchName && (
                  <div className="flex items-center gap-3">
                    <GitBranch className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Branch</p>
                      <p className="font-medium text-foreground font-mono text-sm">
                        {generatedBranchName}
                      </p>
                    </div>
                  </div>
                )}

                {featureCreateWorktree && (
                  <div className="flex items-center gap-3">
                    <Folder className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Worktree</p>
                      <p className="font-medium text-foreground">
                        Will be created from {featureBaseBranch}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Session Name */}
              <div className="space-y-2">
                <Label htmlFor="feature-session-name" className="text-sm text-foreground">
                  Session Name
                </Label>
                <Input
                  id="feature-session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={featureDescription || "Feature Session"}
                  className="bg-card/50 border-border focus:border-primary"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* Footer */}
              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep("feature-form")}
                  className="text-muted-foreground"
                  disabled={isCreating}
                >
                  Back
                </Button>
                <Button
                  onClick={handleFeatureCreate}
                  disabled={isCreating}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
        "border border-border",
        disabled
          ? "opacity-50 cursor-not-allowed bg-card/30"
          : "bg-card/50 hover:bg-card/80 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
      )}
    >
      <div
        className={cn(
          "p-2.5 rounded-lg",
          disabled
            ? "bg-muted/50 text-muted-foreground"
            : "bg-primary/20 text-primary group-hover:bg-primary/30"
        )}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-foreground">{title}</h3>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      {!disabled && (
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
      )}
    </button>
  );
}
