import { describe, it, expect } from "bun:test";
import { Session } from "@/domain/entities/Session";
import { SessionStatus } from "@/domain/value-objects/SessionStatus";
import { Folder } from "@/domain/entities/Folder";
import { Episode, EpisodeBuilder } from "@/domain/entities/Episode";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { classifyTask, selectAgentForCategory } from "@/lib/agent-heuristics";

/**
 * E2E Test: Session-Agent Workflow
 * Tests the complete workflow of creating a session with an agent profile,
 * managing the session lifecycle, and recording the work as an episode.
 */
describe("E2E: Session-Agent Workflow", () => {
  describe("Complete Session Lifecycle with Agent", () => {
    it("should complete full session lifecycle from creation to recording", () => {
      // Step 1: Create folder for the session
      const folder = Folder.create({
        name: "Project Alpha",
        userId: "user-workflow-1",
        parentId: null,
      });

      expect(folder.name).toBe("Project Alpha");

      // Step 2: Determine best agent for the task
      const taskTitle = "Implement API authentication";
      const taskDescription = "Build JWT-based auth with refresh tokens";

      const classification = classifyTask(taskTitle, taskDescription);
      const agentRecommendation = selectAgentForCategory(classification.category);

      expect(classification.category).toBe("complex_code");
      expect(agentRecommendation.recommended).toBe("claude");

      // Step 3: Create session with agent
      const session = Session.create({
        name: taskTitle,
        userId: "user-workflow-1",
        folderId: folder.id,
        projectPath: "/projects/alpha",
        agentProvider: agentRecommendation.recommended,
        profileId: "profile-claude-1",
      });

      expect(session.status.isActive()).toBe(true);
      expect(session.agentProvider).toBe("claude");
      expect(session.folderId).toBe(folder.id);

      // Step 4: Session executes work (simulated by Episode recording)
      const episodeBuilder = new EpisodeBuilder(session.id, folder.id);

      episodeBuilder.setContext({
        taskDescription,
        projectPath: session.projectPath || "/projects/alpha",
        initialState: "No authentication",
        agentProvider: session.agentProvider || "claude",
      });

      episodeBuilder.addAction({
        action: "Read existing codebase",
        tool: "Read",
        duration: 500,
        success: true,
      });

      episodeBuilder.addDecision({
        context: "Auth strategy",
        options: ["JWT", "Session", "OAuth"],
        chosen: "JWT",
        reasoning: "Stateless, works with mobile",
      });

      episodeBuilder.addAction({
        action: "Implement auth middleware",
        tool: "Write",
        duration: 5000,
        success: true,
      });

      episodeBuilder.addAction({
        action: "Run tests",
        tool: "Bash",
        duration: 3000,
        success: true,
      });

      const episode = episodeBuilder.build(
        "success",
        "JWT authentication implemented",
        {
          whatWorked: ["JWT approach was clean"],
          whatFailed: [],
          keyInsights: ["Use refresh token rotation"],
        },
        ["auth", "jwt"]
      );

      // Step 5: Suspend session
      const suspendedSession = session.suspend();
      expect(suspendedSession.status.toString()).toBe("suspended");

      // Step 6: Resume session
      const resumedSession = suspendedSession.resume();
      expect(resumedSession.status.isActive()).toBe(true);

      // Step 7: Close session
      const closedSession = resumedSession.close();
      expect(closedSession.status.toString()).toBe("closed");

      // Step 8: Verify episode captures the work
      expect(episode.taskId).toBe(session.id);
      expect(episode.folderId).toBe(folder.id);
      expect(episode.context.agentProvider).toBe("claude");
      expect(episode.outcome.outcome).toBe("success");
    });

    it("should handle session with orchestrator monitoring", () => {
      // Create folder and session
      const folder = Folder.create({
        name: "Project Beta",
        userId: "user-monitored-1",
        parentId: null,
      });

      const session = Session.create({
        name: "Long-running task",
        userId: "user-monitored-1",
        folderId: folder.id,
        projectPath: "/projects/beta",
        agentProvider: "gemini",
      });

      // Create orchestrator for the folder
      const orchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-monitored-1",
        sessionId: "orchestrator-session",
        scopeId: folder.id,
        monitoringInterval: 15,
        stallThreshold: 120,
      });

      expect(orchestrator.isInScope(folder.id)).toBe(true);

      // Simulate monitoring cycle detecting stall
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: session.id,
        type: "stall_detected",
        severity: "warning",
        message: "Session appears stalled - no activity for 2 minutes",
        suggestedActions: [
          { label: "Send Enter", description: "Send Enter key to resume session", command: "", dangerous: false },
        ],
      });

      expect(insight.sessionId).toBe(session.id);
      expect(insight.hasSuggestedActions()).toBe(true);

      // Resolve after intervention
      const resolvedInsight = insight.resolve();
      expect(resolvedInsight.resolved).toBe(true);
    });
  });

  describe("Multi-Agent Session Management", () => {
    it("should manage multiple sessions with different agents", () => {
      const folder = Folder.create({
        name: "Multi-Agent Project",
        userId: "user-multi-1",
        parentId: null,
      });

      // Create sessions with different agents for different tasks
      const researchSession = Session.create({
        name: "Research caching options",
        userId: "user-multi-1",
        folderId: folder.id,
        projectPath: "/projects/multi",
        agentProvider: "gemini",
      });

      const implementSession = Session.create({
        name: "Implement cache layer",
        userId: "user-multi-1",
        folderId: folder.id,
        projectPath: "/projects/multi",
        agentProvider: "claude",
      });

      const testSession = Session.create({
        name: "Write cache tests",
        userId: "user-multi-1",
        folderId: folder.id,
        projectPath: "/projects/multi",
        agentProvider: "codex",
      });

      expect(researchSession.agentProvider).toBe("gemini");
      expect(implementSession.agentProvider).toBe("claude");
      expect(testSession.agentProvider).toBe("codex");

      // All sessions in same folder
      expect(researchSession.folderId).toBe(folder.id);
      expect(implementSession.folderId).toBe(folder.id);
      expect(testSession.folderId).toBe(folder.id);
    });

    it("should record episodes for each agent session", () => {
      const folder = Folder.create({
        name: "Episode Recording",
        userId: "user-episodes-1",
        parentId: null,
      });

      // Gemini research session
      const geminiSession = Session.create({
        name: "Research patterns",
        userId: "user-episodes-1",
        folderId: folder.id,
        agentProvider: "gemini",
      });

      const geminiBuilder = new EpisodeBuilder(geminiSession.id, folder.id);
      geminiBuilder.setContext({
        taskDescription: "Research patterns",
        projectPath: "/projects",
        initialState: "Starting research",
        agentProvider: "gemini",
      });
      geminiBuilder.addAction({
        action: "Web search",
        tool: "WebSearch",
        duration: 2000,
        success: true,
      });
      const geminiEpisode = geminiBuilder.build(
        "success",
        "Research complete",
        { whatWorked: ["Found patterns"], whatFailed: [], keyInsights: ["Use factory"] },
        ["research"]
      );

      // Claude implementation session
      const claudeSession = Session.create({
        name: "Implement patterns",
        userId: "user-episodes-1",
        folderId: folder.id,
        agentProvider: "claude",
      });

      const claudeBuilder = new EpisodeBuilder(claudeSession.id, folder.id);
      claudeBuilder.setContext({
        taskDescription: "Implement patterns",
        projectPath: "/projects",
        initialState: "After research",
        agentProvider: "claude",
      });
      claudeBuilder.addAction({
        action: "Write code",
        tool: "Write",
        duration: 5000,
        success: true,
      });
      const claudeEpisode = claudeBuilder.build(
        "success",
        "Implementation complete",
        { whatWorked: ["Factory pattern"], whatFailed: [], keyInsights: ["Clean design"] },
        ["implementation"]
      );

      // Verify episodes track different agents
      expect(geminiEpisode.context.agentProvider).toBe("gemini");
      expect(claudeEpisode.context.agentProvider).toBe("claude");

      // Both belong to same folder
      expect(geminiEpisode.folderId).toBe(folder.id);
      expect(claudeEpisode.folderId).toBe(folder.id);
    });
  });

  describe("Session State Transitions", () => {
    it("should enforce valid state transitions", () => {
      const session = Session.create({
        name: "State transition test",
        userId: "user-state-1",
        projectPath: "/projects/test",
      });

      // Active -> Suspended
      const suspended = session.suspend();
      expect(suspended.status.toString()).toBe("suspended");

      // Suspended -> Active (resume)
      const resumed = suspended.resume();
      expect(resumed.status.isActive()).toBe(true);

      // Active -> Closed
      const closed = resumed.close();
      expect(closed.status.toString()).toBe("closed");

      // Cannot transition from closed
      expect(() => closed.suspend()).toThrow();
      expect(() => closed.resume()).toThrow();
    });

    it("should track timestamps through transitions", () => {
      let session = Session.create({
        name: "Timestamp tracking",
        userId: "user-timestamps-1",
        projectPath: "/projects/test",
      });

      const createdAt = session.createdAt;
      expect(createdAt).toBeInstanceOf(Date);

      // Suspend
      session = session.suspend();
      expect(session.status.toString()).toBe("suspended");

      // Resume
      session = session.resume();
      expect(session.status.isActive()).toBe(true);

      // Close
      session = session.close();
      expect(session.status.toString()).toBe("closed");

      // Created timestamp preserved
      expect(session.createdAt).toEqual(createdAt);
    });
  });

  describe("Folder-Session Organization", () => {
    it("should organize sessions in folder hierarchy", () => {
      // Create folder hierarchy
      const rootFolder = Folder.create({
        name: "Root Project",
        userId: "user-folders-1",
        parentId: null,
      });

      const frontendFolder = Folder.create({
        name: "Frontend",
        userId: "user-folders-1",
        parentId: rootFolder.id,
      });

      const backendFolder = Folder.create({
        name: "Backend",
        userId: "user-folders-1",
        parentId: rootFolder.id,
      });

      expect(frontendFolder.parentId).toBe(rootFolder.id);
      expect(backendFolder.parentId).toBe(rootFolder.id);

      // Create sessions in different folders
      const frontendSession = Session.create({
        name: "Build UI",
        userId: "user-folders-1",
        folderId: frontendFolder.id,
        agentProvider: "claude",
      });

      const backendSession = Session.create({
        name: "Build API",
        userId: "user-folders-1",
        folderId: backendFolder.id,
        agentProvider: "claude",
      });

      expect(frontendSession.folderId).toBe(frontendFolder.id);
      expect(backendSession.folderId).toBe(backendFolder.id);
    });

    it("should move session between folders", () => {
      const folder1 = Folder.create({
        name: "Folder 1",
        userId: "user-move-1",
        parentId: null,
      });

      const folder2 = Folder.create({
        name: "Folder 2",
        userId: "user-move-1",
        parentId: null,
      });

      let session = Session.create({
        name: "Movable session",
        userId: "user-move-1",
        folderId: folder1.id,
      });

      expect(session.folderId).toBe(folder1.id);

      // Move to folder 2
      session = session.moveToFolder(folder2.id);
      expect(session.folderId).toBe(folder2.id);

      // Move to no folder
      session = session.moveToFolder(null);
      expect(session.folderId).toBeNull();
    });
  });

  describe("Agent Profile Integration", () => {
    it("should associate session with agent profile", () => {
      const session = Session.create({
        name: "Profile-linked session",
        userId: "user-profile-1",
        projectPath: "/projects/profile",
        agentProvider: "claude",
        profileId: "profile-claude-custom-1",
      });

      expect(session.agentProvider).toBe("claude");
      expect(session.profileId).toBe("profile-claude-custom-1");

      // Episode should capture agent info
      const builder = new EpisodeBuilder(session.id, "folder-profile");
      builder.setContext({
        taskDescription: "Task with custom profile",
        projectPath: session.projectPath || "/projects/profile",
        initialState: "Starting",
        agentProvider: session.agentProvider || "claude",
      });

      const episode = builder.build(
        "success",
        "Complete",
        { whatWorked: [], whatFailed: [], keyInsights: [] },
        []
      );

      expect(episode.context.agentProvider).toBe("claude");
    });

    it("should allow session without agent profile", () => {
      const session = Session.create({
        name: "No-profile session",
        userId: "user-no-profile-1",
        projectPath: "/projects/simple",
      });

      expect(session.agentProvider).toBeNull();
      expect(session.profileId).toBeNull();

      // Session still works without agent
      const suspended = session.suspend();
      expect(suspended.status.toString()).toBe("suspended");
    });
  });
});
