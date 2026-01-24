import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  RestartAgentUseCase,
  RestartAgentError,
  type RestartAgentInput,
} from "./RestartAgentUseCase";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { Session } from "@/domain/entities/Session";
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";

describe("RestartAgentUseCase", () => {
  let mockSessionRepository: SessionRepository;
  let mockTmuxGateway: TmuxGateway;
  let useCase: RestartAgentUseCase;

  // Helper to create an agent session for testing
  const createAgentSession = (
    overrides?: Partial<Parameters<typeof Session.create>[0]> & {
      agentExitState?: "running" | "exited" | "restarting" | "closed";
    }
  ) => {
    const session = Session.create({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
      name: "Agent Session",
      projectPath: "/home/user/project",
      terminalType: "agent",
      agentProvider: "claude",
      ...overrides,
    });

    // If a specific exit state is requested, apply it
    if (overrides?.agentExitState === "exited") {
      return session.markAgentExited(0);
    }
    if (overrides?.agentExitState === "closed") {
      return session.markAgentClosed();
    }
    if (overrides?.agentExitState === "restarting") {
      return session.markAgentRestarting();
    }

    return session;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockSessionRepository = {
      findById: vi.fn(),
      findByUser: vi.fn(),
      count: vi.fn(),
      findByIds: vi.fn(),
      findByFolder: vi.fn(),
      findBySplitGroup: vi.fn(),
      save: vi.fn().mockImplementation((session: Session) => Promise.resolve(session)),
      saveMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateTabOrders: vi.fn(),
      exists: vi.fn(),
      getNextTabOrder: vi.fn(),
      getAllActiveTmuxSessionNames: vi.fn(),
    };

    mockTmuxGateway = {
      createSession: vi.fn(),
      killSession: vi.fn(),
      sessionExists: vi.fn().mockResolvedValue(true),
      getSessionInfo: vi.fn(),
      listSessions: vi.fn(),
      sendKeys: vi.fn().mockResolvedValue(undefined),
      detachSession: vi.fn(),
      generateSessionName: vi.fn(),
      setEnvironment: vi.fn().mockResolvedValue(undefined),
      getEnvironment: vi.fn(),
      unsetEnvironment: vi.fn().mockResolvedValue(undefined),
      setHook: vi.fn().mockResolvedValue(undefined),
      removeHook: vi.fn().mockResolvedValue(undefined),
      setOption: vi.fn().mockResolvedValue(undefined),
      getOption: vi.fn(),
    };

    useCase = new RestartAgentUseCase(mockSessionRepository, mockTmuxGateway);
  });

  describe("successful restart", () => {
    it("restarts an agent session that has exited", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      const result = await useCase.execute(input);

      expect(result.session.agentExitState).toBe("running");
      expect(result.wasRecreated).toBe(false);
    });

    it("sends the correct agent command", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      expect(mockTmuxGateway.sendKeys).toHaveBeenCalledWith(
        exitedSession.tmuxSessionName.toString(),
        "claude"
      );
    });

    it("sends correct command for codex provider", async () => {
      const codexSession = createAgentSession({
        agentProvider: "codex",
        agentExitState: "exited",
      });
      (mockSessionRepository.findById as Mock).mockResolvedValue(codexSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      expect(mockTmuxGateway.sendKeys).toHaveBeenCalledWith(
        expect.any(String),
        "codex"
      );
    });

    it("increments restart count", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      const result = await useCase.execute(input);

      // Session was exited (count 0), then marked restarting (count 1)
      expect(result.session.agentRestartCount).toBe(1);
    });

    it("persists state changes", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      // Should save twice: once for restarting state, once for running state
      expect(mockSessionRepository.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling - session not found", () => {
    it("throws EntityNotFoundError when session does not exist", async () => {
      (mockSessionRepository.findById as Mock).mockResolvedValue(null);

      const input: RestartAgentInput = {
        sessionId: "nonexistent-id",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe("error handling - not agent session", () => {
    it("throws RestartAgentError for shell session", async () => {
      const shellSession = Session.create({
        id: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
        name: "Shell Session",
        terminalType: "shell",
      });
      (mockSessionRepository.findById as Mock).mockResolvedValue(shellSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(RestartAgentError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "NOT_AGENT_SESSION",
      });
    });
  });

  describe("error handling - invalid agent state", () => {
    it("throws RestartAgentError when agent is already closed", async () => {
      const closedSession = createAgentSession({ agentExitState: "closed" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(closedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(RestartAgentError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "INVALID_STATE",
      });
    });
  });

  describe("error handling - session not active", () => {
    it("throws InvalidStateTransitionError when session is suspended", async () => {
      const suspendedSession = createAgentSession({ agentExitState: "exited" }).suspend();
      (mockSessionRepository.findById as Mock).mockResolvedValue(suspendedSession);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe("error handling - tmux session gone", () => {
    it("throws RestartAgentError when tmux session no longer exists", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(false);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(RestartAgentError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "TMUX_SESSION_GONE",
      });
    });

    it("reverts to exited state when tmux session is gone", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(false);

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      // Should save restarting state, then revert to exited state
      expect(mockSessionRepository.save).toHaveBeenCalledTimes(2);
      expect(mockSessionRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agentExitState: "exited",
        })
      );
    });
  });

  describe("error handling - restart failed", () => {
    it("throws RestartAgentError when sendKeys fails", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);
      (mockTmuxGateway.sendKeys as Mock).mockRejectedValue(new Error("Send failed"));

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(RestartAgentError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "RESTART_FAILED",
      });
    });

    it("reverts to exited state when sendKeys fails", async () => {
      const exitedSession = createAgentSession({ agentExitState: "exited" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(exitedSession);
      (mockTmuxGateway.sendKeys as Mock).mockRejectedValue(new Error("Send failed"));

      const input: RestartAgentInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      // Should save restarting state, then revert to exited state on failure
      expect(mockSessionRepository.save).toHaveBeenCalledTimes(2);
      expect(mockSessionRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agentExitState: "exited",
        })
      );
    });
  });
});
