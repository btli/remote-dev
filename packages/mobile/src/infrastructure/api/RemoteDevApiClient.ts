import type {
  TerminalSessionDTO,
  FolderDTO,
  CreateSessionInput,
  CreateFolderInput,
} from "@remote-dev/domain";

interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Custom error class for API errors with status code and response data.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly response?: unknown;

  constructor(message: string, statusCode: number, response?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.response = response;
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}

/**
 * Remote Dev API client.
 * Handles all HTTP communication with the backend.
 */
export class RemoteDevApiClient {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  /**
   * Update API key for authenticated requests.
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Clear API key (logout).
   */
  clearApiKey(): void {
    this.config.apiKey = undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sessions API
  // ─────────────────────────────────────────────────────────────────────────────

  async getSessions(): Promise<TerminalSessionDTO[]> {
    return this.get<TerminalSessionDTO[]>("/api/sessions");
  }

  async getSession(id: string): Promise<TerminalSessionDTO> {
    return this.get<TerminalSessionDTO>(`/api/sessions/${id}`);
  }

  async createSession(input: CreateSessionInput): Promise<TerminalSessionDTO> {
    return this.post<TerminalSessionDTO>("/api/sessions", input);
  }

  async closeSession(id: string): Promise<void> {
    await this.delete(`/api/sessions/${id}`);
  }

  async suspendSession(id: string): Promise<TerminalSessionDTO> {
    return this.post<TerminalSessionDTO>(`/api/sessions/${id}/suspend`, {});
  }

  async resumeSession(id: string): Promise<TerminalSessionDTO> {
    return this.post<TerminalSessionDTO>(`/api/sessions/${id}/resume`, {});
  }

  async getSessionToken(id: string): Promise<string> {
    const response = await this.get<{ token: string }>(`/api/sessions/${id}/token`);
    return response.token;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Folders API
  // ─────────────────────────────────────────────────────────────────────────────

  async getFolders(): Promise<FolderDTO[]> {
    return this.get<FolderDTO[]>("/api/folders");
  }

  async createFolder(input: CreateFolderInput): Promise<FolderDTO> {
    return this.post<FolderDTO>("/api/folders", input);
  }

  async deleteFolder(id: string): Promise<void> {
    await this.delete(`/api/folders/${id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth API
  // ─────────────────────────────────────────────────────────────────────────────

  async validateApiKey(): Promise<{ userId: string; email: string }> {
    return this.get<{ userId: string; email: string }>("/api/auth/me");
  }

  async exchangeCfToken(cfToken: string): Promise<{ apiKey: string; userId: string; email: string }> {
    return this.post<{ apiKey: string; userId: string; email: string }>(
      "/api/auth/mobile-exchange",
      { cfToken }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Notifications API
  // ─────────────────────────────────────────────────────────────────────────────

  async registerPushToken(token: string): Promise<void> {
    await this.post("/api/notifications/register", { token });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = typeof errorData?.message === "string"
          ? errorData.message
          : `HTTP ${response.status}: ${response.statusText}`;
        throw new ApiError(message, response.status, errorData);
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) {
        return undefined as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      // Re-throw ApiError as-is
      if (ApiError.isApiError(error)) {
        throw error;
      }
      // Wrap other errors as network errors
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Network error: ${message}`);
    }
  }
}

// Singleton instance
let apiClient: RemoteDevApiClient | null = null;

export function getApiClient(): RemoteDevApiClient {
  if (!apiClient) {
    apiClient = new RemoteDevApiClient({
      baseUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:6001",
    });
  }
  return apiClient;
}

export function initApiClient(config: ApiConfig): RemoteDevApiClient {
  apiClient = new RemoteDevApiClient(config);
  return apiClient;
}

/**
 * Reinitialize the API client with a new base URL.
 * Called when server URL changes in config store.
 * Preserves existing API key.
 */
export function updateApiClientUrl(baseUrl: string): void {
  const existingKey = apiClient?.["config"]?.apiKey;
  apiClient = new RemoteDevApiClient({ baseUrl, apiKey: existingKey });
}
