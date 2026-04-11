/**
 * Type definitions for the LiteLLM AI API proxy integration.
 *
 * LiteLLM runs as a DB-less child process. Model configs and proxy settings
 * are stored in our SQLite. Usage analytics are captured via webhook callbacks
 * and stored in a separate analytics SQLite database.
 */

/**
 * LiteLLM proxy configuration stored in the database.
 */
export interface LiteLLMConfig {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Model configuration stored in the database.
 * Each model maps to a `model_list` entry in the generated LiteLLM config.yaml.
 */
export interface LiteLLMModel {
  id: string;
  userId: string;
  modelName: string;
  provider: string;
  litellmModel: string;
  apiBase: string | null;
  keyPrefix: string | null;
  extraHeaders: string | null;
  priority: number;
  paused: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Supported LLM providers for model configuration.
 */
export type LiteLLMProvider =
  | "anthropic"
  | "databricks"
  | "openai"
  | "openrouter"
  | "azure"
  | "custom";

/**
 * Runtime status of the LiteLLM process.
 */
export interface LiteLLMStatus {
  installed: boolean;
  running: boolean;
  port: number | null;
  pid: number | null;
  version: string | null;
  uptime: number | null;
}

/**
 * Installation status check result.
 */
export type LiteLLMInstallStatus =
  | { installed: false; error?: string }
  | { installed: true; version: string; path: string };

/**
 * Input for updating LiteLLM config.
 */
export interface UpdateLiteLLMConfigInput {
  enabled?: boolean;
  autoStart?: boolean;
  port?: number;
}

/**
 * Input for adding a model to LiteLLM.
 */
export interface AddLiteLLMModelInput {
  modelName: string;
  provider: string;
  litellmModel: string;
  apiBase?: string;
  apiKey?: string;
  extraHeaders?: string;
  priority?: number;
  isDefault?: boolean;
}

/**
 * Usage analytics summary.
 */
export interface UsageStats {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  byDay?: Array<{
    date: string;
    requests: number;
    cost: number;
    tokens: number;
  }>;
  byModel?: Array<{
    modelName: string;
    requests: number;
    cost: number;
    tokens: number;
    avgLatencyMs: number;
  }>;
}

/**
 * Time-series data point for analytics charts.
 */
export interface TimeSeriesPoint {
  date: string;
  model: string | null;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
}

/**
 * Per-model analytics breakdown.
 */
export interface ModelBreakdown {
  model: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  avgDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/**
 * Per-session cost attribution.
 */
export interface SessionAttribution {
  sessionId: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  lastRequestAt: Date;
}

/**
 * Latency percentiles per model.
 */
export interface LatencyPercentiles {
  model: string;
  p50: number;
  p95: number;
  p99: number;
  avgDurationMs: number;
  sampleCount: number;
}

/**
 * LiteLLM process control actions.
 */
export type LiteLLMControlAction = "start" | "stop" | "restart";

/**
 * LiteLLM webhook payload shape (StandardLoggingPayload).
 * Sent by LiteLLM's generic_api callback on success/failure.
 */
export interface LiteLLMWebhookPayload {
  id: string;
  model: string;
  model_group?: string;
  api_base?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  response_cost?: number;
  saved_cache_cost?: number;
  startTime: string | number;
  endTime: string | number;
  completionStartTime?: string | number;
  status?: string;
  error_str?: string;
  metadata?: {
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  end_user?: string;
  user_api_key_hash?: string;
  user_api_key_alias?: string;
  requester_ip_address?: string;
  cache_hit?: boolean;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
