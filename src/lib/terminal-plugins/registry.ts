/**
 * TerminalTypeRegistry - Plugin registration and management
 *
 * Central registry for terminal type plugins. Handles:
 * - Plugin registration and unregistration
 * - Plugin lookup by terminal type
 * - Plugin validation
 * - Default plugin fallback
 */

import type {
  TerminalType,
  TerminalTypePlugin,
  PluginMetadata,
  TerminalTypeOption,
} from "@/types/terminal-type";

/**
 * Registration options for plugins
 */
export interface PluginRegistrationOptions {
  /** Override existing plugin with same type (default: false) */
  override?: boolean;
  /** Mark as built-in (cannot be unregistered) */
  builtIn?: boolean;
}

/**
 * Registry error types
 */
export class PluginRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ALREADY_REGISTERED"
      | "NOT_FOUND"
      | "BUILT_IN"
      | "INVALID_PLUGIN"
  ) {
    super(message);
    this.name = "PluginRegistryError";
  }
}

/**
 * TerminalTypeRegistry - Singleton registry for terminal type plugins
 */
class TerminalTypeRegistryImpl {
  private plugins = new Map<TerminalType, TerminalTypePlugin>();
  private metadata = new Map<TerminalType, PluginMetadata>();
  private defaultType: TerminalType = "shell";

  /**
   * Register a terminal type plugin
   *
   * @param plugin - The plugin to register
   * @param options - Registration options
   * @throws PluginRegistryError if plugin is invalid or already registered
   */
  register(
    plugin: TerminalTypePlugin,
    options: PluginRegistrationOptions = {}
  ): void {
    // Validate plugin
    this.validatePlugin(plugin);

    // Check for existing registration
    if (this.plugins.has(plugin.type) && !options.override) {
      throw new PluginRegistryError(
        `Plugin for type "${plugin.type}" is already registered. Use override: true to replace.`,
        "ALREADY_REGISTERED"
      );
    }

    // Register plugin
    this.plugins.set(plugin.type, plugin);

    // Store metadata
    this.metadata.set(plugin.type, {
      type: plugin.type,
      displayName: plugin.displayName,
      description: plugin.description,
      priority: plugin.priority ?? 0,
      builtIn: options.builtIn ?? plugin.builtIn ?? false,
      registeredAt: new Date(),
    });

    console.log(
      `[PluginRegistry] Registered terminal type: ${plugin.type} (${plugin.displayName})`
    );
  }

