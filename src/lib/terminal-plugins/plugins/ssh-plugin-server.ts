/**
 * SshPlugin (server half) — lifecycle for SSH terminal sessions.
 *
 * The `ssh` command (or `sshpass ssh ...` for password auth) runs as the
 * tmux shell process. When the SSH process exits — either because the
 * remote shell closed or the connection dropped — the tmux session exits
 * too and the client surfaces the exit screen with a Reconnect button,
 * mirroring the agent plugin's UX.
 *
 * Connection details (host, user, port, auth method, options) come from
 * the `ssh_connection` DB table. The plugin loads the row by
 * `input.sshConnectionId` at create time and bakes the resolved settings
 * into `SessionConfig`.
 *
 * @see ./ssh-plugin-client.tsx for rendering.
 * @see src/services/ssh-connection-service.ts
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
  SshSessionMetadata,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import * as SshConnectionService from "@/services/ssh-connection-service";
import type { SshConnection } from "@/services/ssh-connection-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("SshPlugin");

/**
 * Build the ssh argv for a given connection. Returned array is suitable
 * either as `args` to `ssh` directly, or as the tail args after `-e ssh`
 * for sshpass.
 */
export function buildSshArgs(connection: SshConnection): string[] {
  const args: string[] = [];

  args.push("-p", String(connection.port));
  args.push("-o", "ConnectTimeout=10");

  // Known hosts handling.
  switch (connection.knownHostsPolicy) {
    case "strict":
      args.push("-o", "StrictHostKeyChecking=yes");
      args.push(
        "-o",
        `UserKnownHostsFile=${SshConnectionService.getKnownHostsPath(connection.id)}`
      );
      break;
    case "no":
      args.push("-o", "StrictHostKeyChecking=no");
      args.push("-o", "UserKnownHostsFile=/dev/null");
      break;
    case "accept-new":
    default:
      args.push("-o", "StrictHostKeyChecking=accept-new");
      args.push(
        "-o",
        `UserKnownHostsFile=${SshConnectionService.getKnownHostsPath(connection.id)}`
      );
      break;
  }

  // Auth method.
  switch (connection.authType) {
    case "key":
      args.push("-i", SshConnectionService.getPrivateKeyPath(connection.id));
      // IdentitiesOnly avoids the agent silently providing a different key.
      args.push("-o", "IdentitiesOnly=yes");
      break;
    case "agent":
      args.push("-A");
      break;
    case "password":
      // sshpass injects the password via SSHPASS env (see -e flag); no flag here.
      break;
    case "system":
      // Lean on the user's ~/.ssh/config — nothing to add.
      break;
  }

  // User-provided extra options.
  if (connection.extraOptions) {
    for (const opt of connection.extraOptions) {
      const trimmed = opt.trim();
      if (!trimmed) continue;
      args.push(trimmed);
    }
  }

  // Final positional: user@host
  args.push(`${connection.username}@${connection.host}`);

  return args;
}

function buildExitMessage(exitCode: number | null): string {
  if (exitCode === 0) return "SSH session closed";
  if (exitCode === null) return "SSH session terminated";
  if (exitCode === 130) return "SSH session interrupted (Ctrl+C)";
  if (exitCode === 255) return "SSH connection failed (network or auth)";
  return `SSH session exited with code ${exitCode}`;
}

interface BuildResult {
  shellCommand: string;
  shellArgs: string[];
  environment: Record<string, string>;
}

function buildShellInvocation(
  connection: SshConnection
): BuildResult {
  const sshArgs = buildSshArgs(connection);

  if (connection.authType === "password") {
    const password = SshConnectionService.getDecryptedPassword(connection);
    if (!password) {
      throw new Error(
        `SSH connection ${connection.id} is configured for password auth but has no stored password`
      );
    }
    return {
      shellCommand: "sshpass",
      shellArgs: ["-e", "ssh", ...sshArgs],
      environment: {
        SSHPASS: password,
        TERM: "xterm-256color",
      },
    };
  }

  return {
    shellCommand: "ssh",
    shellArgs: sshArgs,
    environment: {
      TERM: "xterm-256color",
    },
  };
}

async function loadConnection(
  connectionId: string,
  userId: string
): Promise<SshConnection> {
  const conn = await SshConnectionService.get(connectionId, userId);
  if (!conn) {
    throw new Error(`SSH connection not found: ${connectionId}`);
  }
  return conn;
}

/** Create a server-side SSH plugin */
export function createSshServerPlugin(): TerminalTypeServerPlugin {
  return {
    type: "ssh",
    priority: 80,
    builtIn: true,
    useTmux: true,

    async createSession(
      input: CreateSessionInput,
      session: Partial<TerminalSession>
    ): Promise<SessionConfig> {
      if (!input.sshConnectionId) {
        throw new Error("sshConnectionId is required for ssh terminal type");
      }
      if (!session.userId) {
        throw new Error("userId is required for ssh terminal type");
      }

      const connection = await loadConnection(input.sshConnectionId, session.userId);
      const { shellCommand, shellArgs, environment } = buildShellInvocation(connection);

      const metadata: SshSessionMetadata = {
        connectionId: connection.id,
        host: connection.host,
        user: connection.username,
        port: connection.port,
        authType: connection.authType,
        exitState: "running",
        exitCode: null,
        exitedAt: null,
        restartCount: 0,
        lastStartedAt: new Date(),
      };

      // Mark used (fire-and-forget — DB write should not block session create).
      SshConnectionService.markUsed(connection.id).catch((err) => {
        log.warn("Failed to mark ssh connection as used", {
          connectionId: connection.id,
          error: String(err),
        });
      });

      return {
        shellCommand,
        shellArgs,
        environment,
        cwd: input.projectPath,
        useTmux: true,
        metadata,
      };
    },

    onSessionExit(_session: TerminalSession, exitCode: number | null): ExitBehavior {
      return {
        showExitScreen: true,
        canRestart: true,
        autoClose: false,
        exitMessage: buildExitMessage(exitCode),
      };
    },

    async onSessionRestart(session: TerminalSession): Promise<SessionConfig | null> {
      const meta = (session.typeMetadata as SshSessionMetadata | null) ?? null;
      const connectionId = meta?.connectionId;
      if (!connectionId) {
        log.warn("Cannot restart ssh session — missing connectionId in metadata", {
          sessionId: session.id,
        });
        return null;
      }
      const connection = await loadConnection(connectionId, session.userId);
      const { shellCommand, shellArgs, environment } = buildShellInvocation(connection);
      return {
        shellCommand,
        shellArgs,
        environment,
        cwd: session.projectPath ?? undefined,
        useTmux: true,
      };
    },

    validateInput(input: CreateSessionInput): string | null {
      if (!input.name?.trim()) return "Session name is required";
      if (!input.sshConnectionId) return "sshConnectionId is required";
      return null;
    },

    canHandle(session: TerminalSession): boolean {
      return session.terminalType === "ssh";
    },
  };
}

/** Default SSH server plugin instance */
export const SshServerPlugin = createSshServerPlugin();
