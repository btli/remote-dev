/**
 * SDK Extension Types - Modular Plugin Architecture
 *
 * Defines the extension system that allows developers to add custom tools,
 * prompts, memory providers, and UI components to Remote Dev.
 */

import type { IMemoryStore, MemoryEntry, MemoryQuery, MemoryResult } from "./memory";

// ─────────────────────────────────────────────────────────────────────────────
// Extension Lifecycle Types
// ─────────────────────────────────────────────────────────────────────────────

/** Extension manifest (package.json style) */
export interface ExtensionManifest {
  /** Extension unique ID */
  id: string;
  /** Display name */
  name: string;
  /** Version (semver) */
  version: string;
  /** Description */
  description: string;
  /** Author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  /** License */
  license?: string;
  /** Repository URL */
  repository?: string;
  /** Required Remote Dev version */
  remoteDevVersion: string;
  /** Dependencies on other extensions */
  dependencies?: Record<string, string>;
  /** Extension entry point */
  main: string;
  /** Extension type */
  type: "tool" | "prompt" | "memory" | "ui" | "composite";
  /** Permissions required */
  permissions?: ExtensionPermission[];
  /** Configuration schema */
  configSchema?: JSONSchema;
}

export type ExtensionPermission =
  | "file:read"
  | "file:write"
  | "file:delete"
  | "command:execute"
  | "network:fetch"
  | "memory:read"
  | "memory:write"
  | "session:read"
  | "session:write"
  | "user:read";

/** JSON Schema for configuration validation */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/** Extension state */
export type ExtensionState = "unloaded" | "loading" | "loaded" | "error" | "disabled";

/** Loaded extension instance */
export interface LoadedExtension {
  /** Extension manifest */
  manifest: ExtensionManifest;
  /** Current state */
  state: ExtensionState;
  /** Error message if state is error */
  error?: string;
  /** Loaded components */
  tools?: ToolDefinition[];
  prompts?: PromptTemplate[];
  memoryProvider?: IMemoryStore;
  uiComponents?: UIComponentDefinition[];
  /** Extension instance (for calling lifecycle hooks) */
  instance: Extension;
  /** When extension was loaded */
  loadedAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Interface
// ─────────────────────────────────────────────────────────────────────────────

/** SDK context passed to extensions */
export interface SDKContext {
  /** User ID */
  userId: string;
  /** Current folder ID */
  folderId?: string;
  /** Project path */
  projectPath?: string;
  /** Memory store */
  memory: IMemoryStore;
  /** Configuration for this extension */
  config: Record<string, unknown>;
  /** Logger */
  logger: ExtensionLogger;
}

export interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Base extension interface that all extensions must implement.
 */
export interface Extension {
  /** Called when extension is loaded */
  onLoad(context: SDKContext): Promise<void>;

  /** Called when extension is unloaded */
  onUnload(): Promise<void>;

  /** Called when configuration changes */
  onConfigChange?(newConfig: Record<string, unknown>): Promise<void>;

  /** Get tools provided by this extension */
  tools?: ToolDefinition[];

  /** Get prompt templates provided by this extension */
  prompts?: PromptTemplate[];

  /** Get memory provider (if this is a memory extension) */
  memoryProvider?: IMemoryStore;

