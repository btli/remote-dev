import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreateSessionUseCase,
  CreateSessionError,
  type CreateSessionInput,
} from "./CreateSessionUseCase";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { WorktreeGateway } from "@/application/ports/WorktreeGateway";
import { Session } from "@/domain/entities/Session";

describe("CreateSessionUseCase", () => {
  // Mock implementations
  let mockSessionRepository: SessionRepository;
  let mockTmuxGateway: TmuxGateway;
  let mockWorktreeGateway: WorktreeGateway;
  let useCase: CreateSessionUseCase;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Create mock implementations
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
      getNextTabOrder: vi.fn().mockResolvedValue(0),
      getAllActiveTmuxSessionNames: vi.fn(),
    };

    mockTmuxGateway = {
      createSession: vi.fn().mockResolvedValue(undefined),
      killSession: vi.fn().mockResolvedValue(undefined),
      sessionExists: vi.fn(),
      getSessionInfo: vi.fn(),
      listSessions: vi.fn(),
      sendKeys: vi.fn(),
      detachSession: vi.fn(),
      generateSessionName: vi.fn(),
    };

    mockWorktreeGateway = {
      isGitRepo: vi.fn().mockResolvedValue(true),
      createWorktree: vi.fn().mockResolvedValue({
        worktreePath: "/tmp/worktree-branch",
        branchName: "feature/test-branch",
        created: true,
      }),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      listWorktrees: vi.fn(),
      copyEnvFiles: vi.fn().mockResolvedValue(undefined),
      sanitizeBranchName: vi.fn().mockImplementation((input: string) =>
        input.toLowerCase().replace(/\s+/g, "-")
      ),
    };

    useCase = new CreateSessionUseCase(
      mockSessionRepository,
      mockTmuxGateway,
      mockWorktreeGateway
    );
  });

  describe("successful session creation", () => {
    it("creates a basic session without worktree", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
        projectPath: "/home/user/project",
      };

      const result = await useCase.execute(input);

      expect(result.session).toBeDefined();
      expect(result.session.userId).toBe("user-123");
      expect(result.session.name).toBe("My Session");
      expect(result.session.projectPath).toBe("/home/user/project");
      expect(result.session.isActive()).toBe(true);
      expect(result.worktreePath).toBeUndefined();
    });

    it("assigns next available tab order", async () => {
      vi.mocked(mockSessionRepository.getNextTabOrder).mockResolvedValue(5);

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
      };

      const result = await useCase.execute(input);

      expect(mockSessionRepository.getNextTabOrder).toHaveBeenCalledWith("user-123");
      expect(result.session.tabOrder).toBe(5);
    });

    it("creates session with folder assignment", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Session in Folder",
        folderId: "folder-456",
      };

      const result = await useCase.execute(input);

      expect(result.session.folderId).toBe("folder-456");
    });

    it("creates tmux session with correct parameters", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
        projectPath: "/home/user/project",
        startupCommand: "npm run dev",
        environment: { NODE_ENV: "development" },
      };

      await useCase.execute(input);

      expect(mockTmuxGateway.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: "/home/user/project",
          startupCommand: "npm run dev",
          environment: { NODE_ENV: "development" },
        })
      );
    });

    it("persists session to repository", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
      };

      await useCase.execute(input);

      expect(mockSessionRepository.save).toHaveBeenCalledTimes(1);
      expect(mockSessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          name: "My Session",
        })
      );
    });
  });

  describe("worktree creation", () => {
    it("creates worktree when requested", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "Add login feature",
        baseBranch: "main",
      };

      const result = await useCase.execute(input);

      expect(mockWorktreeGateway.isGitRepo).toHaveBeenCalledWith("/home/user/project");
      expect(mockWorktreeGateway.createWorktree).toHaveBeenCalledWith({
        repoPath: "/home/user/project",
        branchName: "feature/add-login-feature",
        baseBranch: "main",
      });
      expect(result.worktreePath).toBe("/tmp/worktree-branch");
      expect(result.session.worktreeBranch).toBe("feature/test-branch");
    });

    it("copies env files to worktree", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "New feature",
      };

      await useCase.execute(input);

      expect(mockWorktreeGateway.copyEnvFiles).toHaveBeenCalledWith(
        "/home/user/project",
        "/tmp/worktree-branch"
      );
    });

    it("uses worktree path as working directory", async () => {
      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "New feature",
      };

      await useCase.execute(input);

      expect(mockTmuxGateway.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: "/tmp/worktree-branch",
        })
      );
    });
  });

  describe("error handling - not git repo", () => {
    it("throws when project path is not a git repo", async () => {
      vi.mocked(mockWorktreeGateway.isGitRepo).mockResolvedValue(false);

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/not-a-repo",
        createWorktree: true,
        featureDescription: "New feature",
      };

      await expect(useCase.execute(input)).rejects.toThrow(CreateSessionError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "NOT_GIT_REPO",
      });
    });
  });

  describe("error handling - worktree creation failure", () => {
    it("throws when worktree creation fails", async () => {
      vi.mocked(mockWorktreeGateway.createWorktree).mockRejectedValue(
        new Error("Branch already exists")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "Existing feature",
      };

      await expect(useCase.execute(input)).rejects.toThrow(CreateSessionError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "WORKTREE_CREATION_FAILED",
      });
    });
  });

  describe("error handling - tmux creation failure", () => {
    it("throws when tmux session creation fails", async () => {
      vi.mocked(mockTmuxGateway.createSession).mockRejectedValue(
        new Error("tmux error")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
        projectPath: "/home/user/project",
      };

      await expect(useCase.execute(input)).rejects.toThrow(CreateSessionError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "TMUX_CREATION_FAILED",
      });
    });

    it("cleans up worktree when tmux creation fails", async () => {
      vi.mocked(mockTmuxGateway.createSession).mockRejectedValue(
        new Error("tmux error")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "New feature",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      expect(mockWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
        "/home/user/project",
        "/tmp/worktree-branch",
        true
      );
    });
  });

  describe("error handling - persistence failure", () => {
    it("throws when persistence fails", async () => {
      vi.mocked(mockSessionRepository.save).mockRejectedValue(
        new Error("Database error")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
      };

      await expect(useCase.execute(input)).rejects.toThrow(CreateSessionError);
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "PERSISTENCE_FAILED",
      });
    });

    it("cleans up tmux session when persistence fails", async () => {
      vi.mocked(mockSessionRepository.save).mockRejectedValue(
        new Error("Database error")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      expect(mockTmuxGateway.killSession).toHaveBeenCalled();
    });

    it("cleans up both tmux and worktree when persistence fails", async () => {
      vi.mocked(mockSessionRepository.save).mockRejectedValue(
        new Error("Database error")
      );

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "New feature",
      };

      await expect(useCase.execute(input)).rejects.toThrow();

      expect(mockTmuxGateway.killSession).toHaveBeenCalled();
      expect(mockWorktreeGateway.removeWorktree).toHaveBeenCalled();
    });
  });

  describe("cleanup error handling", () => {
    it("continues even if worktree cleanup fails", async () => {
      vi.mocked(mockTmuxGateway.createSession).mockRejectedValue(
        new Error("tmux error")
      );
      vi.mocked(mockWorktreeGateway.removeWorktree).mockRejectedValue(
        new Error("cleanup failed")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "Feature Session",
        projectPath: "/home/user/project",
        createWorktree: true,
        featureDescription: "New feature",
      };

      // Should still throw the original error
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "TMUX_CREATION_FAILED",
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("continues even if tmux cleanup fails", async () => {
      vi.mocked(mockSessionRepository.save).mockRejectedValue(
        new Error("Database error")
      );
      vi.mocked(mockTmuxGateway.killSession).mockRejectedValue(
        new Error("tmux cleanup failed")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const input: CreateSessionInput = {
        userId: "user-123",
        name: "My Session",
      };

      // Should still throw the original error
      await expect(useCase.execute(input)).rejects.toMatchObject({
        code: "PERSISTENCE_FAILED",
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
