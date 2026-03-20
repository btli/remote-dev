/**
 * TerminalServerDrainGateway - Communicates with the terminal server's
 * internal HTTP API to broadcast drain warnings and query session counts.
 *
 * Uses the same server discovery pattern as the rdv CLI:
 * RDV_TERMINAL_SOCKET > RDV_TERMINAL_PORT > fallback to 6002.
 */

import type { SessionDrainGateway, DrainStatus } from "@/application/ports/SessionDrainGateway";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "@/lib/logger";

const log = createLogger("TerminalServerDrainGateway");

const DEFAULT_TERMINAL_PORT = 6002;

export class TerminalServerDrainGateway implements SessionDrainGateway {
  private cachedConnectionOptions: { socketPath?: string; hostname?: string; port?: number } | null = null;

  private getConnectionOptions(): { socketPath?: string; hostname?: string; port?: number } {
    if (this.cachedConnectionOptions) return this.cachedConnectionOptions;

    const result = this.resolveConnectionOptions();
    this.cachedConnectionOptions = result;
    return result;
  }

  private resolveConnectionOptions(): { socketPath?: string; hostname?: string; port?: number } {
    // Priority 1: explicit socket path
    const socketEnv = process.env.RDV_TERMINAL_SOCKET;
    if (socketEnv) {
      return { socketPath: socketEnv };
    }

    // Priority 2: explicit port
    const portEnv = process.env.RDV_TERMINAL_PORT;
    if (portEnv) {
      const port = parseInt(portEnv, 10);
      if (!isNaN(port)) {
        return { hostname: "127.0.0.1", port };
      }
    }

    // Priority 3: auto-detect socket
    const dataDir = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
    const socketPath = join(dataDir, "run", "terminal.sock");
    if (existsSync(socketPath)) {
      return { socketPath };
    }

    // Priority 4: fallback TCP
    return { hostname: "127.0.0.1", port: DEFAULT_TERMINAL_PORT };
  }

  async notifyDrain(countdownSeconds: number, version: string): Promise<DrainStatus> {
    const body = JSON.stringify({ countdownSeconds, version });
    return this.postInternal("/internal/drain", body);
  }

  async getActiveSessionCount(): Promise<DrainStatus> {
    return this.postInternal("/internal/drain-status", "{}");
  }

  private postInternal(path: string, body: string): Promise<DrainStatus> {
    const connOpts = this.getConnectionOptions();

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          ...connOpts,
          method: "POST",
          path,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            host: "localhost",
          },
        },
        (res) => {
          let responseBody = "";
          res.on("data", (chunk: Buffer) => {
            responseBody += chunk.toString();
          });
          res.on("end", () => {
            try {
              const data = JSON.parse(responseBody);
              resolve({
                activeSessions: data.activeSessions ?? 0,
                activeAgentSessions: data.activeAgentSessions ?? 0,
              });
            } catch {
              log.warn("Invalid JSON from terminal server", { path, responseBody });
              resolve({ activeSessions: 0, activeAgentSessions: 0 });
            }
          });
        }
      );

      req.setTimeout(5_000, () => {
        req.destroy();
        reject(new Error(`Timeout connecting to terminal server at ${path}`));
      });

      req.on("error", (err) => {
        log.warn("Failed to reach terminal server", { path, error: err.message });
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }
}
