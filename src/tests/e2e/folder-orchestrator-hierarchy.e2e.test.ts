import { describe, it, expect } from "bun:test";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";

/**
 * E2E Test: Folder Orchestrator Hierarchy
 * Tests the complete workflow of master and folder orchestrator hierarchy,
 * including scope management, priority resolution, and coordinated monitoring.
 */
describe("E2E: Folder Orchestrator Hierarchy", () => {
  describe("Master and Sub-Orchestrator Coordination", () => {
    it("should establish and manage orchestrator hierarchy", () => {
      // Step 1: Create Master Control orchestrator
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-hierarchy-1",
        sessionId: "master-session",
        monitoringInterval: 30,
        stallThreshold: 300,
        autoIntervention: false,
      });

      expect(masterOrchestrator.isMaster()).toBe(true);
      expect(masterOrchestrator.scopeType).toBeNull(); // Master has no scope

      // Step 2: Create sub-orchestrators for specific folders
      const frontendOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-hierarchy-1",
        sessionId: "frontend-session",
        scopeId: "folder-frontend",
        monitoringInterval: 15, // Faster for active development
        stallThreshold: 180,
      });

      const backendOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-hierarchy-1",
        sessionId: "backend-session",
        scopeId: "folder-backend",
        monitoringInterval: 20,
        stallThreshold: 240,
      });

      expect(frontendOrchestrator.isSubOrchestrator()).toBe(true);
      expect(backendOrchestrator.isSubOrchestrator()).toBe(true);
      expect(frontendOrchestrator.scopeId).toBe("folder-frontend");

      // Step 3: Verify scope checking
      // Master monitors everything
      expect(masterOrchestrator.isInScope("folder-frontend")).toBe(true);
      expect(masterOrchestrator.isInScope("folder-backend")).toBe(true);
      expect(masterOrchestrator.isInScope("folder-other")).toBe(true);

      // Sub-orchestrators only monitor their folder
      expect(frontendOrchestrator.isInScope("folder-frontend")).toBe(true);
      expect(frontendOrchestrator.isInScope("folder-backend")).toBe(false);
      expect(backendOrchestrator.isInScope("folder-backend")).toBe(true);
      expect(backendOrchestrator.isInScope("folder-frontend")).toBe(false);
    });

    it("should handle overlapping monitoring with priority resolution", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-priority-1",
        sessionId: "master-session",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      const folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-priority-1",
        sessionId: "folder-session",
        scopeId: "folder-active",
        monitoringInterval: 10, // Much faster
        stallThreshold: 120, // Much shorter
      });

      // Simulate session in folder-active scope
      const sessionInFolder = "session-in-active-folder";

      // Both can monitor, but folder orchestrator should take priority
      // (In practice, the application layer handles priority)

      // Master with default settings
      expect(masterOrchestrator.monitoringInterval).toBe(30);
      expect(masterOrchestrator.stallThreshold).toBe(300);

      // Folder with custom settings
      expect(folderOrchestrator.monitoringInterval).toBe(10);
      expect(folderOrchestrator.stallThreshold).toBe(120);

      // Create insight from folder orchestrator (higher priority)
      const insight = OrchestratorInsight.create({
        orchestratorId: folderOrchestrator.id,
        sessionId: sessionInFolder,
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled - detected by folder orchestrator",
      });

      expect(insight.orchestratorId).toBe(folderOrchestrator.id);
    });
  });

  describe("Hierarchical Insight Management", () => {
    it("should track insights across orchestrator hierarchy", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-insights-1",
        sessionId: "master-session",
      });

      const folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-insights-1",
        sessionId: "folder-session",
        scopeId: "folder-project-a",
      });

      // Create insights from different orchestrators
      const masterInsight = OrchestratorInsight.create({
        orchestratorId: masterOrchestrator.id,
        sessionId: "orphan-session", // Not in any folder
        type: "stall_detected",
        severity: "info",
        message: "Orphan session may be stalled",
      });

      const folderInsight = OrchestratorInsight.create({
        orchestratorId: folderOrchestrator.id,
        sessionId: "folder-session-1",
        type: "stall_detected",
        severity: "warning",
        message: "Project A session stalled",
      });

      // Create aggregated view (simulating repository query)
      const allInsights = [masterInsight, folderInsight];
      const unresolvedInsights = allInsights.filter((i) => !i.resolved);

      expect(unresolvedInsights).toHaveLength(2);

      // Resolve folder insight
      const resolvedFolderInsight = folderInsight.resolve();
      const updatedInsights = [masterInsight, resolvedFolderInsight];
      const stillUnresolved = updatedInsights.filter((i) => !i.resolved);

      expect(stillUnresolved).toHaveLength(1);
      expect(stillUnresolved[0].orchestratorId).toBe(masterOrchestrator.id);
    });

    it("should aggregate audit logs across hierarchy", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-audit-1",
        sessionId: "master-session",
      });

      const folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-audit-1",
        sessionId: "folder-session",
        scopeId: "folder-audited",
      });

      // Generate audit trail across both orchestrators
      const auditLogs: OrchestratorAuditLog[] = [];

      // Master orchestrator actions
      auditLogs.push(
        OrchestratorAuditLog.forStatusChanged(masterOrchestrator.id, "idle", "analyzing")
      );
      auditLogs.push(
        OrchestratorAuditLog.forSessionMonitored(masterOrchestrator.id, "session-global", "healthy")
      );

      // Folder orchestrator actions
      auditLogs.push(
        OrchestratorAuditLog.forStatusChanged(folderOrchestrator.id, "idle", "analyzing")
      );
      auditLogs.push(
        OrchestratorAuditLog.forSessionMonitored(folderOrchestrator.id, "session-folder", "stalled")
      );

      const folderInsight = OrchestratorInsight.create({
        orchestratorId: folderOrchestrator.id,
        sessionId: "session-folder",
        type: "stall_detected",
        severity: "warning",
        message: "Stall detected",
      });

      auditLogs.push(
        OrchestratorAuditLog.forInsightGenerated(
          folderOrchestrator.id,
          folderInsight.id,
          "session-folder",
          "stall_detected",
          "warning"
        )
      );

      auditLogs.push(
        OrchestratorAuditLog.forCommandInjected(
          folderOrchestrator.id,
          "session-folder",
          "",
          "Resume stalled session"
        )
      );

      // Filter by orchestrator
      const masterLogs = auditLogs.filter((l) => l.orchestratorId === masterOrchestrator.id);
      const folderLogs = auditLogs.filter((l) => l.orchestratorId === folderOrchestrator.id);

      expect(masterLogs).toHaveLength(2);
      expect(folderLogs).toHaveLength(4);

      // Filter by action type
      const commandInjections = auditLogs.filter((l) => l.isCommandInjection());
      expect(commandInjections).toHaveLength(1);

      const sessionMonitorings = auditLogs.filter((l) => l.isSessionMonitoring());
      expect(sessionMonitorings).toHaveLength(2);
    });
  });

  describe("Configuration Inheritance and Override", () => {
    it("should allow folder-specific configuration overrides", () => {
      // Master with base configuration
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-config-1",
        sessionId: "master-session",
        monitoringInterval: 60,
        stallThreshold: 600,
        autoIntervention: false,
      });

      // Folder A: Development - faster checks, shorter threshold
      const devFolderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-config-1",
        sessionId: "dev-session",
        scopeId: "folder-dev",
        monitoringInterval: 10,
        stallThreshold: 120,
        autoIntervention: true, // More aggressive
      });

      // Folder B: Production - slower checks, longer threshold
      const prodFolderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-config-1",
        sessionId: "prod-session",
        scopeId: "folder-prod",
        monitoringInterval: 120,
        stallThreshold: 900,
        autoIntervention: false, // Conservative
      });

      // Verify configurations
      expect(masterOrchestrator.monitoringInterval).toBe(60);
      expect(devFolderOrchestrator.monitoringInterval).toBe(10);
      expect(prodFolderOrchestrator.monitoringInterval).toBe(120);

      expect(devFolderOrchestrator.autoIntervention).toBe(true);
      expect(prodFolderOrchestrator.autoIntervention).toBe(false);
    });

    it("should support runtime configuration updates", () => {
      let folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-runtime-1",
        sessionId: "folder-session",
        scopeId: "folder-dynamic",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      // Start monitoring
      folderOrchestrator = folderOrchestrator.startAnalyzing();
      expect(folderOrchestrator.status).toBe("analyzing");

      // Update configuration while running
      folderOrchestrator = folderOrchestrator.updateConfig({
        monitoringInterval: 15,
        stallThreshold: 180,
      });

      // Should still be in analyzing state
      expect(folderOrchestrator.status).toBe("analyzing");
      expect(folderOrchestrator.monitoringInterval).toBe(15);
      expect(folderOrchestrator.stallThreshold).toBe(180);
    });
  });

  describe("Lifecycle Synchronization", () => {
    it("should handle concurrent orchestrator state changes", () => {
      // Create hierarchy
      let masterOrchestrator = Orchestrator.createMaster({
        userId: "user-sync-1",
        sessionId: "master-session",
      });

      let folder1Orchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-sync-1",
        sessionId: "folder1-session",
        scopeId: "folder-1",
      });

      let folder2Orchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-sync-1",
        sessionId: "folder2-session",
        scopeId: "folder-2",
      });

      // Start all orchestrators
      masterOrchestrator = masterOrchestrator.startAnalyzing();
      folder1Orchestrator = folder1Orchestrator.startAnalyzing();
      folder2Orchestrator = folder2Orchestrator.startAnalyzing();

      expect(masterOrchestrator.status).toBe("analyzing");
      expect(folder1Orchestrator.status).toBe("analyzing");
      expect(folder2Orchestrator.status).toBe("analyzing");

      // Pause master (might be for maintenance)
      masterOrchestrator = masterOrchestrator.pause();
      expect(masterOrchestrator.status).toBe("paused");

      // Folder orchestrators continue independently
      expect(folder1Orchestrator.status).toBe("analyzing");
      expect(folder2Orchestrator.status).toBe("analyzing");

      // Folder 1 takes action
      folder1Orchestrator = folder1Orchestrator.startActing();
      expect(folder1Orchestrator.status).toBe("acting");

      // Folder 2 continues monitoring
      expect(folder2Orchestrator.status).toBe("analyzing");

      // Complete action and return to idle
      folder1Orchestrator = folder1Orchestrator.returnToIdle();
      expect(folder1Orchestrator.status).toBe("idle");

      // Resume master
      masterOrchestrator = masterOrchestrator.resume();
      expect(masterOrchestrator.status).toBe("idle");
    });

    it("should track activity timestamps independently", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-activity-1",
        sessionId: "master-session",
      });

      let folderOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-activity-1",
        sessionId: "folder-session",
        scopeId: "folder-activity",
      });

      // Both should have valid timestamps
      expect(masterOrchestrator.lastActivityAt).toBeInstanceOf(Date);
      expect(folderOrchestrator.lastActivityAt).toBeInstanceOf(Date);

      // Touch only folder orchestrator - returns new instance
      const originalFolder = folderOrchestrator;
      folderOrchestrator = folderOrchestrator.touch();

      // Original master unchanged, new folder instance created
      expect(masterOrchestrator.lastActivityAt).toBeInstanceOf(Date);
      expect(folderOrchestrator).not.toBe(originalFolder); // Immutable
      expect(folderOrchestrator.lastActivityAt).toBeInstanceOf(Date);
    });
  });

  describe("Scope-Based Session Routing", () => {
    it("should correctly route sessions to appropriate orchestrators", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-routing-1",
        sessionId: "master-session",
      });

      const projectAOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-routing-1",
        sessionId: "project-a-session",
        scopeId: "folder-project-a",
      });

      const projectBOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-routing-1",
        sessionId: "project-b-session",
        scopeId: "folder-project-b",
      });

      // Define sessions and their folders
      const sessions = [
        { id: "session-1", folderId: "folder-project-a" },
        { id: "session-2", folderId: "folder-project-b" },
        { id: "session-3", folderId: "folder-project-a" },
        { id: "session-4", folderId: null }, // No folder
        { id: "session-5", folderId: "folder-other" }, // Different folder
      ];

      const orchestrators = [masterOrchestrator, projectAOrchestrator, projectBOrchestrator];

      // Route each session to its orchestrators
      const routing = sessions.map((session) => {
        const applicableOrchestrators = orchestrators.filter((o) =>
          o.isInScope(session.folderId)
        );
        return {
          sessionId: session.id,
          orchestrators: applicableOrchestrators.map((o) => ({
            id: o.id,
            type: o.type,
            scopeId: o.scopeId,
          })),
        };
      });

      // Session 1: Should be handled by master and project-a
      const session1Route = routing.find((r) => r.sessionId === "session-1");
      expect(session1Route?.orchestrators).toHaveLength(2);

      // Session 4: Only master (no folder)
      const session4Route = routing.find((r) => r.sessionId === "session-4");
      expect(session4Route?.orchestrators).toHaveLength(1);
      expect(session4Route?.orchestrators[0].type).toBe("master");

      // Session 5: Only master (different folder, no sub-orchestrator)
      const session5Route = routing.find((r) => r.sessionId === "session-5");
      expect(session5Route?.orchestrators).toHaveLength(1);
    });
  });
});
