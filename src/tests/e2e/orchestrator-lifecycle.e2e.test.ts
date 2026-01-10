import { describe, it, expect } from "bun:test";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";

/**
 * E2E Test: Orchestrator Lifecycle
 * Tests the complete workflow from orchestrator creation through monitoring,
 * insight generation, command injection, and resolution.
 */
describe("E2E: Orchestrator Lifecycle", () => {
  describe("Complete Monitoring Workflow", () => {
    it("should complete full orchestrator lifecycle from creation to resolution", () => {
      // Step 1: Create Master Control orchestrator
      let orchestrator = Orchestrator.createMaster({
        userId: "user-e2e-1",
        sessionId: "orchestrator-session-1",
        monitoringInterval: 30,
        stallThreshold: 300,
        autoIntervention: false,
      });

      expect(orchestrator.isMaster()).toBe(true);
      expect(orchestrator.isIdle()).toBe(true);

      // Step 2: Start analyzing sessions
      orchestrator = orchestrator.startAnalyzing();
      expect(orchestrator.isMonitoring()).toBe(true);
      expect(orchestrator.status).toBe("analyzing");

      // Step 3: Simulate monitoring cycle - create audit log for session check
      const monitorAudit = OrchestratorAuditLog.forSessionMonitored(
        orchestrator.id,
        "monitored-session-1",
        "stalled"
      );
      expect(monitorAudit.isSessionMonitoring()).toBe(true);

      // Step 4: Detect stall and generate insight
      const insight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "monitored-session-1",
        type: "stall_detected",
        severity: "warning",
        message: "Session stalled - no activity detected for 5 minutes",
        suggestedActions: [
          {
            label: "Send Enter key",
            description: "Send an Enter key press to resume the session",
            command: "",
            dangerous: false,
          },
          {
            label: "Restart agent",
            description: "Terminate and restart the agent process",
            command: "exit 0",
            dangerous: true,
          },
        ],
      });

      expect(insight.resolved).toBe(false);
      expect(insight.hasSuggestedActions()).toBe(true);
      expect(insight.suggestedActions).toHaveLength(2);

      // Step 5: Log the insight generation
      const insightAudit = OrchestratorAuditLog.forInsightGenerated(
        orchestrator.id,
        insight.id,
        insight.sessionId!,
        insight.type,
        insight.severity
      );
      expect(insightAudit.isInsightGeneration()).toBe(true);

      // Step 6: Transition to acting state for intervention
      orchestrator = orchestrator.startActing();
      expect(orchestrator.status).toBe("acting");

      // Step 7: Execute intervention - inject command
      const commandAudit = OrchestratorAuditLog.forCommandInjected(
        orchestrator.id,
        "monitored-session-1",
        "", // Enter key
        "Press Enter to resume stalled session"
      );
      expect(commandAudit.isCommandInjection()).toBe(true);

      // Step 8: Resolve the insight
      const resolvedInsight = insight.resolve();
      expect(resolvedInsight.resolved).toBe(true);
      expect(resolvedInsight.resolvedAt).toBeInstanceOf(Date);

      // Step 9: Return to idle after intervention
      orchestrator = orchestrator.returnToIdle();
      expect(orchestrator.isIdle()).toBe(true);

      // Step 10: Verify complete audit trail
      expect(monitorAudit.getSummary()).toContain("session_monitored");
      expect(insightAudit.getSummary()).toContain("insight_generated");
      expect(commandAudit.getSummary()).toContain("command_injected");
    });

    it("should handle pause and resume workflow", () => {
      let orchestrator = Orchestrator.createMaster({
        userId: "user-e2e-2",
        sessionId: "orchestrator-session-2",
      });

      // Start monitoring
      orchestrator = orchestrator.startAnalyzing();
      expect(orchestrator.status).toBe("analyzing");

      // Log status change
      const pauseAudit = OrchestratorAuditLog.forStatusChanged(
        orchestrator.id,
        "analyzing",
        "paused"
      );

      // Pause monitoring
      orchestrator = orchestrator.pause();
      expect(orchestrator.status).toBe("paused");

      // Verify audit shows transition
      expect(pauseAudit.details?.oldStatus).toBe("analyzing");
      expect(pauseAudit.details?.newStatus).toBe("paused");

      // Resume monitoring
      orchestrator = orchestrator.resume();
      expect(orchestrator.isIdle()).toBe(true);

      // Start again
      orchestrator = orchestrator.startAnalyzing();
      expect(orchestrator.isMonitoring()).toBe(true);
    });

    it("should handle configuration updates during operation", () => {
      let orchestrator = Orchestrator.createMaster({
        userId: "user-e2e-3",
        sessionId: "orchestrator-session-3",
        monitoringInterval: 30,
        stallThreshold: 300,
      });

      // Start monitoring
      orchestrator = orchestrator.startAnalyzing();

      // Update configuration (e.g., user wants faster checks)
      orchestrator = orchestrator.updateConfig({
        monitoringInterval: 15,
        stallThreshold: 180,
        autoIntervention: true,
      });

      expect(orchestrator.monitoringInterval).toBe(15);
      expect(orchestrator.stallThreshold).toBe(180);
      expect(orchestrator.autoIntervention).toBe(true);

      // Orchestrator should still be in analyzing state
      expect(orchestrator.status).toBe("analyzing");
    });
  });

  describe("Multi-Session Monitoring", () => {
    it("should generate and track insights for multiple sessions", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-e2e-4",
        sessionId: "orchestrator-session-4",
      });

      // Create insights for multiple sessions
      const sessions = ["session-a", "session-b", "session-c"];
      const insights: OrchestratorInsight[] = [];
      const auditLogs: OrchestratorAuditLog[] = [];

      for (const sessionId of sessions) {
        // Create monitoring audit
        auditLogs.push(
          OrchestratorAuditLog.forSessionMonitored(
            orchestrator.id,
            sessionId,
            sessionId === "session-b" ? "stalled" : "healthy"
          )
        );

        // Create insight for stalled session
        if (sessionId === "session-b") {
          const insight = OrchestratorInsight.create({
            orchestratorId: orchestrator.id,
            sessionId,
            type: "stall_detected",
            severity: "warning",
            message: `Session ${sessionId} has stalled`,
          });
          insights.push(insight);

          auditLogs.push(
            OrchestratorAuditLog.forInsightGenerated(
              orchestrator.id,
              insight.id,
              sessionId,
              insight.type,
              insight.severity
            )
          );
        }
      }

      // Verify monitoring coverage
      expect(auditLogs.filter((a) => a.isSessionMonitoring())).toHaveLength(3);
      expect(insights).toHaveLength(1);
      expect(insights[0].sessionId).toBe("session-b");
    });
  });

  describe("Critical Error Handling", () => {
    it("should handle critical errors with appropriate escalation", () => {
      const orchestrator = Orchestrator.createMaster({
        userId: "user-e2e-5",
        sessionId: "orchestrator-session-5",
      });

      // Create critical insight
      const criticalInsight = OrchestratorInsight.create({
        orchestratorId: orchestrator.id,
        sessionId: "critical-session",
        type: "error",
        severity: "critical",
        message: "Agent process terminated unexpectedly",
        suggestedActions: [
          {
            label: "Restart session",
            description: "Terminate and restart the session after unexpected termination",
            command: "exit 1",
            dangerous: true,
          },
        ],
      });

      expect(criticalInsight.isCritical()).toBe(true);
      expect(criticalInsight.severity).toBe("critical");

      // Add additional context
      const updatedInsight = criticalInsight.updateMessage(
        "Agent process terminated unexpectedly - exit code 137 (OOM killed)"
      );

      expect(updatedInsight.message).toContain("OOM killed");

      // Verify original is unchanged (immutability)
      expect(criticalInsight.message).not.toContain("OOM killed");
    });
  });
});
