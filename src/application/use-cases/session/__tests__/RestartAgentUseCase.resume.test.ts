// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { RestartAgentUseCase } from "../RestartAgentUseCase";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import type { AgentResumeResolver } from "@/application/ports/AgentResumeResolver";
import { Session } from "@/domain/entities/Session";

describe("RestartAgentUseCase — resume", () => {
  let repo: SessionRepository;
  let tmux: TmuxGateway;
  let resolver: AgentResumeResolver;

  const agentSession = (provider = "claude") =>
    Session.create({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
      name: "Agent",
      projectPath: "/home/user/project",
      terminalType: "agent",
      agentProvider: provider as "claude",
    }).markAgentExited(0);

  beforeEach(() => {
    vi.resetAllMocks();
    repo = {
      findById: vi.fn(),
      findByUser: vi.fn(),
      count: vi.fn(),
      findByIds: vi.fn(),
      findByProject: vi.fn(),
      save: vi.fn().mockImplementation((s: Session) => Promise.resolve(s)),
      saveMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateTabOrders: vi.fn(),
      exists: vi.fn(),
      getNextTabOrder: vi.fn(),
      getAllActiveTmuxSessionNames: vi.fn(),
    } as unknown as SessionRepository;
    tmux = {
      sessionExists: vi.fn().mockResolvedValue(true),
      sendKeys: vi.fn().mockResolvedValue(undefined),
    } as unknown as TmuxGateway;
    resolver = { resolveResume: vi.fn() };
  });

  it("sends a resumed command when the resolver returns flags", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession());
    (resolver.resolveResume as Mock).mockResolvedValue({
      provider: "claude",
      nativeSessionId: "id1",
      resumeFlags: ["--resume", "id1"],
      argvOverride: null,
    });
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    const out = await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "claude --resume id1");
    expect(out.resumed).toBe(true);
  });

  it("sends a codex subcommand argv when the resolver returns an argvOverride", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession("codex"));
    (resolver.resolveResume as Mock).mockResolvedValue({
      provider: "codex",
      nativeSessionId: "cx",
      resumeFlags: [],
      argvOverride: ["codex", "resume", "cx"],
    });
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "codex resume cx");
  });

  it("relaunches fresh (bare command) when the resolver returns null", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession());
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    const out = await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "claude");
    expect(out.resumed).toBe(false);
  });

  it("defaults to a no-op resolver (fresh) when none is injected", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession());
    const useCase = new RestartAgentUseCase(repo, tmux); // 2-arg legacy construction

    const out = await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "claude");
    expect(out.resumed).toBe(false);
  });
});