  /**
   * Unregister a terminal type plugin
   *
   * @param type - The terminal type to unregister
   * @throws PluginRegistryError if plugin not found or is built-in
   */
  unregister(type: TerminalType): void {
    const meta = this.metadata.get(type);

    if (!meta) {
      throw new PluginRegistryError(
        `No plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }

    if (meta.builtIn) {
      throw new PluginRegistryError(
        `Cannot unregister built-in plugin "${type}"`,
        "BUILT_IN"
      );
    }

    this.plugins.delete(type);
    this.metadata.delete(type);

    console.log(`[PluginRegistry] Unregistered terminal type: ${type}`);
  }

  /**
   * Get a plugin by terminal type
   *
   * @param type - The terminal type to look up
   * @returns The plugin or undefined if not found
   */
  get(type: TerminalType): TerminalTypePlugin | undefined {
    return this.plugins.get(type);
  }

  /**
   * Get a plugin by terminal type, falling back to default
   *
   * @param type - The terminal type to look up
   * @returns The plugin or the default shell plugin
   */
  getOrDefault(type: TerminalType): TerminalTypePlugin {
    const plugin = this.plugins.get(type);
    if (plugin) return plugin;

    const defaultPlugin = this.plugins.get(this.defaultType);
    if (!defaultPlugin) {
      throw new PluginRegistryError(
        `No default plugin registered for type "${this.defaultType}"`,
        "NOT_FOUND"
      );
    }

    console.warn(
      `[PluginRegistry] No plugin for "${type}", using default "${this.defaultType}"`
    );
    return defaultPlugin;
  }

  /**
   * Get a plugin, throwing if not found
   *
   * @param type - The terminal type to look up
   * @throws PluginRegistryError if not found
   */
  getRequired(type: TerminalType): TerminalTypePlugin {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new PluginRegistryError(
        `No plugin registered for type "${type}"`,
        "NOT_FOUND"
      );
    }
    return plugin;
  }

  /**
   * Check if a terminal type is registered
   */
  has(type: TerminalType): boolean {
    return this.plugins.has(type);
  }

  /**
   * Get all registered terminal types
   */
  getTypes(): TerminalType[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get all registered plugins
   */
  getAll(): TerminalTypePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all plugin metadata, sorted by priority (descending)
   */
  getAllMetadata(): PluginMetadata[] {
    return Array.from(this.metadata.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Get terminal type options for UI selection
   */
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

  /**
   * Set the default terminal type
   */
  setDefaultType(type: TerminalType): void {
    if (!this.plugins.has(type)) {
      throw new PluginRegistryError(
        `Cannot set default to unregistered type "${type}"`,
        "NOT_FOUND"
      );
    }
    this.defaultType = type;
  }

  /**
   * Get the default terminal type
   */
  getDefaultType(): TerminalType {
    return this.defaultType;
  }

  /**
   * Validate a plugin before registration
   *
   * Checks:
   * - Required fields: type, displayName, icon
   * - Required methods: createSession, renderContent
   * - Optional lifecycle hooks are functions if provided
   * - Priority is a valid number if provided
   */
  private validatePlugin(plugin: TerminalTypePlugin): void {
    // Required string fields
    if (!plugin.type || typeof plugin.type !== "string") {
      throw new PluginRegistryError(
        "Plugin must have a type identifier (string)",
        "INVALID_PLUGIN"
      );
    }

    if (!plugin.displayName || typeof plugin.displayName !== "string") {
      throw new PluginRegistryError(
        "Plugin must have a displayName (string)",
        "INVALID_PLUGIN"
      );
    }

    if (!plugin.icon) {
      throw new PluginRegistryError("Plugin must have an icon", "INVALID_PLUGIN");
    }

    // Required methods
    if (typeof plugin.createSession !== "function") {
      throw new PluginRegistryError(
        "Plugin must implement createSession method",
        "INVALID_PLUGIN"
      );
    }

    if (typeof plugin.renderContent !== "function") {
      throw new PluginRegistryError(
        "Plugin must implement renderContent method",
        "INVALID_PLUGIN"
      );
    }

    // Validate optional fields if provided
    if (plugin.priority !== undefined && typeof plugin.priority !== "number") {
      throw new PluginRegistryError(
        "Plugin priority must be a number if provided",
        "INVALID_PLUGIN"
      );
    }

    // Validate optional lifecycle hooks are functions if provided
    if (plugin.onSessionExit !== undefined && typeof plugin.onSessionExit !== "function") {
      throw new PluginRegistryError(
        'Plugin lifecycle hook "onSessionExit" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }

    if (plugin.onSessionRestart !== undefined && typeof plugin.onSessionRestart !== "function") {
      throw new PluginRegistryError(
        'Plugin lifecycle hook "onSessionRestart" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }

    if (plugin.onSessionClose !== undefined && typeof plugin.onSessionClose !== "function") {
      throw new PluginRegistryError(
        'Plugin lifecycle hook "onSessionClose" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }

    // Validate optional render/validation methods
    if (plugin.renderExitScreen !== undefined && typeof plugin.renderExitScreen !== "function") {
      throw new PluginRegistryError(
        'Plugin method "renderExitScreen" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }

    if (plugin.validateInput !== undefined && typeof plugin.validateInput !== "function") {
      throw new PluginRegistryError(
        'Plugin method "validateInput" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }

    if (plugin.canHandle !== undefined && typeof plugin.canHandle !== "function") {
      throw new PluginRegistryError(
        'Plugin method "canHandle" must be a function if provided',
        "INVALID_PLUGIN"
      );
    }
  }

  /**
   * Clear all plugins (for testing)
   */
  clear(): void {
    this.plugins.clear();
    this.metadata.clear();
    this.defaultType = "shell";
  }

  /**
   * Get registry stats for debugging
   */
  getStats(): {
    totalPlugins: number;
    builtInPlugins: number;
    customPlugins: number;
    defaultType: TerminalType;
  } {
    const allMeta = Array.from(this.metadata.values());
    return {
      totalPlugins: this.plugins.size,
      builtInPlugins: allMeta.filter((m) => m.builtIn).length,
      customPlugins: allMeta.filter((m) => !m.builtIn).length,
      defaultType: this.defaultType,
    };
  }
}

// Export singleton instance
export const TerminalTypeRegistry = new TerminalTypeRegistryImpl();

// Export type for testing/mocking
export type TerminalTypeRegistryType = typeof TerminalTypeRegistry;
