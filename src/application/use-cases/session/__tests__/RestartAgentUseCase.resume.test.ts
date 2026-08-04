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

  const agentSession = (
    provider = "claude",
    terminalType: "agent" | "loop" = "agent",
    typeMetadata?: Record<string, unknown>,
  ) =>
    Session.create({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
      name: "Agent",
      projectPath: "/home/user/project",
      terminalType,
      agentProvider: provider as "claude",
      ...(typeMetadata ? { typeMetadata } : {}),
    }).markAgentExited(0);

  beforeEach(() => {
    vi.unstubAllEnvs();
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
      setEnvironment: vi.fn().mockResolvedValue(undefined),
      getEnvironment: vi.fn().mockResolvedValue({
        toRecord: () => ({
          PATH: "/session/bin",
          CURSOR_DATA_DIR: "/session/cursor-data",
        }),
      }),
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

  it("refuses to restart Cursor when agent is not Cursor's CLI", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession("cursor"));
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const resolveVerifiedProviderExecutable = vi.fn().mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(
      repo,
      tmux,
      resolver,
      resolveVerifiedProviderExecutable,
    );

    await expect(
      useCase.execute({
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        userId: "user-123",
      }),
    ).rejects.toMatchObject({ code: "RESTART_FAILED" });

    expect(resolveVerifiedProviderExecutable).toHaveBeenCalledWith(
      "cursor",
      "agent",
      expect.objectContaining({
        PATH: "/session/bin",
        CURSOR_DATA_DIR: "/session/cursor-data",
      }),
      "/home/user/project",
    );
    expect(tmux.sendKeys).not.toHaveBeenCalled();
  });

  it("resumes Cursor with the exact verified executable and tmux discovery env", async () => {
    const session = agentSession("cursor");
    (repo.findById as Mock).mockResolvedValue(session);
    (resolver.resolveResume as Mock).mockResolvedValue({
      provider: "cursor",
      nativeSessionId: "chat-1",
      resumeFlags: ["--resume", "chat-1"],
      argvOverride: null,
    });
    const resolveVerifiedProviderExecutable = vi
      .fn()
      .mockResolvedValue("/verified/cursor agent");
    const useCase = new RestartAgentUseCase(
      repo,
      tmux,
      resolver,
      resolveVerifiedProviderExecutable,
    );

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(resolver.resolveResume).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ CURSOR_DATA_DIR: "/session/cursor-data" }),
    );
    expect(tmux.sendKeys).toHaveBeenCalledWith(
      expect.any(String),
      "CURSOR_DATA_DIR='/session/cursor-data' '/verified/cursor agent' --resume chat-1",
    );
  });

  it("restarts a Cursor loop session with the verified executable", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession("cursor", "loop"));
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(
      repo,
      tmux,
      resolver,
      vi.fn().mockResolvedValue("/verified/cursor-agent"),
    );

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(
      expect.any(String),
      "CURSOR_DATA_DIR='/session/cursor-data' '/verified/cursor-agent'",
    );
  });

  it("re-injects a process-level Cursor data root before relaunch", async () => {
    vi.stubEnv("CURSOR_DATA_DIR", "/operator/cursor-data");
    (tmux.getEnvironment as Mock).mockResolvedValue({
      toRecord: () => ({ PATH: "/session/bin" }),
    });
    (repo.findById as Mock).mockResolvedValue(agentSession("cursor"));
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(
      repo,
      tmux,
      resolver,
      vi.fn().mockResolvedValue("/verified/cursor-agent"),
    );

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.setEnvironment).toHaveBeenCalledOnce();
    const [, injected] = (tmux.setEnvironment as Mock).mock.calls[0];
    expect(injected.toRecord()).toEqual({ CURSOR_DATA_DIR: "/operator/cursor-data" });
    expect((tmux.setEnvironment as Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (tmux.sendKeys as Mock).mock.invocationCallOrder[0],
    );
  });

  it("resumes Kimi with kimi --session <id> through the generic path (no fingerprinting)", async () => {
    const session = agentSession("kimi");
    (repo.findById as Mock).mockResolvedValue(session);
    (resolver.resolveResume as Mock).mockResolvedValue({
      provider: "kimi",
      nativeSessionId: "01JZK2ABC",
      resumeFlags: ["--session", "01JZK2ABC"],
      argvOverride: null,
    });
    // No executable resolver injected: the default gates only Cursor's generic
    // `agent` command and passes provider-specific names like `kimi` through.
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    const out = await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(resolver.resolveResume).toHaveBeenCalledWith(session, expect.any(Object));
    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "kimi --session 01JZK2ABC");
    expect(out.resumed).toBe(true);
  });

  it("restarts a Kimi loop session with a bare kimi command", async () => {
    (repo.findById as Mock).mockResolvedValue(agentSession("kimi", "loop"));
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith(expect.any(String), "kimi");
  });

  it("passes a binding-carried KIMI_CODE_HOME to Kimi resume discovery and relaunch", async () => {
    (tmux.getEnvironment as Mock).mockResolvedValue({
      toRecord: () => ({ PATH: "/session/bin" }),
    });
    const session = agentSession("kimi", "agent", {
      resumeBinding: { env: { KIMI_CODE_HOME: "/profiles/k/.kimi-code" } },
    });
    (repo.findById as Mock).mockResolvedValue(session);
    (resolver.resolveResume as Mock).mockResolvedValue({
      provider: "kimi",
      nativeSessionId: "01JZK2ABC",
      resumeFlags: ["--session", "01JZK2ABC"],
      argvOverride: null,
    });
    const useCase = new RestartAgentUseCase(repo, tmux, resolver);

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    expect(resolver.resolveResume).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ KIMI_CODE_HOME: "/profiles/k/.kimi-code" }),
    );
    // Binding env is mirrored into tmux BEFORE the relaunch, then shell-quoted
    // onto the command — same shape agent-relaunch.ts produces for this row.
    expect(tmux.setEnvironment).toHaveBeenCalledOnce();
    const [, injected] = (tmux.setEnvironment as Mock).mock.calls[0];
    expect(injected.toRecord()).toEqual({
      KIMI_CODE_HOME: "/profiles/k/.kimi-code",
    });
    expect((tmux.setEnvironment as Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (tmux.sendKeys as Mock).mock.invocationCallOrder[0],
    );
    expect(tmux.sendKeys).toHaveBeenCalledWith(
      expect.any(String),
      "KIMI_CODE_HOME='/profiles/k/.kimi-code' kimi --session 01JZK2ABC",
    );
  });

  it("lets a live tmux CURSOR_DATA_DIR win over a stale resume-binding value", async () => {
    // Tmux-wins (matches discoveryEnv precedence): the binding's stale data
    // root must not clobber the live session value — no set-environment for
    // the var, and the command prefix carries the LIVE value.
    (tmux.getEnvironment as Mock).mockResolvedValue({
      toRecord: () => ({
        PATH: "/session/bin",
        CURSOR_DATA_DIR: "/live/cursor-data",
      }),
    });
    const session = agentSession("cursor", "agent", {
      resumeBinding: { env: { CURSOR_DATA_DIR: "/stale/binding-data" } },
    });
    (repo.findById as Mock).mockResolvedValue(session);
    (resolver.resolveResume as Mock).mockResolvedValue(null);
    const useCase = new RestartAgentUseCase(
      repo,
      tmux,
      resolver,
      vi.fn().mockResolvedValue("/verified/cursor-agent"),
    );

    await useCase.execute({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-123",
    });

    // Discovery already saw the live value (tmux wins in launchEnv).
    expect(resolver.resolveResume).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ CURSOR_DATA_DIR: "/live/cursor-data" }),
    );
    // Nothing to inject: tmux already carries the var.
    expect(tmux.setEnvironment).not.toHaveBeenCalled();
    expect(tmux.sendKeys).toHaveBeenCalledWith(
      expect.any(String),
      "CURSOR_DATA_DIR='/live/cursor-data' '/verified/cursor-agent'",
    );
  });
});
