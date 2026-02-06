#!/usr/bin/env tsx
/**
 * Standalone MCP Server Entry Point
 *
 * Run with: bun run mcp
 * Or: npx tsx src/mcp/standalone.ts
 */
import { initializeMCPServer } from "./index.js";

// Start the MCP server on stdio
initializeMCPServer().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
