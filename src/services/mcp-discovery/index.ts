/**
 * MCP Discovery Module
 *
 * Exports core discovery utilities for use by other services.
 */

export {
  discoverViaStdio,
  discoverViaHttp,
  DEFAULT_DISCOVERY_TIMEOUT,
  type MCPServerConfig,
  type MCPHttpConfig,
  type DiscoveredTool,
  type DiscoveredResource,
  type DiscoveryResult,
} from "./core";
