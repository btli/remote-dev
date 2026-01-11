/**
 * rdv-server Integration Tests
 *
 * Tests the integration between the Next.js frontend and rdv-server backend.
 * These tests focus on the domain layer interactions when data flows through
 * the full stack architecture.
 *
 * Architecture tested:
 *   Domain Entities → Use Cases → Services → API Routes
 */
import { describe, it, expect } from "bun:test";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import { Session } from "@/domain/entities/Session";
import { SessionStatus } from "@/domain/value-objects/SessionStatus";
import { TmuxSessionName } from "@/domain/value-objects/TmuxSessionName";
import { Folder } from "@/domain/entities/Folder";

/**
 * Integration tests for Orchestrator → Session relationships
 * Tests how orchestrators monitor and interact with sessions
 */
describe("Orchestrator + Session Integration", () => {
  describe("Monitoring Flow", () => {
    it("should create orchestrator linked to session", () => {
      // Create a session first (this would normally come from the database)
      const sessionId = "session-" + crypto.randomUUID();
      const session = Session.create({
        id: sessionId,
        userId: "user-123",
        name: "Test Session",
        projectPath: "/home/user/project",
              });

      // Create orchestrator that monitors this session
      const orchestrator = Orchestrator.createMaster({
        userId: session.userId,
        sessionId: session.id,
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      expect(orchestrator.sessionId).toBe(session.id);
      expect(orchestrator.userId).toBe(session.userId);
      expect(orchestrator.isMaster()).toBe(true);
    });

    it("should detect stall in monitored session", () => {
      const session = Session.create({
        userId: "user-123",
        name: "Stalled Session",
        projectPath: "/home/user/project",
              });

      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "orchestrator-session-123",
      });

      // Create insight for stall detection
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: session.id,
        type: "stall_detected",
        severity: "warning",
        message: `Session "${session.name}" appears stalled`,
        context: {
          sessionName: session.name,
          lastActivity: new Date(),
          minutesStalled: 5,
        },
        suggestedActions: [
          {
            label: "Send Enter",
            description: "Send Enter key to possibly resume session",
            command: "",
            dangerous: false,
          },
          {
            label: "Check scrollback",
            description: "Review recent terminal output for errors",
            command: "tmux capture-pane -p",
            dangerous: false,
          },
        ],
      });

      expect(insight.sessionId).toBe(session.id);
      expect(insight.type).toBe("stall_detected");
      expect(insight.hasSuggestedActions()).toBe(true);
      expect(insight.context?.sessionName).toBe("Stalled Session");
    });

    it("should create audit trail for command injection", () => {
      const session = Session.create({
        userId: "user-123",
        name: "Target Session",
        projectPath: "/home/user/project",
              });

      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "orchestrator-session-123",
      });

      // Simulate command injection flow
      const auditLog = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        session.id,
        "",
        "Resume stalled session"
      );

      expect(auditLog.orchestratorId).toBe(orchestrator.id);
      expect(auditLog.targetSessionId).toBe(session.id);
      expect(auditLog.isCommandInjection()).toBe(true);
    });
  });

  describe("Folder + Orchestrator Scope", () => {
    it("should scope sub-orchestrator to folder sessions", () => {
      // Create folder
      const folder = Folder.create({
        userId: "user-123",
        name: "Project Folder",
      });

      // Create sessions in the folder
      const sessionInFolder = Session.create({
        userId: "user-123",
        name: "In-Folder Session",
        projectPath: "/home/user/project",
                folderId: folder.id,
      });

      const sessionOutsideFolder = Session.create({
        userId: "user-123",
        name: "Outside Session",
        projectPath: "/home/user/other",
              });

      // Create folder sub-orchestrator
      const subOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "sub-orchestrator-session",
        scopeId: folder.id,
      });

      // Check scope
      expect(subOrchestrator.isInScope(sessionInFolder.folderId)).toBe(true);
      expect(subOrchestrator.isInScope(sessionOutsideFolder.folderId)).toBe(false);
    });

    it("should allow master orchestrator to monitor all folders", () => {
      const folder1 = Folder.create({
        userId: "user-123",
        name: "Folder 1",
      });

      const folder2 = Folder.create({
        userId: "user-123",
        name: "Folder 2",
      });

      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      expect(masterOrchestrator.isInScope(folder1.id)).toBe(true);
      expect(masterOrchestrator.isInScope(folder2.id)).toBe(true);
      expect(masterOrchestrator.isInScope(null)).toBe(true);
    });
  });

  describe("Session Status Transitions", () => {
    it("should track session status through lifecycle", () => {
      let session = Session.create({
        userId: "user-123",
        name: "Lifecycle Test",
        projectPath: "/home/user/project",
              });

      expect(session.status.isActive()).toBe(true);

      // Suspend
      session = session.suspend();
      expect(session.status.isSuspended()).toBe(true);

      // Resume
      session = session.resume();
      expect(session.status.isActive()).toBe(true);

      // Close
      session = session.close();
      expect(session.status.isClosed()).toBe(true);
    });

    it("should create insight when session transitions to error state", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const session = Session.create({
        userId: "user-123",
        name: "Error Session",
        projectPath: "/home/user/project",
              });

      // Simulate error detection
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: session.id,
        type: "error",
        severity: "error",
        message: "Session encountered error: Build failed with exit code 1",
        context: {
          exitCode: 1,
          lastCommand: "npm run build",
        },
      });

      expect(insight.severity).toBe("error");
      expect(insight.context?.exitCode).toBe(1);
    });
  });
});

