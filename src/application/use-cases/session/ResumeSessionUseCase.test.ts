// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  ResumeSessionUseCase,
  ResumeSessionError,
  type ResumeSessionInput,
  type UsesTmuxPolicy,
} from "./ResumeSessionUseCase";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { Session } from "@/domain/entities/Session";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type { TerminalType } from "@/types/terminal-type";

describe("ResumeSessionUseCase", () => {
  let mockSessionRepository: SessionRepository;
  let mockTmuxGateway: TmuxGateway;

  const createTestSession = (
    overrides?: Partial<Parameters<typeof Session.create>[0]>
  ) =>
    Session.create({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
      name: "Test Session",
      projectPath: "/home/user/project",
      ...overrides,
    }).suspend();

  beforeEach(() => {
    vi.resetAllMocks();

    mockSessionRepository = {
      findById: vi.fn(),
      findByUser: vi.fn(),
      count: vi.fn(),
      findByIds: vi.fn(),
      findByProject: vi.fn(),
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
      setEnvironment: vi.fn().mockResolvedValue(undefined),
      getEnvironment: vi.fn(),
      unsetEnvironment: vi.fn().mockResolvedValue(undefined),
      setHook: vi.fn().mockResolvedValue(undefined),
      removeHook: vi.fn().mockResolvedValue(undefined),
      setOption: vi.fn().mockResolvedValue(undefined),
      getOption: vi.fn(),
    };
  });

  const makeUseCase = (usesTmux?: UsesTmuxPolicy) =>
    new ResumeSessionUseCase(mockSessionRepository, mockTmuxGateway, usesTmux);

  describe("tmux-backed sessions", () => {
    it("resumes when tmux session exists", async () => {
      const session = createTestSession({ terminalType: "shell" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(session);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(true);

      const useCase = makeUseCase((t) => t === "shell");
      const input: ResumeSessionInput = {
        sessionId: session.id,
        userId: "user-123",
      };

      const result = await useCase.execute(input);
      expect(result.isActive()).toBe(true);
      expect(mockTmuxGateway.sessionExists).toHaveBeenCalledWith(
        session.tmuxSessionName.toString()
      );
      expect(mockSessionRepository.save).toHaveBeenCalled();
    });

    it("throws TMUX_SESSION_GONE when tmux session is missing", async () => {
      const session = createTestSession({ terminalType: "shell" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(session);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(false);

      const useCase = makeUseCase((t) => t === "shell");

      await expect(
        useCase.execute({ sessionId: session.id, userId: "user-123" })
      ).rejects.toMatchObject({ code: "TMUX_SESSION_GONE" });
    });
  });

  describe("non-tmux sessions (the bug)", () => {
    // Each of these types represents a singleton / panel terminal where
    // no tmux session exists. Resume must succeed without probing tmux,
    // otherwise the API returns 410 and the client auto-deletes the tab.
    const NON_TMUX_TYPES: TerminalType[] = [
      "settings",
      "recordings",
      "profiles",
      "trash",
      "port-manager",
      "project-prefs",
      "group-prefs",
      "secrets",
      "github-maintenance",
      "issues",
      "prs",
      "file",
      "browser",
    ];

    it.each(NON_TMUX_TYPES)(
      "resumes a %s session without checking tmux",
      async (terminalType) => {
        const session = createTestSession({ terminalType });
        (mockSessionRepository.findById as Mock).mockResolvedValue(session);

        const useCase = makeUseCase((t) => t === "shell" || t === "agent" || t === "loop");

        const result = await useCase.execute({
          sessionId: session.id,
          userId: "user-123",
        });

        expect(result.isActive()).toBe(true);
        expect(mockTmuxGateway.sessionExists).not.toHaveBeenCalled();
        expect(mockSessionRepository.save).toHaveBeenCalled();
      }
    );

    it("never throws TMUX_SESSION_GONE for non-tmux sessions, even when tmuxGateway would say 'gone'", async () => {
      // This is the exact bug: the old code always called sessionExists();
      // the gateway returning false for a session that never had a tmux
      // session caused the 410 → client auto-delete cascade. The fix
      // short-circuits before the probe runs, so even a hypothetically
      // misbehaving gateway can't produce the 410.
      const session = createTestSession({ terminalType: "settings" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(session);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(false);

      const useCase = makeUseCase((t) => t === "shell");

      const result = await useCase.execute({
        sessionId: session.id,
        userId: "user-123",
      });

      expect(result.isActive()).toBe(true);
      expect(mockTmuxGateway.sessionExists).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("throws EntityNotFoundError when session does not exist", async () => {
      (mockSessionRepository.findById as Mock).mockResolvedValue(null);

      const useCase = makeUseCase(() => true);
      await expect(
        useCase.execute({ sessionId: "nope", userId: "user-123" })
      ).rejects.toThrow(EntityNotFoundError);
    });

    it("does not probe tmux when session is not found", async () => {
      (mockSessionRepository.findById as Mock).mockResolvedValue(null);

      const useCase = makeUseCase(() => true);
      await expect(
        useCase.execute({ sessionId: "nope", userId: "user-123" })
      ).rejects.toThrow();
      expect(mockTmuxGateway.sessionExists).not.toHaveBeenCalled();
    });
  });

  describe("default policy (back-compat)", () => {
    it("falls back to assuming tmux-backed when no policy is injected", async () => {
      const session = createTestSession({ terminalType: "shell" });
      (mockSessionRepository.findById as Mock).mockResolvedValue(session);
      (mockTmuxGateway.sessionExists as Mock).mockResolvedValue(false);

      // Construct without the `usesTmux` arg — should behave like the
      // legacy use case (always probe tmux). This keeps existing callers
      // that haven't migrated unchanged.
      const useCase = new ResumeSessionUseCase(
        mockSessionRepository,
        mockTmuxGateway
      );

      await expect(
        useCase.execute({ sessionId: session.id, userId: "user-123" })
      ).rejects.toBeInstanceOf(ResumeSessionError);
      expect(mockTmuxGateway.sessionExists).toHaveBeenCalled();
    });
  });
});
