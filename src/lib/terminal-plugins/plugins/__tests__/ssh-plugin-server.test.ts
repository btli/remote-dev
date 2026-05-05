// @vitest-environment node
/**
 * Unit tests for the SSH server plugin. Mocks SshConnectionService so we
 * can exercise argv construction for each auth type and verify
 * lifecycle methods (validateInput, exit, restart) without a DB or PTY.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/ssh-connection-service", () => ({
  get: vi.fn(),
  markUsed: vi.fn().mockResolvedValue(undefined),
  getDecryptedPassword: vi.fn(),
  getPrivateKeyPath: vi.fn((id: string) => `/tmp/rdv-test-ssh/${id}/id`),
  getKnownHostsPath: vi.fn(
    (id: string) => `/tmp/rdv-test-ssh/${id}/known_hosts`
  ),
}));

import * as SshService from "@/services/ssh-connection-service";

const mockGet = SshService.get as unknown as ReturnType<typeof vi.fn>;
const mockMarkUsed = SshService.markUsed as unknown as ReturnType<typeof vi.fn>;
const mockGetDecryptedPassword = SshService.getDecryptedPassword as unknown as ReturnType<typeof vi.fn>;

import {
  SshServerPlugin,
  buildSshArgs,
} from "../ssh-plugin-server";
import type {
  SshAuthType,
  SshConnection,
  SshKnownHostsPolicy,
} from "@/services/ssh-connection-service";
import type { CreateSessionInput, TerminalSession } from "@/types/session";

function makeConnection(overrides: Partial<SshConnection> = {}): SshConnection {
  return {
    id: "conn-1",
    userId: "user-1",
    projectId: null,
    name: "test",
    host: "example.com",
    port: 2222,
    username: "alice",
    authType: "key" as SshAuthType,
    hasPassphrase: false,
    passwordEnc: null,
    knownHostsPolicy: "accept-new" as SshKnownHostsPolicy,
    extraOptions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockMarkUsed.mockReset();
  mockMarkUsed.mockResolvedValue(undefined);
  mockGetDecryptedPassword.mockReset();
});

describe("buildSshArgs", () => {
  it("builds key-auth args with -i, IdentitiesOnly, and accept-new", () => {
    const conn = makeConnection({ authType: "key" });
    const args = buildSshArgs(conn);
    expect(args).toContain("-p");
    expect(args).toContain("2222");
    expect(args).toContain("-i");
    expect(args).toContain(`/tmp/rdv-test-ssh/${conn.id}/id`);
    expect(args).toContain("IdentitiesOnly=yes");
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain(`UserKnownHostsFile=/tmp/rdv-test-ssh/${conn.id}/known_hosts`);
    expect(args[args.length - 1]).toBe("alice@example.com");
  });

  it("emits -A for agent auth and no -i", () => {
    const conn = makeConnection({ authType: "agent" });
    const args = buildSshArgs(conn);
    expect(args).toContain("-A");
    expect(args).not.toContain("-i");
  });

  it("emits no auth flag for password auth (sshpass injects via SSHPASS)", () => {
    const conn = makeConnection({ authType: "password" });
    const args = buildSshArgs(conn);
    expect(args).not.toContain("-A");
    expect(args).not.toContain("-i");
    // user@host still required.
    expect(args[args.length - 1]).toBe("alice@example.com");
  });

  it("emits no auth flag for system auth", () => {
    const conn = makeConnection({ authType: "system" });
    const args = buildSshArgs(conn);
    expect(args).not.toContain("-A");
    expect(args).not.toContain("-i");
  });

  it("strict policy uses StrictHostKeyChecking=yes + per-conn known_hosts", () => {
    const conn = makeConnection({ knownHostsPolicy: "strict" });
    const args = buildSshArgs(conn);
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain(
      `UserKnownHostsFile=/tmp/rdv-test-ssh/${conn.id}/known_hosts`
    );
  });

  it("'no' policy disables host checking and sends known_hosts to /dev/null", () => {
    const conn = makeConnection({ knownHostsPolicy: "no" });
    const args = buildSshArgs(conn);
    expect(args).toContain("StrictHostKeyChecking=no");
    expect(args).toContain("UserKnownHostsFile=/dev/null");
  });

  it("appends extraOptions verbatim before user@host", () => {
    const conn = makeConnection({
      extraOptions: ["-o", "ServerAliveInterval=60", "-vv"],
    });
    const args = buildSshArgs(conn);
    const idx = args.indexOf("ServerAliveInterval=60");
    expect(idx).toBeGreaterThan(-1);
    expect(args).toContain("-vv");
    expect(args[args.length - 1]).toBe("alice@example.com");
  });
});

describe("SshServerPlugin.createSession", () => {
  const baseInput: CreateSessionInput = {
    name: "ssh-1",
    projectId: "proj-1",
    sshConnectionId: "conn-1",
    terminalType: "ssh",
  };
  const stub: Partial<TerminalSession> = { userId: "user-1" };

  it("uses ssh as the shell command for key auth", async () => {
    mockGet.mockResolvedValue(makeConnection({ authType: "key" }));
    const config = await SshServerPlugin.createSession(baseInput, stub);
    expect(config.shellCommand).toBe("ssh");
    expect(config.shellArgs[0]).toBe("-p");
    expect(config.environment.TERM).toBe("xterm-256color");
    expect(config.useTmux).toBe(true);
    expect(config.metadata).toMatchObject({
      connectionId: "conn-1",
      host: "example.com",
      user: "alice",
      port: 2222,
      authType: "key",
      exitState: "running",
    });
  });

  it("wraps with sshpass and injects SSHPASS for password auth", async () => {
    mockGet.mockResolvedValue(makeConnection({ authType: "password", passwordEnc: "ENCRYPTED" }));
    mockGetDecryptedPassword.mockReturnValue("hunter2");
    const config = await SshServerPlugin.createSession(baseInput, stub);
    expect(config.shellCommand).toBe("sshpass");
    expect(config.shellArgs[0]).toBe("-e");
    expect(config.shellArgs[1]).toBe("ssh");
    expect(config.environment.SSHPASS).toBe("hunter2");
  });

  it("throws when password auth has no stored password", async () => {
    mockGet.mockResolvedValue(makeConnection({ authType: "password", passwordEnc: null }));
    mockGetDecryptedPassword.mockReturnValue(null);
    await expect(SshServerPlugin.createSession(baseInput, stub)).rejects.toThrow(
      /password auth/
    );
  });

  it("calls markUsed (fire-and-forget) on success", async () => {
    mockGet.mockResolvedValue(makeConnection({ authType: "agent" }));
    await SshServerPlugin.createSession(baseInput, stub);
    expect(mockMarkUsed).toHaveBeenCalledWith("conn-1");
  });

  it("rejects when sshConnectionId is missing", async () => {
    await expect(
      SshServerPlugin.createSession({ ...baseInput, sshConnectionId: undefined }, stub)
    ).rejects.toThrow(/sshConnectionId is required/);
  });

  it("rejects when userId is missing on the session stub", async () => {
    mockGet.mockResolvedValue(makeConnection());
    await expect(
      SshServerPlugin.createSession(baseInput, {})
    ).rejects.toThrow(/userId is required/);
  });

  it("propagates 'connection not found' errors from the service", async () => {
    mockGet.mockResolvedValue(null);
    await expect(SshServerPlugin.createSession(baseInput, stub)).rejects.toThrow(
      /not found/
    );
  });
});

describe("SshServerPlugin.validateInput", () => {
  it("requires name", () => {
    const result = SshServerPlugin.validateInput?.({
      name: "",
      projectId: "p",
      sshConnectionId: "c",
    } as CreateSessionInput);
    expect(result).toMatch(/name is required/i);
  });

  it("requires sshConnectionId", () => {
    const result = SshServerPlugin.validateInput?.({
      name: "x",
      projectId: "p",
    } as CreateSessionInput);
    expect(result).toMatch(/sshConnectionId/);
  });

  it("returns null for valid input", () => {
    const result = SshServerPlugin.validateInput?.({
      name: "x",
      projectId: "p",
      sshConnectionId: "c",
    } as CreateSessionInput);
    expect(result).toBeNull();
  });
});

describe("SshServerPlugin lifecycle hooks", () => {
  it("onSessionExit returns showExitScreen + canRestart", () => {
    const behavior = SshServerPlugin.onSessionExit?.(
      { id: "s1" } as TerminalSession,
      0
    );
    expect(behavior).toMatchObject({
      showExitScreen: true,
      canRestart: true,
      autoClose: false,
    });
  });

  it("onSessionExit produces network-error message for exit code 255", () => {
    const behavior = SshServerPlugin.onSessionExit?.(
      { id: "s1" } as TerminalSession,
      255
    );
    expect(behavior?.exitMessage).toMatch(/connection failed/i);
  });

  it("onSessionRestart rebuilds config from typeMetadata.connectionId", async () => {
    mockGet.mockResolvedValue(makeConnection({ authType: "key" }));
    const session: TerminalSession = {
      id: "s1",
      userId: "user-1",
      name: "ssh-1",
      tmuxSessionName: "rdv-x",
      projectPath: null,
      githubRepoId: null,
      worktreeBranch: null,
      worktreeType: null,
      projectId: "p",
      profileId: null,
      terminalType: "ssh",
      agentProvider: null,
      agentExitState: "exited",
      agentExitCode: 0,
      agentExitedAt: new Date(),
      agentRestartCount: 0,
      agentActivityStatus: null,
      typeMetadata: { connectionId: "conn-1" },
      scopeKey: null,
      parentSessionId: null,
      status: "active",
      pinned: false,
      tabOrder: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const config = await SshServerPlugin.onSessionRestart?.(session);
    expect(config).not.toBeNull();
    expect(config?.shellCommand).toBe("ssh");
  });

  it("onSessionRestart returns null when typeMetadata is missing connectionId", async () => {
    const session = {
      id: "s1",
      userId: "user-1",
      typeMetadata: null,
    } as unknown as TerminalSession;
    const config = await SshServerPlugin.onSessionRestart?.(session);
    expect(config).toBeNull();
  });
});

describe("SshServerPlugin.canHandle", () => {
  it("matches sessions whose terminalType === 'ssh'", () => {
    expect(
      SshServerPlugin.canHandle?.({ terminalType: "ssh" } as TerminalSession)
    ).toBe(true);
    expect(
      SshServerPlugin.canHandle?.({ terminalType: "shell" } as TerminalSession)
    ).toBe(false);
  });
});
