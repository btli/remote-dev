/**
 * TerminalTypeServerRegistry — Server-side plugin registry
 *
 * Tracks the lifecycle half of terminal type plugins. Intentionally free of
 * React and Lucide imports so it can be used from `session-service.ts` and
 * other server-only modules without pulling in browser dependencies.
 *
 * @see ./client.ts for the React rendering registry
 * @see ./registry.ts for the legacy combined registry (deprecated)
 */

import type { TerminalType } from "@/types/terminal-type";
import type { TerminalTypeServerPlugin } from "@/types/terminal-type-server";
import { createLogger } from "@/lib/logger";

const log = createLogger("PluginRegistry.Server");

/** Registration options for server plugins */
export interface ServerPluginRegistrationOptions {
  /** Override existing plugin with same type (default: false) */
  override?: boolean;
  /** Mark as built-in (cannot be unregistered) */
  builtIn?: boolean;
}

/** Metadata tracked per registered server plugin */
export interface ServerPluginMetadata {
  type: TerminalType;
  priority: number;
  builtIn: boolean;
  registeredAt: Date;
}

/** Error class for registry operations */
export class ServerPluginRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ALREADY_REGISTERED"
      | "NOT_FOUND"
      | "BUILT_IN"
      | "INVALID_PLUGIN"
  ) {
    super(message);
    this.name = "ServerPluginRegistryError";
  }
}

class TerminalTypeServerRegistryImpl {
  private plugins = new Map<TerminalType, TerminalTypeServerPlugin>();
  private metadata = new Map<TerminalType, ServerPluginMetadata>();
  private defaultType: TerminalType = "shell";

  /**
   * Register a server-side terminal type plugin.
   */
  register(
    plugin: TerminalTypeServerPlugin,
    options: ServerPluginRegistrationOptions = {}
  ): void {
    this.validatePlugin(plugin);

    if (this.plugins.has(plugin.type) && !options.override) {
      throw new ServerPluginRegistryError(
        `Server plugin for type "${plugin.type}" is already registered. Use override: true to replace.`,
        "ALREADY_REGISTERED"
      );
    }

    this.plugins.set(plugin.type, plugin);
    this.metadata.set(plugin.type, {
      type: plugin.type,
      priority: plugin.priority ?? 0,
      builtIn: options.builtIn ?? plugin.builtIn ?? false,
      registeredAt: new Date(),
    });

    log.debug("Registered server plugin", { type: plugin.type });
  }

  /**
   * Unregister a server plugin. Built-in plugins cannot be removed.
   */
  unregister(type: TerminalType): void {
    const meta = this.metadata.get(type);
    if (!meta) {
      throw new ServerPluginRegistryError(
        `No server plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }
    if (meta.builtIn) {
      throw new ServerPluginRegistryError(
        `Cannot unregister built-in server plugin "${type}"`,
        "BUILT_IN"
      );
    }

    this.plugins.delete(type);
    this.metadata.delete(type);
    log.info("Unregistered server plugin", { type });
  }

  /** Get a server plugin by type, or undefined if not registered. */
  get(type: TerminalType): TerminalTypeServerPlugin | undefined {
    return this.plugins.get(type);
  }

  /** Get a server plugin, throwing if not registered. */
  getRequired(type: TerminalType): TerminalTypeServerPlugin {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new ServerPluginRegistryError(
        `No server plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }
    return plugin;
  }

  /** Get a server plugin, falling back to the default plugin. */
  getOrDefault(type: TerminalType): TerminalTypeServerPlugin {
    const plugin = this.plugins.get(type);
    if (plugin) return plugin;

    const fallback = this.plugins.get(this.defaultType);
    if (!fallback) {
      throw new ServerPluginRegistryError(
        `No default server plugin registered for type "${this.defaultType}"`,
        "NOT_FOUND"
      );
    }

    log.warn("No server plugin found, using default", {
      requestedType: type,
      defaultType: this.defaultType,
    });
    return fallback;
  }

  /** Check if a plugin is registered for the given type. */
  has(type: TerminalType): boolean {
    return this.plugins.has(type);
  }

  /** List all registered terminal types. */
  list(): TerminalType[] {
    return Array.from(this.plugins.keys());
  }

  /** List all registered server plugins. */
  getAll(): TerminalTypeServerPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get metadata for all registered plugins, sorted by priority desc. */
  getAllMetadata(): ServerPluginMetadata[] {
    return Array.from(this.metadata.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }

  /** Set the default terminal type used as fallback. */
  setDefaultType(type: TerminalType): void {
    if (!this.plugins.has(type)) {
      throw new ServerPluginRegistryError(
        `Cannot set default to unregistered server plugin "${type}"`,
        "NOT_FOUND"
      );
    }
    this.defaultType = type;
  }

  /** Get the default terminal type. */
  getDefaultType(): TerminalType {
    return this.defaultType;
  }

  /** Clear all registrations (for testing). */
  clear(): void {
    this.plugins.clear();
    this.metadata.clear();
    this.defaultType = "shell";
  }

  /** Introspection stats (useful for debugging). */
  getStats(): {
    totalPlugins: number;
    builtInPlugins: number;
    customPlugins: number;
    defaultType: TerminalType;
  } {
    const metas = Array.from(this.metadata.values());
    return {
      totalPlugins: this.plugins.size,
      builtInPlugins: metas.filter((m) => m.builtIn).length,
      customPlugins: metas.filter((m) => !m.builtIn).length,
      defaultType: this.defaultType,
    };
  }

  private validatePlugin(plugin: TerminalTypeServerPlugin): void {
    if (!plugin.type || typeof plugin.type !== "string") {
      throw new ServerPluginRegistryError(
        "Server plugin must have a type identifier (string)",
        "INVALID_PLUGIN"
      );
    }
    if (typeof plugin.createSession !== "function") {
      throw new ServerPluginRegistryError(
        "Server plugin must implement createSession",
        "INVALID_PLUGIN"
      );
    }
    if (plugin.priority !== undefined && typeof plugin.priority !== "number") {
      throw new ServerPluginRegistryError(
        "Server plugin priority must be a number if provided",
        "INVALID_PLUGIN"
      );
    }
    const optionalHooks: (keyof TerminalTypeServerPlugin)[] = [
      "onSessionExit",
      "onSessionRestart",
      "onSessionClose",
      "validateInput",
      "canHandle",
    ];
    for (const hook of optionalHooks) {
      const value = plugin[hook];
      if (value !== undefined && typeof value !== "function") {
        throw new ServerPluginRegistryError(
          `Server plugin hook "${String(hook)}" must be a function if provided`,
          "INVALID_PLUGIN"
        );
      }
    }
  }
}

/** Singleton server registry */
export const TerminalTypeServerRegistry = new TerminalTypeServerRegistryImpl();

/** Type alias useful for test mocks */
export type TerminalTypeServerRegistryType = typeof TerminalTypeServerRegistry;
