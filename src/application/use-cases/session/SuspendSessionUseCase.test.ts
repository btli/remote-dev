import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuspendSessionUseCase, type SuspendSessionInput } from "./SuspendSessionUseCase";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { Session } from "@/domain/entities/Session";
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";

describe("SuspendSessionUseCase", () => {
  let mockSessionRepository: SessionRepository;
  let mockTmuxGateway: TmuxGateway;
  let useCase: SuspendSessionUseCase;

  // Helper to create a valid session for testing
  const createTestSession = (overrides?: Partial<Parameters<typeof Session.create>[0]>) => {
    return Session.create({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
      name: "Test Session",
      projectPath: "/home/user/project",
      ...overrides,
    });
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
      save: vi.fn().mockImplementation((session: Session) =>
        Promise.resolve(session)
      ),
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
      sessionExists: vi.fn(),
      getSessionInfo: vi.fn(),
      listSessions: vi.fn(),
      sendKeys: vi.fn(),
      detachSession: vi.fn().mockResolvedValue(undefined),
      generateSessionName: vi.fn(),
    };

    useCase = new SuspendSessionUseCase(mockSessionRepository, mockTmuxGateway);
  });

  describe("successful suspension", () => {
    it("suspends an active session", async () => {
      const activeSession = createTestSession();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(activeSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      const result = await useCase.execute(input);

      expect(result.isSuspended()).toBe(true);
      expect(result.isActive()).toBe(false);
    });

    it("detaches the tmux session", async () => {
      const activeSession = createTestSession();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(activeSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      expect(mockTmuxGateway.detachSession).toHaveBeenCalledWith(
        activeSession.tmuxSessionName.toString()
      );
    });

    it("persists the suspended state", async () => {
      const activeSession = createTestSession();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(activeSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      expect(mockSessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            value: "suspended",
          }),
        })
      );
    });

    it("preserves session data during suspension", async () => {
      const activeSession = createTestSession({
        name: "My Session",
        projectPath: "/special/path",
        folderId: "folder-456",
      });
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(activeSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      const result = await useCase.execute(input);

      expect(result.name).toBe("My Session");
      expect(result.projectPath).toBe("/special/path");
      expect(result.folderId).toBe("folder-456");
    });
  });

  describe("error handling - session not found", () => {
    it("throws EntityNotFoundError when session does not exist", async () => {
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(null);

      const input: SuspendSessionInput = {
        sessionId: "nonexistent-id",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(EntityNotFoundError);
    });

    it("throws EntityNotFoundError when session belongs to different user", async () => {
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(null);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "different-user",
      };

      await expect(useCase.execute(input)).rejects.toThrow(EntityNotFoundError);
    });

    it("does not call tmux gateway when session not found", async () => {
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(null);

      const input: SuspendSessionInput = {
        sessionId: "nonexistent-id",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      expect(mockTmuxGateway.detachSession).not.toHaveBeenCalled();
    });
  });

  describe("error handling - invalid state transitions", () => {
    it("throws InvalidStateTransitionError when suspending suspended session", async () => {
      const suspendedSession = createTestSession().suspend();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(suspendedSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(InvalidStateTransitionError);
    });

    it("throws InvalidStateTransitionError when suspending closed session", async () => {
      const closedSession = createTestSession().close();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(closedSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow(InvalidStateTransitionError);
    });

    it("does not call tmux gateway when state transition is invalid", async () => {
      const closedSession = createTestSession().close();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(closedSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      expect(mockTmuxGateway.detachSession).not.toHaveBeenCalled();
    });
  });

  describe("execution order", () => {
    it("validates state before calling tmux", async () => {
      const closedSession = createTestSession().close();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(closedSession);

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      // Tmux should not be called because state validation happens first
      expect(mockTmuxGateway.detachSession).not.toHaveBeenCalled();
      expect(mockSessionRepository.save).not.toHaveBeenCalled();
    });

    it("calls tmux before persisting", async () => {
      const activeSession = createTestSession();
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(activeSession);

      const callOrder: string[] = [];
      vi.mocked(mockTmuxGateway.detachSession).mockImplementation(async () => {
        callOrder.push("detach");
      });
      vi.mocked(mockSessionRepository.save).mockImplementation(async (session) => {
        callOrder.push("save");
        return session;
      });

      const input: SuspendSessionInput = {
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      };

      await useCase.execute(input);

      expect(callOrder).toEqual(["detach", "save"]);
    });
  });
});
