import { describe, it, expect } from "bun:test";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";

/**
 * Integration tests for Orchestrator workflow
 * Tests the interaction between Orchestrator, OrchestratorInsight, and OrchestratorAuditLog entities
 */
describe("Orchestrator Workflow Integration", () => {
  describe("Orchestrator + Insight Creation", () => {
    it("should create insight from orchestrator context", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "monitored-session-456",
        type: "stall_detected",
        severity: "warning",
        message: "Session appears stalled - no activity detected for 5 minutes",
        suggestedActions: [
          {
            label: "Send Enter key",
            description: "Send an Enter key press to resume the session",
            command: "",
            dangerous: false,
          },
        ],
      });

      expect(insight.orchestratorId).toBe(orchestrator.id);
      expect(insight.resolved).toBe(false);
      expect(insight.suggestedActions).toHaveLength(1);
    });

    it("should track insight lifecycle through resolution", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "session-456",
        type: "stall_detected",
        severity: "info",
        message: "Session may be waiting for input",
      });

      // Resolve the insight
      const resolved = insight.resolve();

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
    });

    it("should create audit log for orchestrator actions", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const auditLog = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        "session-456",
        "echo 'test'",
        "User requested"
      );

      expect(auditLog.orchestratorId).toBe(orchestrator.id);
      expect(auditLog.actionType).toBe("command_injected");
      expect(auditLog.isCommandInjection()).toBe(true);
    });
  });

  describe("Orchestrator State Machine", () => {
    it("should track pause/resume cycles with insights", () => {
      let orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      expect(orchestrator.status).toBe("idle");

      // Start analyzing
      orchestrator = orchestrator.startAnalyzing();
      expect(orchestrator.status).toBe("analyzing");

      // Pause
      orchestrator = orchestrator.pause();
      expect(orchestrator.status).toBe("paused");

      // Resume
      orchestrator = orchestrator.resume();
      expect(orchestrator.status).toBe("idle");
    });

    it("should update last activity time correctly", () => {
      let orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const initialActivity = orchestrator.lastActivityAt;

      // Touch to update activity
      orchestrator = orchestrator.touch();

      expect(orchestrator.lastActivityAt).not.toBe(initialActivity);
      expect(orchestrator.lastActivityAt).toBeInstanceOf(Date);
    });

    it("should transition through analyzing and acting states", () => {
      let orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      expect(orchestrator.isIdle()).toBe(true);

      // Start analyzing
      orchestrator = orchestrator.startAnalyzing();
      expect(orchestrator.isMonitoring()).toBe(true);

      // Start acting
      orchestrator = orchestrator.startActing();
      expect(orchestrator.status).toBe("acting");

      // Return to idle
      orchestrator = orchestrator.returnToIdle();
      expect(orchestrator.isIdle()).toBe(true);
    });
  });

  describe("Folder Orchestrator Hierarchy", () => {
    it("should create sub-orchestrator with folder scope", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const subOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "folder-session",
        scopeId: "folder-123",
        monitoringInterval: 15, // More frequent for folder
        stallThreshold: 180, // Shorter threshold
      });

      expect(masterOrchestrator.isMaster()).toBe(true);
      expect(subOrchestrator.isSubOrchestrator()).toBe(true);
      expect(subOrchestrator.scopeId).toBe("folder-123");
      expect(subOrchestrator.scopeType).toBe("folder");
    });

    it("should allow sub-orchestrator to override master config", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      const subOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "folder-session",
        scopeId: "folder-123",
        monitoringInterval: 10, // Faster
        stallThreshold: 120, // Shorter
      });

      expect(subOrchestrator.monitoringInterval).toBe(10);
      expect(subOrchestrator.stallThreshold).toBe(120);
      expect(masterOrchestrator.monitoringInterval).toBe(30);
    });

    it("should check scope correctly", () => {
      const masterOrchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "master-session",
      });

      const subOrchestrator = Orchestrator.createSubOrchestrator({
        userId: "user-123",
        sessionId: "folder-session",
        scopeId: "folder-123",
      });

      // Master monitors all sessions
      expect(masterOrchestrator.isInScope("folder-123")).toBe(true);
      expect(masterOrchestrator.isInScope("folder-456")).toBe(true);
      expect(masterOrchestrator.isInScope(null)).toBe(true);

      // Sub-orchestrator only monitors its folder
      expect(subOrchestrator.isInScope("folder-123")).toBe(true);
      expect(subOrchestrator.isInScope("folder-456")).toBe(false);
      expect(subOrchestrator.isInScope(null)).toBe(false);
    });
  });

  describe("Insight Aggregation", () => {
    it("should create multiple insights for same orchestrator", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const insights = [
        OrchestratorInsight.create({
          orchestratorId: orchestrator.id,
          sessionId: "session-1",
          type: "stall_detected",
          severity: "warning",
          message: "Stall detected in session 1 - no activity",
        }),
        OrchestratorInsight.create({
          orchestratorId: orchestrator.id,
          sessionId: "session-2",
          type: "error",
          severity: "error",
          message: "Error detected in session 2 - compilation failed",
        }),
      ];

      expect(insights).toHaveLength(2);
      expect(insights.every((i) => i.orchestratorId === orchestrator.id)).toBe(true);
      expect(insights[0].type).toBe("stall_detected");
      expect(insights[1].type).toBe("error");
    });

    it("should filter unresolved insights", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const insight1 = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "session-1",
        type: "stall_detected",
        severity: "warning",
        message: "Stall 1",
      });

      const insight2 = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "session-2",
        type: "stall_detected",
        severity: "warning",
        message: "Stall 2",
      });

      const resolvedInsight1 = insight1.resolve();

      const insights = [resolvedInsight1, insight2];
      const unresolved = insights.filter((i) => !i.resolved);

      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].message).toBe("Stall 2");
    });
  });

  describe("Audit Trail", () => {
    it("should create complete audit trail for command injection", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      // Create insight first
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "session-456",
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled - no activity",
        suggestedActions: [
          {
            label: "Press Enter",
            description: "Send an Enter key to resume the stalled session",
            command: "",
            dangerous: false,
          },
        ],
      });

      // Create audit log for the action taken
      const auditLog = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        "session-456",
        "",
        "Press Enter to resume"
      );

      // Resolve insight after action
      const resolvedInsight = insight.resolve();

      expect(auditLog.orchestratorId).toBe(orchestrator.id);
      expect(auditLog.isCommandInjection()).toBe(true);
      expect(resolvedInsight.resolved).toBe(true);
    });

    it("should track status changes in audit log", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const auditLog = OrchestratorAuditLog.forStatusChanged(
        orchestrator.id,
        "idle",
        "paused"
      );

      expect(auditLog.isStatusChange()).toBe(true);
      expect(auditLog.details?.oldStatus).toBe("idle");
      expect(auditLog.details?.newStatus).toBe("paused");
    });

    it("should track insight generation in audit log", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "session-456",
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled",
      });

      const auditLog = OrchestratorAuditLog.forInsightGenerated(
        orchestrator.id,
        insight.id,
        insight.sessionId,
        insight.type,
        insight.severity
      );

      expect(auditLog.isInsightGeneration()).toBe(true);
      expect(auditLog.details?.insightId).toBe(insight.id);
      expect(auditLog.details?.insightType).toBe("stall_detected");
    });

    it("should track session monitoring in audit log", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const auditLog = OrchestratorAuditLog.forSessionMonitored(
        orchestrator.id,
        "session-456",
        "healthy"
      );

      expect(auditLog.isSessionMonitoring()).toBe(true);
      expect(auditLog.details?.checkResult).toBe("healthy");
    });
  });

  describe("Insight Business Logic", () => {
    it("should identify critical insights", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const criticalInsight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        type: "error",
        severity: "critical",
        message: "Critical error detected",
      });

      const warningInsight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        type: "stall_detected",
        severity: "warning",
        message: "Minor stall detected",
      });

      expect(criticalInsight.isCritical()).toBe(true);
      expect(warningInsight.isCritical()).toBe(false);
    });

    it("should add suggested actions to insight", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      let insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled",
      });

      expect(insight.hasSuggestedActions()).toBe(false);

      insight = insight.addSuggestedAction({
        label: "Restart session",
        description: "Terminate and restart the session to recover from stall",
        command: "exit",
        dangerous: true,
      });

      expect(insight.hasSuggestedActions()).toBe(true);
      expect(insight.suggestedActions[0].dangerous).toBe(true);
    });

    it("should update insight message", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        type: "stall_detected",
        severity: "warning",
        message: "Initial message",
      });

      const updated = insight.updateMessage("Updated message with more details");

      expect(updated.message).toBe("Updated message with more details");
      expect(insight.message).toBe("Initial message"); // Immutable
    });
  });

  describe("Audit Log Query Methods", () => {
    it("should identify session-specific logs", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const sessionSpecific = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        "session-456",
        "test command"
      );

      const notSessionSpecific = OrchestratorAuditLog.forStatusChanged(
        orchestrator.id,
        "idle",
        "paused"
      );

      expect(sessionSpecific.isSessionSpecific()).toBe(true);
      expect(notSessionSpecific.isSessionSpecific()).toBe(false);
    });

    it("should generate meaningful summaries", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      const commandLog = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        "session-456",
        "echo test"
      );

      const statusLog = OrchestratorAuditLog.forStatusChanged(
        orchestrator.id,
        "idle",
        "paused"
      );

      expect(commandLog.getSummary()).toContain("command_injected");
      expect(commandLog.getSummary()).toContain("session-456");
      expect(commandLog.getSummary()).toContain("echo test");

      expect(statusLog.getSummary()).toContain("status_changed");
      expect(statusLog.getSummary()).toContain("idle → paused");
    });
  });

  describe("Orchestrator Config Updates", () => {
    it("should update configuration immutably", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      const updated = orchestrator.updateConfig({
        monitoringInterval: 60,
        autoIntervention: true,
      });

      expect(updated.monitoringInterval).toBe(60);
      expect(updated.autoIntervention).toBe(true);
      expect(orchestrator.monitoringInterval).toBe(30); // Original unchanged
    });

    it("should validate config updates", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-123",
        sessionId: "session-123",
      });

      expect(() => orchestrator.updateConfig({ monitoringInterval: -1 })).toThrow();
      expect(() => orchestrator.updateConfig({ stallThreshold: 0 })).toThrow();
    });
  });
});