  /** Get UI components provided by this extension */
  uiComponents?: UIComponentDefinition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition Types
// ─────────────────────────────────────────────────────────────────────────────

/** Tool definition for MCP-style tools */
export interface ToolDefinition {
  /** Tool name (must be unique within extension) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Input schema (JSON Schema) */
  inputSchema: JSONSchema;
  /** Output schema (JSON Schema) */
  outputSchema?: JSONSchema;
  /** Tool handler function */
  handler: ToolHandler;
  /** Required permissions */
  permissions?: ExtensionPermission[];
  /** Example usages */
  examples?: ToolExample[];
  /** Whether this tool is dangerous (requires confirmation) */
  dangerous?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export interface ToolContext {
  /** SDK context */
  sdk: SDKContext;
  /** Session ID if running in a session */
  sessionId?: string;
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

export interface ToolResult {
  /** Success indicator */
  success: boolean;
  /** Result data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface ToolExample {
  /** Example description */
  description: string;
  /** Example input */
  input: Record<string, unknown>;
  /** Expected output (for documentation) */
  expectedOutput?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Template Types
// ─────────────────────────────────────────────────────────────────────────────

/** Prompt template definition */
export interface PromptTemplate {
  /** Template name (must be unique within extension) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Template content with variables */
  template: string;
  /** Variables in the template */
  variables: PromptVariable[];
  /** Category for organization */
  category?: string;
  /** Tags for searchability */
  tags?: string[];
}

export interface PromptVariable {
  /** Variable name (e.g., "task_description") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Variable type */
  type: "string" | "number" | "boolean" | "array" | "object";
  /** Whether this variable is required */
  required: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Validation pattern (for strings) */
  pattern?: string;
  /** Enum values (for select-style input) */
  enum?: unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Component Types
// ─────────────────────────────────────────────────────────────────────────────

/** UI component definition for dashboard extensions */
export interface UIComponentDefinition {
  /** Component name */
  name: string;
  /** Display title */
  title: string;
  /** Component type */
  type: "panel" | "modal" | "sidebar" | "toolbar" | "status";
  /** Placement in the UI */
  placement: UIPlacement;
  /** React component path (relative to extension root) */
  componentPath: string;
  /** Props schema */
  propsSchema?: JSONSchema;
  /** Default props */
  defaultProps?: Record<string, unknown>;
  /** Icon name (from lucide-react) */
  icon?: string;
  /** Badge count (for notifications) */
  badgeCount?: () => Promise<number>;
}

export interface UIPlacement {
  /** Location in the UI */
  location:
    | "header"
    | "sidebar"
    | "session_panel"
    | "folder_panel"
    | "settings"
    | "command_palette";
  /** Order within location (lower = earlier) */
  order?: number;
  /** Condition for showing this component */
  showWhen?: UIShowCondition;
}

export interface UIShowCondition {
  /** Show when session is active */
  sessionActive?: boolean;
  /** Show when folder is selected */
  folderSelected?: boolean;
  /** Show for specific agent providers */
  agentProviders?: string[];
  /** Custom condition function */
  custom?: (context: SDKContext) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Registry Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for the extension registry.
 * Manages loading, unloading, and querying extensions.
 */
export interface IExtensionRegistry {
  /** Register an extension from a manifest */
  register(manifest: ExtensionManifest): Promise<void>;

  /** Load an extension */
  load(extensionId: string): Promise<LoadedExtension>;

  /** Unload an extension */
  unload(extensionId: string): Promise<void>;

  /** Enable a disabled extension */
  enable(extensionId: string): Promise<void>;

  /** Disable an extension */
  disable(extensionId: string): Promise<void>;

  /** Get all registered extensions */
  list(): LoadedExtension[];

  /** Get a specific extension */
  get(extensionId: string): LoadedExtension | undefined;

  /** Get all tools from all loaded extensions */
  getTools(): ToolDefinition[];

  /** Get a specific tool by name */
  getTool(name: string): ToolDefinition | undefined;

  /** Get all prompt templates */
  getPrompts(): PromptTemplate[];

  /** Get a specific prompt template by name */
  getPrompt(name: string): PromptTemplate | undefined;

  /** Get all UI components */
  getUIComponents(): UIComponentDefinition[];

  /** Check if an extension has a required permission */
  hasPermission(extensionId: string, permission: ExtensionPermission): boolean;

  /** Update extension configuration */
  updateConfig(extensionId: string, config: Record<string, unknown>): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Builder Fluent API Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fluent builder for creating tool definitions.
 * Usage:
 *   const myTool = ToolBuilder.create('my-tool')
 *     .description('Does something useful')
 *     .input({ name: z.string() })
 *     .output({ result: z.boolean() })
 *     .handler(async (input) => ({ result: true }))
 *     .build();
 */
export interface IToolBuilder<TInput = unknown, TOutput = unknown> {
  /** Set tool description */
  description(desc: string): IToolBuilder<TInput, TOutput>;

  /** Set input schema */
  input<T>(schema: JSONSchema): IToolBuilder<T, TOutput>;

  /** Set output schema */
  output<T>(schema: JSONSchema): IToolBuilder<TInput, T>;

  /** Set tool handler */
  handler(
    fn: (input: TInput, context: ToolContext) => Promise<TOutput>
  ): IToolBuilder<TInput, TOutput>;

  /** Add an example */
  example(example: ToolExample): IToolBuilder<TInput, TOutput>;

  /** Mark as dangerous */
  dangerous(isDangerous?: boolean): IToolBuilder<TInput, TOutput>;

  /** Set timeout */
  timeout(ms: number): IToolBuilder<TInput, TOutput>;

  /** Add required permissions */
  permissions(...perms: ExtensionPermission[]): IToolBuilder<TInput, TOutput>;

  /** Build the tool definition */
  build(): ToolDefinition;
}

/** Static tool builder factory */
export interface ToolBuilderFactory {
  create(name: string): IToolBuilder;
}
