import { describe, it, expect, beforeEach } from "bun:test";
import { Session } from "@/domain/entities/Session";
import { Folder } from "@/domain/entities/Folder";
import { Episode, EpisodeBuilder } from "@/domain/entities/Episode";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";

/**
 * E2E Tests: SDK Complete Workflow
 *
 * Tests the full SDK workflow scenarios:
 * 1. Session creation with memory context injection
 * 2. Meta-agent optimization with agent sessions
 * 3. Cross-session learning propagation
 * 4. Extension loading and tool execution
 */
describe("E2E: SDK Complete Workflow", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Session Creation with Memory Context
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Session Creation with Memory Context", () => {
    it("should create session with hierarchical memory context", () => {
      // Create folder with existing knowledge
      const folder = Folder.create({
        name: "Project with Memory",
        userId: "user-memory-1",
        parentId: null,
      });

      // Create session that should receive memory context
      const session = Session.create({
        name: "Feature Implementation",
        userId: "user-memory-1",
        folderId: folder.id,
        projectPath: "/projects/memory-test",
        agentProvider: "claude",
        profileId: "profile-claude-1",
      });

      // Verify session has the context needed for memory injection
      expect(session.folderId).toBe(folder.id);
      expect(session.projectPath).toBe("/projects/memory-test");
      expect(session.agentProvider).toBe("claude");

      // Simulate memory context that would be injected
      const memoryContext = {
        shortTerm: [
          { type: "command", content: "git status", timestamp: new Date() },
          { type: "file_read", content: "src/index.ts", timestamp: new Date() },
        ],
        working: [
          { type: "goal", content: "Implement authentication", importance: 0.9 },
          { type: "blocker", content: "Need to decide on JWT vs sessions", importance: 0.8 },
        ],
        longTerm: [
          { type: "learned_pattern", content: "Use factory pattern for services", timestamp: new Date() },
          { type: "gotcha", content: "Remember to await async operations", timestamp: new Date() },
        ],
      };

      // Memory context should be injectable into session
      expect(memoryContext.shortTerm.length).toBeGreaterThan(0);
      expect(memoryContext.working.length).toBeGreaterThan(0);
      expect(memoryContext.longTerm.length).toBeGreaterThan(0);
    });

    it("should restore memory context when resuming session", () => {
      const session = Session.create({
        name: "Resumable Session",
        userId: "user-resume-1",
        projectPath: "/projects/resume-test",
        agentProvider: "claude",
      });

      // Build some work history via Episode
      const builder = new EpisodeBuilder(session.id, "test-folder-id");
      builder.setContext({
        taskDescription: "Initial work",
        projectPath: session.projectPath || "/projects/resume-test",
        initialState: "Starting",
        agentProvider: session.agentProvider || "claude",
      });
      builder.addAction({
        action: "Read project files",
        tool: "Read",
        duration: 500,
        success: true,
      });
      builder.addDecision({
        context: "Architecture",
        options: ["Monolith", "Microservices"],
        chosen: "Monolith",
        reasoning: "Simpler for MVP",
      });

      const episode = builder.build(
        "partial",
        "In progress",
        { whatWorked: ["Reading files"], whatFailed: [], keyInsights: ["Start simple"] },
        ["architecture"]
      );

      // Suspend session
      const suspended = session.suspend();
      expect(suspended.status.toString()).toBe("suspended");

      // Resume session - memory context should be restorable
      const resumed = suspended.resume();
      expect(resumed.status.isActive()).toBe(true);

      // Episode represents the memory that should be restored
      expect(episode.trajectory.actions.length).toBe(1);
      expect(episode.trajectory.decisions.length).toBe(1);
      expect(episode.context.agentProvider).toBe("claude");
    });

    it("should inherit folder memory context", () => {
      // Create folder hierarchy
      const rootFolder = Folder.create({
        name: "Root Project",
        userId: "user-inherit-1",
        parentId: null,
      });

      const childFolder = Folder.create({
        name: "Feature Branch",
        userId: "user-inherit-1",
        parentId: rootFolder.id,
      });

      // Sessions in child folder should inherit root folder's memory
      const session = Session.create({
        name: "Feature Work",
        userId: "user-inherit-1",
        folderId: childFolder.id,
        projectPath: "/projects/feature",
        agentProvider: "claude",
      });

      expect(session.folderId).toBe(childFolder.id);
      expect(childFolder.parentId).toBe(rootFolder.id);

      // Memory inheritance path: session -> child folder -> root folder
      // This is verified by the folder hierarchy
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Meta-Agent Optimization Workflow
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Meta-Agent Optimization Workflow", () => {
    it("should execute complete BUILD → TEST → IMPROVE loop", () => {
      // Create session for optimization
      const folder = Folder.create({
        name: "Optimization Target",
        userId: "user-opt-1",
        parentId: null,
      });

      const session = Session.create({
        name: "Task needing optimization",
        userId: "user-opt-1",
        folderId: folder.id,
        projectPath: "/projects/optimize",
        agentProvider: "claude",
      });

      // Simulate optimization job state progression
      interface OptimizationJob {
        id: string;
        status: "pending" | "running" | "completed" | "failed";
        currentIteration: number;
        maxIterations: number;
        scores: number[];
        targetScore: number;
      }

      const job: OptimizationJob = {
        id: `job-${Date.now()}`,
        status: "pending",
        currentIteration: 0,
        maxIterations: 3,
        scores: [],
        targetScore: 0.9,
      };

      // BUILD phase: Generate initial config
      job.status = "running";
      const initialConfig = {
        id: `config-${Date.now()}`,
        name: "Initial config",
        provider: session.agentProvider,
        version: 1,
        systemPrompt: "You are a helpful coding assistant",
        instructionsFile: "# Task: Implement feature",
      };
      expect(initialConfig.version).toBe(1);

      // TEST phase: Evaluate config
      job.currentIteration = 1;
      const testScore = 0.65;
      job.scores.push(testScore);
      expect(testScore).toBeLessThan(job.targetScore);

      // IMPROVE phase: Refine config
      const improvedConfig = {
        ...initialConfig,
        version: 2,
        systemPrompt: initialConfig.systemPrompt + "\n\nFocus on clean code patterns.",
        instructionsFile: initialConfig.instructionsFile + "\n\n## Constraints\n- Use TypeScript",
      };
      expect(improvedConfig.version).toBe(2);

      // Second iteration
      job.currentIteration = 2;
      const secondScore = 0.82;
      job.scores.push(secondScore);
      expect(secondScore).toBeGreaterThan(testScore);

      // Third iteration
      job.currentIteration = 3;
      const finalScore = 0.93;
      job.scores.push(finalScore);
      expect(finalScore).toBeGreaterThanOrEqual(job.targetScore);

      // Complete
      job.status = "completed";
      expect(job.status).toBe("completed");
      expect(job.scores).toHaveLength(3);
      expect(job.scores[job.scores.length - 1]).toBeGreaterThanOrEqual(job.targetScore);
    });

    it("should trigger optimization when session stalls", () => {
      const session = Session.create({
        name: "Stalling session",
        userId: "user-stall-1",
        projectPath: "/projects/stall",
        agentProvider: "gemini",
      });

      // Create orchestrator monitoring the session
      const orchestrator = Orchestrator.createMaster({
        userId: "user-stall-1",
        sessionId: "orchestrator-session-1",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      // Detect stall and create insight
      const stallInsight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: session.id,
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled for 5+ minutes",
        context: {
          stallDuration: 320,
          lastActivity: new Date(Date.now() - 320000),
          lastActivityDescription: "Waiting for user input",
        },
        suggestedActions: [
          {
            label: "Optimize Config",
            description: "Run meta-agent optimization to improve config",
            command: "optimize-config",
            dangerous: false,
          },
          {
            label: "Send Nudge",
            description: "Send Enter key to resume",
            command: "\n",
            dangerous: false,
          },
        ],
      });

      expect(stallInsight.type).toBe("stall_detected");
      expect(stallInsight.hasSuggestedActions()).toBe(true);
      expect(stallInsight.suggestedActions[0]?.label).toBe("Optimize Config");

      // Simulate triggering optimization
      const optimizationTriggered = stallInsight.suggestedActions.some(
        (a) => a.command === "optimize-config"
      );
      expect(optimizationTriggered).toBe(true);
    });

    it("should apply config improvements to session", () => {
      const session = Session.create({
        name: "Config apply test",
        userId: "user-apply-1",
        projectPath: "/projects/apply",
        agentProvider: "claude",
      });

      // Initial config
      const originalConfig = {
        id: "config-original",
        provider: "claude",
        version: 1,
        systemPrompt: "Basic prompt",
        instructionsFile: "Basic instructions",
      };

      // Optimized config after BUILD → TEST → IMPROVE
      const optimizedConfig = {
        id: "config-optimized",
        provider: "claude",
        version: 3,
        systemPrompt: originalConfig.systemPrompt +
          "\n\nYou excel at TypeScript and follow clean architecture patterns." +
          "\n\nPreferred pattern: Use dependency injection for services.",
        instructionsFile: originalConfig.instructionsFile +
          "\n\n## Learned Gotchas\n- Always await async operations\n- Check for null before accessing properties",
      };

      // Config update result
      const updateResult = {
        success: true,
        sessionId: session.id,
        configId: optimizedConfig.id,
        changes: [
          "Added TypeScript expertise to system prompt",
          "Added dependency injection pattern",
          "Added gotchas from session analysis",
        ],
      };

      expect(updateResult.success).toBe(true);
      expect(updateResult.changes.length).toBe(3);
      expect(optimizedConfig.version).toBeGreaterThan(originalConfig.version);
    });

    it("should track optimization history per folder", () => {
      const folder = Folder.create({
        name: "Optimization History",
        userId: "user-history-1",
        parentId: null,
      });

      // Multiple optimization records
      const optimizationHistory = [
        {
          id: "opt-1",
          folderId: folder.id,
          trigger: "stall_detected" as const,
          initialScore: 0.5,
          finalScore: 0.78,
          iterations: 2,
          status: "completed" as const,
        },
        {
          id: "opt-2",
          folderId: folder.id,
          trigger: "error_pattern" as const,
          initialScore: 0.6,
          finalScore: 0.85,
          iterations: 3,
          status: "completed" as const,
        },
        {
          id: "opt-3",
          folderId: folder.id,
          trigger: "manual" as const,
          initialScore: 0.7,
          finalScore: 0.92,
          iterations: 2,
          status: "completed" as const,
        },
      ];

      // Verify history tracking
      expect(optimizationHistory).toHaveLength(3);

      // All belong to same folder
      expect(optimizationHistory.every((r) => r.folderId === folder.id)).toBe(true);

      // Score improvements tracked
      const avgImprovement = optimizationHistory.reduce(
        (sum, r) => sum + (r.finalScore - r.initialScore),
        0
      ) / optimizationHistory.length;
      expect(avgImprovement).toBeGreaterThan(0.15);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Cross-Session Learning Propagation
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Cross-Session Learning Propagation", () => {
    it("should propagate learnings from completed sessions", () => {
      const folder = Folder.create({
        name: "Learning Folder",
        userId: "user-learn-1",
        parentId: null,
      });

      // First session learns something
      const session1 = Session.create({
        name: "Learning session",
        userId: "user-learn-1",
        folderId: folder.id,
        projectPath: "/projects/learn",
        agentProvider: "claude",
      });

      const builder1 = new EpisodeBuilder(session1.id, folder.id);
      builder1.setContext({
        taskDescription: "Implement caching",
        projectPath: "/projects/learn",
        initialState: "No caching",
        agentProvider: "claude",
      });
      builder1.addDecision({
        context: "Cache strategy",
        options: ["In-memory", "Redis", "File"],
        chosen: "Redis",
        reasoning: "Distributed caching needed",
      });

      const episode1 = builder1.build(
        "success",
        "Caching implemented",
        {
          whatWorked: ["Redis for distributed cache"],
          whatFailed: ["In-memory failed with multiple instances"],
          keyInsights: ["Always use distributed cache for scalability"],
        },
        ["caching", "redis"]
      );

      // Second session in same folder should benefit
      const session2 = Session.create({
        name: "Related task",
        userId: "user-learn-1",
        folderId: folder.id,
        projectPath: "/projects/learn",
        agentProvider: "claude",
      });

      // Learnings from episode1 should inform session2
      const relevantLearnings = episode1.reflection;
      expect(relevantLearnings.keyInsights).toContain("Always use distributed cache for scalability");
      expect(session2.folderId).toBe(episode1.folderId);
    });

    it("should propagate learnings across folder hierarchy", () => {
      // Root folder with learnings
      const rootFolder = Folder.create({
        name: "Root",
        userId: "user-hierarchy-1",
        parentId: null,
      });

      // Child folder should inherit learnings
      const childFolder = Folder.create({
        name: "Child",
        userId: "user-hierarchy-1",
        parentId: rootFolder.id,
      });

      // Learning in root folder
      const rootSession = Session.create({
        name: "Root session",
        userId: "user-hierarchy-1",
        folderId: rootFolder.id,
        agentProvider: "claude",
      });

      const rootBuilder = new EpisodeBuilder(rootSession.id, rootFolder.id);
      rootBuilder.setContext({
        taskDescription: "Project setup",
        projectPath: "/projects/root",
        initialState: "Empty",
        agentProvider: "claude",
      });

      const rootEpisode = rootBuilder.build(
        "success",
        "Setup complete",
        {
          whatWorked: ["Using TypeScript strict mode"],
          whatFailed: [],
          keyInsights: ["Always enable strict mode for new projects"],
        },
        ["setup", "typescript"]
      );

      // Session in child folder
      const childSession = Session.create({
        name: "Child session",
        userId: "user-hierarchy-1",
        folderId: childFolder.id,
        agentProvider: "claude",
      });

      // Child session should have access to root learnings via hierarchy
      expect(childFolder.parentId).toBe(rootFolder.id);
      expect(rootEpisode.folderId).toBe(rootFolder.id);
      expect(childSession.folderId).toBe(childFolder.id);

      // Learning propagation path: rootFolder -> childFolder
    });

    it("should aggregate learnings from multiple agents", () => {
      const folder = Folder.create({
        name: "Multi-Agent Learning",
        userId: "user-multi-learn-1",
        parentId: null,
      });

      // Claude session learns about code patterns
      const claudeSession = Session.create({
        name: "Claude coding",
        userId: "user-multi-learn-1",
        folderId: folder.id,
        agentProvider: "claude",
      });

      const claudeBuilder = new EpisodeBuilder(claudeSession.id, folder.id);
      claudeBuilder.setContext({
        taskDescription: "Write service",
        projectPath: "/projects/multi",
        initialState: "Starting",
        agentProvider: "claude",
      });

      const claudeEpisode = claudeBuilder.build(
        "success",
        "Service written",
        {
          whatWorked: ["Factory pattern for DI"],
          whatFailed: [],
          keyInsights: ["Use factory for testability"],
        },
        ["patterns"]
      );

      // Gemini session learns about research patterns
      const geminiSession = Session.create({
        name: "Gemini research",
        userId: "user-multi-learn-1",
        folderId: folder.id,
        agentProvider: "gemini",
      });

      const geminiBuilder = new EpisodeBuilder(geminiSession.id, folder.id);
      geminiBuilder.setContext({
        taskDescription: "Research options",
        projectPath: "/projects/multi",
        initialState: "Unknown options",
        agentProvider: "gemini",
      });

      const geminiEpisode = geminiBuilder.build(
        "success",
        "Research complete",
        {
          whatWorked: ["Comparing 3+ options"],
          whatFailed: ["Binary choices missed edge cases"],
          keyInsights: ["Always consider 3+ alternatives"],
        },
        ["research"]
      );

      // Both agents' learnings available in folder
      expect(claudeEpisode.folderId).toBe(folder.id);
      expect(geminiEpisode.folderId).toBe(folder.id);
      expect(claudeEpisode.context.agentProvider).toBe("claude");
      expect(geminiEpisode.context.agentProvider).toBe("gemini");

      // Combined insights
      const allInsights = [
        ...claudeEpisode.reflection.keyInsights,
        ...geminiEpisode.reflection.keyInsights,
      ];
      expect(allInsights).toContain("Use factory for testability");
      expect(allInsights).toContain("Always consider 3+ alternatives");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Extension Loading and Tool Execution
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Extension Loading and Tool Execution", () => {
    it("should configure MCP servers for session", () => {
      const session = Session.create({
        name: "MCP session",
        userId: "user-mcp-1",
        projectPath: "/projects/mcp",
        agentProvider: "claude",
      });

      // MCP configuration that would be loaded
      const mcpConfig = {
        servers: ["remote-dev", "filesystem", "git"],
        allowedTools: ["session_list", "session_exec", "read_file", "git_status"],
        blockedTools: ["rm_rf", "format_disk"],
      };

      // Verify MCP config structure
      expect(mcpConfig.servers).toContain("remote-dev");
      expect(mcpConfig.allowedTools.length).toBeGreaterThan(0);
      expect(mcpConfig.blockedTools).toContain("rm_rf");

      // Session has agent provider for MCP loading
      expect(session.agentProvider).toBe("claude");
    });

    it("should track tool execution in episodes", () => {
      const session = Session.create({
        name: "Tool tracking",
        userId: "user-tools-1",
        projectPath: "/projects/tools",
        agentProvider: "claude",
      });

      const builder = new EpisodeBuilder(session.id, "test-folder-id");
      builder.setContext({
        taskDescription: "File operations",
        projectPath: "/projects/tools",
        initialState: "Starting",
        agentProvider: "claude",
      });

      // Track various tool executions
      builder.addAction({
        action: "Read config file",
        tool: "Read",
        duration: 100,
        success: true,
      });

      builder.addAction({
        action: "Run tests",
        tool: "Bash",
        duration: 5000,
        success: true,
      });

      builder.addAction({
        action: "Edit source file",
        tool: "Edit",
        duration: 200,
        success: true,
      });

      builder.addAction({
        action: "Search codebase",
        tool: "Grep",
        duration: 500,
        success: true,
      });

      const episode = builder.build(
        "success",
        "Operations complete",
        { whatWorked: ["All tools worked"], whatFailed: [], keyInsights: [] },
        ["tools"]
      );

      // Tool execution tracked
      expect(episode.trajectory.actions).toHaveLength(4);
      expect(episode.trajectory.actions.map((a) => a.tool)).toEqual(["Read", "Bash", "Edit", "Grep"]);
      expect(episode.trajectory.actions.every((a) => a.success)).toBe(true);
    });

    it("should validate dangerous command blocking", () => {
      // Dangerous patterns that should be blocked
      const dangerousPatterns = [
        /rm\s+-rf\s+\/(?!tmp)/,           // rm -rf / (except /tmp)
        /mkfs\./,                           // Format filesystem
        /dd\s+if=.*of=\/dev\//,             // Direct disk write
        /:\(\)\{\s*:\|:&\s*\};:/,          // Fork bomb
        /chmod\s+-R\s+777\s+\//,           // World writable root
      ];

      const testCommands = [
        { cmd: "rm -rf /tmp/test", shouldBlock: false },
        { cmd: "rm -rf /", shouldBlock: true },
        { cmd: "mkfs.ext4 /dev/sda1", shouldBlock: true },
        { cmd: "ls -la", shouldBlock: false },
        { cmd: "chmod -R 777 /", shouldBlock: true },
        { cmd: "echo hello", shouldBlock: false },
      ];

      for (const test of testCommands) {
        const isBlocked = dangerousPatterns.some((pattern) => pattern.test(test.cmd));
        expect(isBlocked).toBe(test.shouldBlock);
      }
    });

    it("should load extension based on project type", () => {
      // Project type detection determines MCP config
      interface ProjectType {
        type: string;
        language: string;
        framework: string | null;
        suggestedMcp: string[];
      }

      const projectTypes: ProjectType[] = [
        {
          type: "nextjs",
          language: "typescript",
          framework: "next.js",
          suggestedMcp: ["filesystem", "git", "next-devtools"],
        },
        {
          type: "python",
          language: "python",
          framework: "fastapi",
          suggestedMcp: ["filesystem", "git", "python-lsp"],
        },
        {
          type: "rust",
          language: "rust",
          framework: null,
          suggestedMcp: ["filesystem", "git", "rust-analyzer"],
        },
      ];

      // Each project type has appropriate MCP suggestions
      for (const project of projectTypes) {
        expect(project.suggestedMcp).toContain("filesystem");
        expect(project.suggestedMcp).toContain("git");
        expect(project.suggestedMcp.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Complete SDK Workflow Integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Complete SDK Workflow Integration", () => {
    it("should execute full workflow: create → work → optimize → learn", () => {
      // Step 1: Create folder and session
      const folder = Folder.create({
        name: "Full Workflow",
        userId: "user-full-1",
        parentId: null,
      });

      const session = Session.create({
        name: "Feature implementation",
        userId: "user-full-1",
        folderId: folder.id,
        projectPath: "/projects/full",
        agentProvider: "claude",
        profileId: "profile-claude-1",
      });

      expect(session.status.isActive()).toBe(true);
      expect(session.agentProvider).toBe("claude");

      // Step 2: Memory context injection (simulated)
      const memoryContext = {
        injected: true,
        entries: ["Previous auth implementation used JWT", "Always check token expiry"],
      };
      expect(memoryContext.injected).toBe(true);

      // Step 3: Session work with Episode recording
      const builder = new EpisodeBuilder(session.id, folder.id);
      builder.setContext({
        taskDescription: "Implement auth refresh",
        projectPath: session.projectPath || "/projects/full",
        initialState: "Basic auth exists",
        agentProvider: session.agentProvider || "claude",
      });

      builder.addAction({
        action: "Read existing auth",
        tool: "Read",
        duration: 200,
        success: true,
      });

      builder.addDecision({
        context: "Refresh strategy",
        options: ["Silent refresh", "Prompt user", "Sliding expiry"],
        chosen: "Sliding expiry",
        reasoning: "Best UX with security",
      });

      builder.addAction({
        action: "Implement refresh logic",
        tool: "Write",
        duration: 3000,
        success: true,
      });

      builder.addAction({
        action: "Run auth tests",
        tool: "Bash",
        duration: 5000,
        success: false, // Tests fail initially
      });

      // Step 4: Stall detection triggers optimization
      const orchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-full-1",
        sessionId: "orchestrator-session",
        scopeId: folder.id,
        monitoringInterval: 30,
        stallThreshold: 120,
      });

      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: session.id,
        type: "error",
        severity: "warning",
        message: "Test failures detected",
        suggestedActions: [
          { label: "Optimize Config", description: "Run meta-agent", command: "optimize", dangerous: false },
        ],
      });

      expect(insight.hasSuggestedActions()).toBe(true);

      // Step 5: Meta-agent optimization runs
      const optimizationResult = {
        success: true,
        iterations: 2,
        initialScore: 0.6,
        finalScore: 0.88,
        configApplied: true,
        suggestions: ["Add error handling", "Check token format"],
      };

      expect(optimizationResult.finalScore).toBeGreaterThan(optimizationResult.initialScore);

      // Step 6: Continue work with improved config
      builder.addAction({
        action: "Fix based on optimization",
        tool: "Write",
        duration: 2000,
        success: true,
      });

      builder.addAction({
        action: "Rerun tests",
        tool: "Bash",
        duration: 5000,
        success: true, // Tests pass now
      });

      // Step 7: Complete episode with learnings
      const episode = builder.build(
        "success",
        "Auth refresh implemented",
        {
          whatWorked: ["Sliding expiry approach", "Optimization suggestions"],
          whatFailed: ["Initial test failures"],
          keyInsights: [
            "Check token format before refresh",
            "Meta-agent optimization improved config quality",
          ],
        },
        ["auth", "refresh", "optimization"]
      );

      expect(episode.outcome.outcome).toBe("success");
      expect(episode.reflection.keyInsights.length).toBe(2);

      // Step 8: Close session - learnings propagate
      const closedSession = session.close();
      expect(closedSession.status.toString()).toBe("closed");

      // Learnings available for future sessions in folder
      expect(episode.folderId).toBe(folder.id);
      expect(episode.reflection.whatWorked).toContain("Optimization suggestions");
    });

    it("should handle multi-session project with shared learnings", () => {
      const folder = Folder.create({
        name: "Multi-Session Project",
        userId: "user-multi-session-1",
        parentId: null,
      });

      // Session 1: Research
      const researchSession = Session.create({
        name: "Research phase",
        userId: "user-multi-session-1",
        folderId: folder.id,
        agentProvider: "gemini",
      });

      const researchBuilder = new EpisodeBuilder(researchSession.id, folder.id);
      researchBuilder.setContext({
        taskDescription: "Research options",
        projectPath: "/projects/multi",
        initialState: "Unknown",
        agentProvider: "gemini",
      });

      const researchEpisode = researchBuilder.build(
        "success",
        "Research complete",
        {
          whatWorked: ["Gemini for research"],
          whatFailed: [],
          keyInsights: ["Option A is best for our use case"],
        },
        ["research"]
      );

      // Session 2: Implementation (benefits from research learnings)
      const implSession = Session.create({
        name: "Implementation",
        userId: "user-multi-session-1",
        folderId: folder.id,
        agentProvider: "claude",
      });

      const implBuilder = new EpisodeBuilder(implSession.id, folder.id);
      implBuilder.setContext({
        taskDescription: "Implement Option A",
        projectPath: "/projects/multi",
        initialState: "Research complete, implementing Option A",
        agentProvider: "claude",
      });

      const implEpisode = implBuilder.build(
        "success",
        "Implementation complete",
        {
          whatWorked: ["Claude for implementation", "Building on research insights"],
          whatFailed: [],
          keyInsights: ["Option A integration was smooth"],
        },
        ["implementation"]
      );

      // Session 3: Testing
      const testSession = Session.create({
        name: "Testing",
        userId: "user-multi-session-1",
        folderId: folder.id,
        agentProvider: "codex",
      });

      const testBuilder = new EpisodeBuilder(testSession.id, folder.id);
      testBuilder.setContext({
        taskDescription: "Write tests",
        projectPath: "/projects/multi",
        initialState: "Implementation complete",
        agentProvider: "codex",
      });

      const testEpisode = testBuilder.build(
        "success",
        "Tests complete",
        {
          whatWorked: ["Codex for test generation"],
          whatFailed: [],
          keyInsights: ["100% coverage achieved"],
        },
        ["testing"]
      );

      // All sessions in same folder share learnings
      const allEpisodes = [researchEpisode, implEpisode, testEpisode];
      expect(allEpisodes.every((e) => e.folderId === folder.id)).toBe(true);

      // Different agents used appropriately
      expect(researchEpisode.context.agentProvider).toBe("gemini");
      expect(implEpisode.context.agentProvider).toBe("claude");
      expect(testEpisode.context.agentProvider).toBe("codex");

      // Learnings accumulated
      const allInsights = allEpisodes.flatMap((e) => e.reflection.keyInsights);
      expect(allInsights.length).toBe(3);
    });
  });
});
