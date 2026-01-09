/**
 * Dynamic MCP Tool Registry.
 *
 * Supports hot-reloading of tools without server restart.
 * Manages both static (built-in) and dynamic (generated) tools.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { z } from "zod";

export interface DynamicTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler: (input: unknown) => Promise<unknown>;
  metadata?: {
    generatedAt?: Date;
    source?: string;
    category?: string;
  };
}

export interface ToolRegistration {
  tool: DynamicTool;
  type: "static" | "dynamic";
  path?: string;
  registeredAt: Date;
}

/**
 * Dynamic registry for MCP tools.
 */
export class DynamicToolRegistry {
  private readonly tools: Map<string, ToolRegistration> = new Map();
  private readonly generatedDir: string;
  private watchAbortController: AbortController | null = null;

  constructor(generatedDir?: string) {
    this.generatedDir = generatedDir ?? "src/mcp/tools/generated";
  }

  /**
   * Register a static (built-in) tool.
   */
  registerStatic(tool: DynamicTool): void {
    this.tools.set(tool.name, {
      tool,
      type: "static",
      registeredAt: new Date(),
    });
  }

  /**
   * Register multiple static tools.
   */
  registerStaticBatch(tools: DynamicTool[]): void {
    for (const tool of tools) {
      this.registerStatic(tool);
    }
  }

  /**
   * Register a dynamically generated tool.
   */
  registerDynamic(tool: DynamicTool, filePath: string): void {
    this.tools.set(tool.name, {
      tool,
      type: "dynamic",
      path: filePath,
      registeredAt: new Date(),
    });
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): DynamicTool | null {
    return this.tools.get(name)?.tool ?? null;
  }

  /**
   * Get all registered tools.
   */
  getAll(): DynamicTool[] {
    return Array.from(this.tools.values()).map((r) => r.tool);
  }

  /**
   * Get all tool names.
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool registrations with metadata.
   */
  getRegistrations(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get dynamic tools only.
   */
  getDynamic(): ToolRegistration[] {
    return Array.from(this.tools.values()).filter((r) => r.type === "dynamic");
  }

  /**
   * Get static tools only.
   */
  getStatic(): ToolRegistration[] {
    return Array.from(this.tools.values()).filter((r) => r.type === "static");
  }

  /**
   * Load all generated tools from directory.
   */
  async loadGenerated(): Promise<number> {
    let loadedCount = 0;

    try {
      const files = await fs.readdir(this.generatedDir);

      for (const file of files) {
        if (!file.endsWith(".ts") || file === "index.ts" || file.startsWith(".")) {
          continue;
        }

        const filePath = path.join(this.generatedDir, file);

        try {
          const tool = await this.loadToolFile(filePath);
          if (tool) {
            this.registerDynamic(tool, filePath);
            loadedCount++;
          }
        } catch (error) {
          console.error(`Failed to load tool from ${file}:`, error);
        }
      }
    } catch (error) {
      console.error("Failed to read generated tools directory:", error);
    }

    return loadedCount;
  }

  /**
   * Reload a specific tool.
   */
  async reloadTool(name: string): Promise<boolean> {
    const registration = this.tools.get(name);
    if (!registration || registration.type !== "dynamic" || !registration.path) {
      return false;
    }

    try {
      // Clear require cache
      this.clearModuleCache(registration.path);

      // Reload
      const tool = await this.loadToolFile(registration.path);
      if (tool) {
        this.registerDynamic(tool, registration.path);
        return true;
      }
    } catch (error) {
      console.error(`Failed to reload tool ${name}:`, error);
    }

    return false;
  }

  /**
   * Start watching for changes (hot-reload).
   */
  async startWatching(): Promise<void> {
    this.watchAbortController = new AbortController();

    try {
      const watcher = fs.watch(this.generatedDir, {
        signal: this.watchAbortController.signal,
      });

      for await (const event of watcher) {
        if (event.filename?.endsWith(".ts") && event.filename !== "index.ts") {
          const toolName = event.filename.replace(".ts", "");

          if (event.eventType === "rename") {
            // File added or removed
            const filePath = path.join(this.generatedDir, event.filename);
            const exists = await this.fileExists(filePath);

            if (exists) {
              // New file - load it
              const tool = await this.loadToolFile(filePath);
              if (tool) {
                this.registerDynamic(tool, filePath);
                console.log(`Hot-loaded new tool: ${toolName}`);
              }
            } else {
              // File removed - unregister
              this.unregister(toolName);
              console.log(`Unregistered removed tool: ${toolName}`);
            }
          } else if (event.eventType === "change") {
            // File modified - reload
            await this.reloadTool(toolName);
            console.log(`Hot-reloaded tool: ${toolName}`);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Watch error:", error);
      }
    }
  }

  /**
   * Stop watching for changes.
   */
  stopWatching(): void {
    this.watchAbortController?.abort();
    this.watchAbortController = null;
  }

  /**
   * Execute a tool by name.
   */
  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Validate input
    const parsed = tool.inputSchema.parse(input);

    // Execute
    return tool.handler(parsed);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async loadToolFile(filePath: string): Promise<DynamicTool | null> {
    try {
      // Dynamic import
      const module = await import(filePath);

      // Find the tool export (convention: ends with "Tool")
      for (const [key, value] of Object.entries(module)) {
        if (
          value &&
          typeof value === "object" &&
          "name" in value &&
          "handler" in value &&
          "inputSchema" in value
        ) {
          return value as DynamicTool;
        }
      }

      console.warn(`No valid tool export found in ${filePath}`);
      return null;
    } catch (error) {
      console.error(`Failed to import tool from ${filePath}:`, error);
      return null;
    }
  }

  private clearModuleCache(filePath: string): void {
    // Clear Node.js require cache
    const absolutePath = path.resolve(filePath);
    // Note: In ESM, we can't clear the cache like in CJS
    // This is a placeholder for potential future implementation
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get registry statistics.
   */
  getStats(): {
    total: number;
    static: number;
    dynamic: number;
  } {
    const registrations = Array.from(this.tools.values());
    return {
      total: registrations.length,
      static: registrations.filter((r) => r.type === "static").length,
      dynamic: registrations.filter((r) => r.type === "dynamic").length,
    };
  }
}

/**
 * Singleton instance for the application.
 */
let registryInstance: DynamicToolRegistry | null = null;

/**
 * Get the global registry instance.
 */
export function getRegistry(generatedDir?: string): DynamicToolRegistry {
  if (!registryInstance) {
    registryInstance = new DynamicToolRegistry(generatedDir);
  }
  return registryInstance;
}

/**
 * Reset the global registry (for testing).
 */
export function resetRegistry(): void {
  registryInstance?.stopWatching();
  registryInstance = null;
}
