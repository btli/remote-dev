/**
 * TerminalTypeClientRegistry — Client-side plugin registry
 *
 * Tracks React rendering for terminal type plugins. Paired with
 * {@link TerminalTypeServerRegistry}: every terminal type should register
 * one plugin in each registry.
 *
 * @see ./server.ts for the server-side lifecycle registry
 * @see ./registry.ts for the legacy combined registry (deprecated)
 */

import type { TerminalType } from "@/types/terminal-type";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeOption,
} from "@/types/terminal-type-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("PluginRegistry.Client");

/** Registration options for client plugins */
export interface ClientPluginRegistrationOptions {
  /** Override existing plugin with same type (default: false) */
  override?: boolean;
  /** Mark as built-in (cannot be unregistered) */
  builtIn?: boolean;
}

/** Metadata tracked per registered client plugin */
export interface ClientPluginMetadata {
  type: TerminalType;
  displayName: string;
  description: string;
  priority: number;
  builtIn: boolean;
  registeredAt: Date;
}

/** Error class for registry operations */
export class ClientPluginRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ALREADY_REGISTERED"
      | "NOT_FOUND"
      | "BUILT_IN"
      | "INVALID_PLUGIN"
  ) {
    super(message);
    this.name = "ClientPluginRegistryError";
  }
}

class TerminalTypeClientRegistryImpl {
  private plugins = new Map<TerminalType, TerminalTypeClientPlugin>();
  private metadata = new Map<TerminalType, ClientPluginMetadata>();
  private defaultType: TerminalType = "shell";

  /** Register a client-side terminal type plugin. */
  register(
    plugin: TerminalTypeClientPlugin,
    options: ClientPluginRegistrationOptions = {}
  ): void {
    this.validatePlugin(plugin);

    if (this.plugins.has(plugin.type) && !options.override) {
      throw new ClientPluginRegistryError(
        `Client plugin for type "${plugin.type}" is already registered. Use override: true to replace.`,
        "ALREADY_REGISTERED"
      );
    }

    this.plugins.set(plugin.type, plugin);
    this.metadata.set(plugin.type, {
      type: plugin.type,
      displayName: plugin.displayName,
      description: plugin.description,
      priority: plugin.priority ?? 0,
      builtIn: options.builtIn ?? plugin.builtIn ?? false,
      registeredAt: new Date(),
    });

    log.debug("Registered client plugin", {
      type: plugin.type,
      displayName: plugin.displayName,
    });
  }

  /** Unregister a client plugin. Built-in plugins cannot be removed. */
  unregister(type: TerminalType): void {
    const meta = this.metadata.get(type);
    if (!meta) {
      throw new ClientPluginRegistryError(
        `No client plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }
    if (meta.builtIn) {
      throw new ClientPluginRegistryError(
        `Cannot unregister built-in client plugin "${type}"`,
        "BUILT_IN"
      );
    }

    this.plugins.delete(type);
    this.metadata.delete(type);
    log.info("Unregistered client plugin", { type });
  }

  /** Get a client plugin by type, or undefined if not registered. */
  get(type: TerminalType): TerminalTypeClientPlugin | undefined {
    return this.plugins.get(type);
  }

  /** Get a client plugin, throwing if not registered. */
  getRequired(type: TerminalType): TerminalTypeClientPlugin {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new ClientPluginRegistryError(
        `No client plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }
    return plugin;
  }

  /** Get a client plugin, falling back to the default plugin. */
  getOrDefault(type: TerminalType): TerminalTypeClientPlugin {
    const plugin = this.plugins.get(type);
    if (plugin) return plugin;

    const fallback = this.plugins.get(this.defaultType);
    if (!fallback) {
      throw new ClientPluginRegistryError(
        `No default client plugin registered for type "${this.defaultType}"`,
        "NOT_FOUND"
      );
    }

    log.warn("No client plugin found, using default", {
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

  /** List all registered client plugins. */
  getAll(): TerminalTypeClientPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get metadata for all registered plugins, sorted by priority desc. */
  getAllMetadata(): ClientPluginMetadata[] {
    return Array.from(this.metadata.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }

  /** Terminal type options suitable for UI selection surfaces. */
  getOptions(): TerminalTypeOption[] {
    return this.getAll()
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((plugin) => ({
        type: plugin.type,
        displayName: plugin.displayName,
        description: plugin.description,
        icon: plugin.icon,
      }));
  }

  /** Set the default terminal type used as fallback. */
  setDefaultType(type: TerminalType): void {
    if (!this.plugins.has(type)) {
      throw new ClientPluginRegistryError(
        `Cannot set default to unregistered client plugin "${type}"`,
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

  private validatePlugin(plugin: TerminalTypeClientPlugin): void {
    if (!plugin.type || typeof plugin.type !== "string") {
      throw new ClientPluginRegistryError(
        "Client plugin must have a type identifier (string)",
        "INVALID_PLUGIN"
      );
    }
    if (!plugin.displayName || typeof plugin.displayName !== "string") {
      throw new ClientPluginRegistryError(
        "Client plugin must have a displayName (string)",
        "INVALID_PLUGIN"
      );
    }
    if (!plugin.icon) {
      throw new ClientPluginRegistryError(
        "Client plugin must have an icon",
        "INVALID_PLUGIN"
      );
    }
    if (!plugin.component) {
      throw new ClientPluginRegistryError(
        "Client plugin must provide a component",
        "INVALID_PLUGIN"
      );
    }
    if (plugin.priority !== undefined && typeof plugin.priority !== "number") {
      throw new ClientPluginRegistryError(
        "Client plugin priority must be a number if provided",
        "INVALID_PLUGIN"
      );
    }
    if (
      plugin.deriveTitle !== undefined &&
      typeof plugin.deriveTitle !== "function"
    ) {
      throw new ClientPluginRegistryError(
        'Client plugin method "deriveTitle" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }
  }
}

/** Singleton client registry */
export const TerminalTypeClientRegistry = new TerminalTypeClientRegistryImpl();

/** Type alias useful for test mocks */
export type TerminalTypeClientRegistryType = typeof TerminalTypeClientRegistry;
