/**
 * Scheduler Client - Communicates with the terminal server's scheduler API
 *
 * This client is used by the Next.js API routes to notify the terminal server
 * (which runs the actual scheduler) about schedule changes.
 *
 * Supports both TCP port mode (development) and Unix socket mode (production).
 */

import http from "http";

/**
 * Get the terminal server socket path if using Unix socket mode
 */
function getTerminalSocket(): string | null {
  return process.env.TERMINAL_SOCKET || null;
}

/**
 * Get the terminal server URL for port mode
 */
function getTerminalServerUrl(): string {
  // Allow explicit override for complex deployments
  if (process.env.TERMINAL_SERVER_URL) {
    return process.env.TERMINAL_SERVER_URL;
  }

  // Default to localhost with TERMINAL_PORT
  const port = process.env.TERMINAL_PORT || "6002";
  return `http://127.0.0.1:${port}`;
}

/**
 * Get the internal auth secret (shared between Next.js and terminal server)
 */
function getAuthSecret(): string {
  return process.env.AUTH_SECRET || "development-secret";
}

/**
 * Make an HTTP request over a Unix socket
 */
function socketRequest(
  socketPath: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  return new Promise((resolve) => {
    const postData = body ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      socketPath,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthSecret()}`,
        ...(postData && { "Content-Length": Buffer.byteLength(postData) }),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, data: parsed });
          } else {
            resolve({ success: false, error: parsed.error || `HTTP ${res.statusCode}` });
          }
        } catch {
          resolve({ success: false, error: "Invalid response" });
        }
      });
    });

    req.on("error", (error) => {
      console.warn(`[SchedulerClient] Socket request failed:`, error.message);
      resolve({ success: false, error: "Terminal server unavailable" });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Make a request to the terminal server's internal scheduler API
 * Automatically uses Unix socket or HTTP based on configuration
 */
async function schedulerRequest(
  action: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  const socketPath = getTerminalSocket();
  const path = `/internal/scheduler/${action}`;

  // Use Unix socket if configured
  if (socketPath) {
    return socketRequest(socketPath, path, body);
  }

  // Fall back to HTTP for port mode
  const baseUrl = getTerminalServerUrl();
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthSecret()}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[SchedulerClient] ${action} failed:`, response.status, errorData);
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    // Connection errors are expected if terminal server isn't running
    // Log but don't throw - the schedule is still saved in the database
    console.warn(`[SchedulerClient] Failed to notify terminal server (${action}):`, error);
    return { success: false, error: "Terminal server unavailable" };
  }
}

/**
 * Notify the scheduler to add a new job
 */
export async function notifyScheduleCreated(scheduleId: string): Promise<boolean> {
  const result = await schedulerRequest("add", { scheduleId });
  return result.success;
}

/**
 * Notify the scheduler to update a job (re-register with new settings)
 */
export async function notifyScheduleUpdated(scheduleId: string): Promise<boolean> {
  const result = await schedulerRequest("update", { scheduleId });
  return result.success;
}

/**
 * Notify the scheduler to remove a job
 */
export async function notifyScheduleDeleted(scheduleId: string): Promise<boolean> {
  const result = await schedulerRequest("remove", { scheduleId });
  return result.success;
}

/**
 * Notify the scheduler to pause a job
 */
export async function notifySchedulePaused(scheduleId: string): Promise<boolean> {
  const result = await schedulerRequest("pause", { scheduleId });
  return result.success;
}

/**
 * Notify the scheduler to resume a job
 */
export async function notifyScheduleResumed(scheduleId: string): Promise<boolean> {
  const result = await schedulerRequest("resume", { scheduleId });
  return result.success;
}

/**
 * Notify the scheduler to remove all jobs for a session
 */
export async function notifySessionJobsRemoved(sessionId: string): Promise<boolean> {
  const result = await schedulerRequest("remove-session", { sessionId });
  return result.success;
}

/**
 * Get scheduler status from the terminal server
 */
export async function getSchedulerStatus(): Promise<{
  running: boolean;
  jobCount: number;
  jobs: Array<{
    scheduleId: string;
    name: string;
    scheduleType: string;
    nextRun: string | null;
    lastRun: string | null;
    lastStatus: string | null;
  }>;
} | null> {
  const result = await schedulerRequest("status");
  if (result.success && result.data) {
    return result.data as {
      running: boolean;
      jobCount: number;
      jobs: Array<{
        scheduleId: string;
        name: string;
        scheduleType: string;
        nextRun: string | null;
        lastRun: string | null;
        lastStatus: string | null;
      }>;
    };
  }
  return null;
}