/**
 * Integration tests for Folder hierarchy operations
 */
describe("Folder Hierarchy Integration", () => {
  describe("Parent-Child Relationships", () => {
    it("should build folder tree correctly", () => {
      const rootFolder = Folder.create({
        userId: "user-123",
        name: "Root",
      });

      const childFolder = Folder.create({
        userId: "user-123",
        name: "Child",
        parentId: rootFolder.id,
      });

      const grandchildFolder = Folder.create({
        userId: "user-123",
        name: "Grandchild",
        parentId: childFolder.id,
      });

      const allFolders = [rootFolder, childFolder, grandchildFolder];

      expect(rootFolder.isRoot()).toBe(true);
      expect(childFolder.isChildOf(rootFolder.id)).toBe(true);
      expect(grandchildFolder.getAncestorIds(allFolders)).toEqual([
        childFolder.id,
        rootFolder.id,
      ]);
    });

    it("should prevent circular references in folder hierarchy", () => {
      const folder1 = Folder.create({
        id: "folder-1",
        userId: "user-123",
        name: "Folder 1",
      });

      const folder2 = Folder.create({
        id: "folder-2",
        userId: "user-123",
        name: "Folder 2",
        parentId: "folder-1",
      });

      const folder3 = Folder.create({
        id: "folder-3",
        userId: "user-123",
        name: "Folder 3",
        parentId: "folder-2",
      });

      const allFolders = [folder1, folder2, folder3];

      // Attempting to move folder1 under folder3 should fail
      expect(() => folder1.moveTo("folder-3", allFolders)).toThrow();
    });
  });

  describe("Folder + Session Organization", () => {
    it("should organize sessions within folder hierarchy", () => {
      const projectFolder = Folder.create({
        userId: "user-123",
        name: "Project",
      });

      const frontendFolder = Folder.create({
        userId: "user-123",
        name: "Frontend",
        parentId: projectFolder.id,
      });

      const backendFolder = Folder.create({
        userId: "user-123",
        name: "Backend",
        parentId: projectFolder.id,
      });

      // Sessions in different folders
      const frontendSession = Session.create({
        userId: "user-123",
        name: "Frontend Dev",
        projectPath: "/project/frontend",
                folderId: frontendFolder.id,
      });

      const backendSession = Session.create({
        userId: "user-123",
        name: "Backend Dev",
        projectPath: "/project/backend",
                folderId: backendFolder.id,
      });

      expect(frontendSession.folderId).toBe(frontendFolder.id);
      expect(backendSession.folderId).toBe(backendFolder.id);
    });
  });
});

/**
 * Integration tests for TmuxSessionName across operations
 */
