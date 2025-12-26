/**
 * Port Monitoring Service
 *
 * Monitors localhost ports to detect which ports are actively listening.
 * Uses lsof on macOS/Linux with fallback to netstat on Windows.
 */
import { execFileNoThrow } from "@/lib/exec";
import type { PortStatus } from "@/types/port";

// ============================================================================
// Port Monitoring
// ============================================================================

/**
 * Check which ports from the given list are currently listening on localhost.
 *
 * @param ports - Array of port numbers to check
 * @returns Array of PortStatus objects with listening status
 */
export async function checkPorts(ports: number[]): Promise<PortStatus[]> {
  if (ports.length === 0) {
    return [];
  }

  // Get all listening ports on the system
  const listeningPorts = await getListeningPorts();

  return ports.map((port) => {
    const status = listeningPorts.get(port);
    return {
      port,
      isListening: !!status,
      process: status?.process,
      pid: status?.pid,
    };
  });
}

/**
 * Get all ports currently listening on localhost.
 *
 * @returns Map of port number to process info
 */
export async function getListeningPorts(): Promise<
  Map<number, { process?: string; pid?: number }>
> {
  const result = new Map<number, { process?: string; pid?: number }>();

  // Try lsof first (macOS/Linux)
  const lsofResult = await execFileNoThrow("lsof", [
    "-i",
    "-P",
    "-n",
    "-sTCP:LISTEN",
  ]);

  if (lsofResult.exitCode === 0 && lsofResult.stdout) {
    parseLsofOutput(lsofResult.stdout, result);
    return result;
  }

  // Fallback to netstat (Linux/Windows)
  const netstatResult = await execFileNoThrow("netstat", ["-tlnp"]);

  if (netstatResult.exitCode === 0 && netstatResult.stdout) {
    parseNetstatOutput(netstatResult.stdout, result);
    return result;
  }

  // Last resort: ss command (modern Linux)
  const ssResult = await execFileNoThrow("ss", ["-tlnp"]);

  if (ssResult.exitCode === 0 && ssResult.stdout) {
    parseSsOutput(ssResult.stdout, result);
  }

  return result;
}

/**
 * Check if a specific port is listening on localhost.
 *
 * @param port - Port number to check
 * @returns true if the port is listening
 */
export async function isPortListening(port: number): Promise<boolean> {
  // Use a quick targeted check with lsof
  const result = await execFileNoThrow("lsof", [
    "-i",
    `:${port}`,
    "-P",
    "-n",
    "-sTCP:LISTEN",
  ]);

  return result.exitCode === 0 && result.stdout.length > 0;
}

/**
 * Get detailed info about what's using a specific port.
 *
 * @param port - Port number to check
 * @returns Process info or null if port is not in use
 */
export async function getPortInfo(
  port: number
): Promise<{ process: string; pid: number; user?: string } | null> {
  const result = await execFileNoThrow("lsof", [
    "-i",
    `:${port}`,
    "-P",
    "-n",
    "-sTCP:LISTEN",
  ]);

  if (result.exitCode !== 0 || !result.stdout) {
    return null;
  }

  // Parse the first matching line
  const lines = result.stdout.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    // Only header, no data
    return null;
  }

  // Skip header, get first data line
  const dataLine = lines[1];
  const parts = dataLine.split(/\s+/);

  if (parts.length >= 2) {
    return {
      process: parts[0],
      pid: parseInt(parts[1], 10),
      user: parts.length >= 3 ? parts[2] : undefined,
    };
  }

  return null;
}

// ============================================================================
// Output Parsers
// ============================================================================

/**
 * Parse lsof output to extract listening ports.
 *
 * lsof format:
 * COMMAND   PID   USER   FD   TYPE   DEVICE   SIZE/OFF   NODE   NAME
 * node    12345   user   23u  IPv4   0x12345  0t0        TCP    *:3000 (LISTEN)
 */
function parseLsofOutput(
  output: string,
  result: Map<number, { process?: string; pid?: number }>
): void {
  const lines = output.split("\n");

  for (const line of lines) {
    // Skip header
    if (line.startsWith("COMMAND") || !line.trim()) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    const name = parts[8];

    // Extract port from NAME field (e.g., "*:3000", "127.0.0.1:3000", "[::1]:3000")
    const portMatch = name.match(/:(\d+)\s*\(LISTEN\)/);
    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (!result.has(port)) {
        result.set(port, { process: command, pid });
      }
    }
  }
}

/**
 * Parse netstat -tlnp output (Linux).
 *
 * netstat format:
 * Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
 * tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN      12345/node
 */
function parseNetstatOutput(
  output: string,
  result: Map<number, { process?: string; pid?: number }>
): void {
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.includes("LISTEN")) continue;

    const parts = line.split(/\s+/).filter((p) => p);
    if (parts.length < 7) continue;

    const localAddr = parts[3];
    const pidProgram = parts[6];

    // Extract port from local address (e.g., "0.0.0.0:3000", ":::3000")
    const portMatch = localAddr.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);

    // Extract PID and program name (e.g., "12345/node")
    const pidMatch = pidProgram.match(/^(\d+)\/(.+)$/);
    if (pidMatch) {
      result.set(port, {
        pid: parseInt(pidMatch[1], 10),
        process: pidMatch[2],
      });
    } else if (!result.has(port)) {
      result.set(port, {});
    }
  }
}

/**
 * Parse ss -tlnp output (modern Linux).
 *
 * ss format:
 * State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
 * LISTEN 0      128    *:3000              *:*               users:(("node",pid=12345,fd=23))
 */
function parseSsOutput(
  output: string,
  result: Map<number, { process?: string; pid?: number }>
): void {
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.startsWith("LISTEN")) continue;

    // Extract port from Local Address column
    const portMatch = line.match(/[*:](\d+)\s+/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);

    // Extract process info from users:((... ))
    const usersMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (usersMatch) {
      result.set(port, {
        process: usersMatch[1],
        pid: parseInt(usersMatch[2], 10),
      });
    } else if (!result.has(port)) {
      result.set(port, {});
    }
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Get status of all ports in a range.
 * Useful for suggesting available ports.
 *
 * @param startPort - Starting port number
 * @param endPort - Ending port number (inclusive)
 * @returns Array of available port numbers
 */
export async function findAvailablePorts(
  startPort: number,
  endPort: number,
  count: number = 5
): Promise<number[]> {
  const listeningPorts = await getListeningPorts();
  const available: number[] = [];

  for (let port = startPort; port <= endPort && available.length < count; port++) {
    if (!listeningPorts.has(port)) {
      available.push(port);
    }
  }

  return available;
}