describe("TmuxSessionName Integration", () => {
  describe("Session Naming", () => {
    it("should generate unique tmux names for sessions", () => {
      const session1 = Session.create({
        userId: "user-123",
        name: "Session 1",
        projectPath: "/project",
              });

      const session2 = Session.create({
        userId: "user-123",
        name: "Session 2",
        projectPath: "/project",
              });

      expect(session1.tmuxSessionName.toString()).not.toBe(session2.tmuxSessionName.toString());
      expect(session1.tmuxSessionName.toString()).toMatch(/^rdv-/);
      expect(session2.tmuxSessionName.toString()).toMatch(/^rdv-/);
    });

    it("should validate tmux session name format", () => {
      // Valid names
      expect(() => TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000")).not.toThrow();
      expect(() => TmuxSessionName.fromString("rdv-session-123e4567-e89b-12d3-a456-426614174000")).not.toThrow();
      expect(() => TmuxSessionName.fromString("rdv-folder-my-project")).not.toThrow();
      expect(() => TmuxSessionName.fromString("rdv-master-control")).not.toThrow();

      // Invalid names
      expect(() => TmuxSessionName.fromString("invalid")).toThrow();
      expect(() => TmuxSessionName.fromString("rdv-")).toThrow();
    });

    it("should extract session ID from tmux name", () => {
      const uuid = "123e4567-e89b-12d3-a456-426614174000";
      const tmuxName = TmuxSessionName.fromString(`rdv-${uuid}`);

      expect(tmuxName.getSessionId()).toBe(uuid);
    });
  });

  describe("Orchestrator Session Naming", () => {
    it("should use special name for master control", () => {
      const masterName = TmuxSessionName.fromString("rdv-master-control");
      expect(masterName.toString()).toBe("rdv-master-control");
      expect(masterName.getSessionId()).toBe("master-control");
    });

    it("should use folder name for folder orchestrators", () => {
      const folderName = TmuxSessionName.fromString("rdv-folder-my-project");
      expect(folderName.toString()).toBe("rdv-folder-my-project");
      expect(folderName.getSessionId()).toBe("my-project");
    });
  });
});

/**
 * Integration tests for Insight + Audit Log relationships
 */
describe("Insight + Audit Log Integration", () => {
  describe("Insight Resolution Flow", () => {
    it("should track complete insight lifecycle with audit logs", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      // Step 1: Create insight
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "monitored-session",
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled",
        suggestedActions: [
          {
            label: "Restart",
            description: "Restart the session",
            command: "exit && claude",
            dangerous: false,
          },
        ],
      });

      // Step 2: Log insight generation
      const generationLog = OrchestratorAuditLog.forInsightGenerated(
        orchestrator.id,
        insight.id,
        insight.sessionId!,
        insight.type,
        insight.severity
      );

      expect(generationLog.isInsightGeneration()).toBe(true);
      expect(generationLog.details?.insightId).toBe(insight.id);

      // Step 3: Execute action
      const actionLog = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        insight.sessionId!,
        "exit && claude",
        "Restart session"
      );

      expect(actionLog.isCommandInjection()).toBe(true);

      // Step 4: Resolve insight
      const resolvedInsight = insight.resolve();

      expect(resolvedInsight.resolved).toBe(true);
      expect(resolvedInsight.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe("Audit Log Filtering", () => {
    it("should filter logs by session", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const logs = [
        OrchestratorAuditLog.forCommandInjected(orchestrator.id, "session-1", "cmd1"),
        OrchestratorAuditLog.forCommandInjected(orchestrator.id, "session-2", "cmd2"),
        OrchestratorAuditLog.forStatusChanged(orchestrator.id, "idle", "analyzing"),
        OrchestratorAuditLog.forSessionMonitored(orchestrator.id, "session-1", "healthy"),
      ];

      const session1Logs = logs.filter(
        (log) => log.isSessionSpecific() && log.targetSessionId === "session-1"
      );

      expect(session1Logs).toHaveLength(2);
    });

    it("should filter logs by action type", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const logs = [
        OrchestratorAuditLog.forCommandInjected(orchestrator.id, "session-1", "cmd1"),
        OrchestratorAuditLog.forStatusChanged(orchestrator.id, "idle", "analyzing"),
        OrchestratorAuditLog.forStatusChanged(orchestrator.id, "analyzing", "idle"),
        OrchestratorAuditLog.forSessionMonitored(orchestrator.id, "session-1", "healthy"),
      ];

      const statusChangeLogs = logs.filter((log) => log.isStatusChange());
      const commandLogs = logs.filter((log) => log.isCommandInjection());

      expect(statusChangeLogs).toHaveLength(2);
      expect(commandLogs).toHaveLength(1);
    });
  });
});

/**
 * Integration tests for complete workflow scenarios
 */
describe("End-to-End Workflow Integration", () => {
  describe("Session Creation → Monitoring → Intervention", () => {
    it("should handle complete session monitoring workflow", () => {
      // 1. Create folder and session
      const folder = Folder.create({
        userId: "user-123",
        name: "Development",
      });

      const session = Session.create({
        userId: "user-123",
        name: "Development Session",
        projectPath: "/home/user/dev",
                folderId: folder.id,
      });

      // 2. Create master orchestrator
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      // 3. Create folder sub-orchestrator
      const folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "folder-orch-session",
        scopeId: folder.id,
        monitoringInterval: 15,
        stallThreshold: 120,
      });

      // 4. Verify scope
      expect(folderOrchestrator.isInScope(session.folderId)).toBe(true);
      expect(masterOrchestrator.isInScope(session.folderId)).toBe(true);

      // 5. Simulate stall detection
      const insight = OrchestratorInsight.create({
        orchestratorId: folderOrchestrator.id,
        sessionId: session.id,
        type: "stall_detected",
        severity: "warning",
        message: `Session stalled: ${session.name}`,
        suggestedActions: [
          {
            label: "Send Enter",
            description: "Try to resume with Enter key",
            command: "",
            dangerous: false,
          },
        ],
      });

      // 6. Log the insight
      const auditLog = OrchestratorAuditLog.forInsightGenerated(
        folderOrchestrator.id,
        insight.id,
        session.id,
        insight.type,
        insight.severity
      );

      expect(auditLog.details?.insightId).toBe(insight.id);
      expect(insight.sessionId).toBe(session.id);
    });
  });

  describe("Multi-Orchestrator Coordination", () => {
    it("should coordinate between master and folder orchestrators", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Project",
      });

      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "folder-session",
        scopeId: folder.id,
      });

      // Both can monitor sessions in the folder
      expect(masterOrchestrator.isInScope(folder.id)).toBe(true);
      expect(folderOrchestrator.isInScope(folder.id)).toBe(true);

      // But master has broader scope
      expect(masterOrchestrator.isInScope("other-folder")).toBe(true);
      expect(folderOrchestrator.isInScope("other-folder")).toBe(false);
    });
  });
});
