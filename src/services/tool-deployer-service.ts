/**
 * ToolDeployerService - Deploys generated MCP tools.
 *
 * Responsibilities:
 * - Write generated tool code to filesystem
 * - Register tools with MCP dynamic registry
 * - Hot-reload tools without server restart
 * - Rollback on failure
 * - Audit log all deployments
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { GeneratedTool } from "./tool-generator-service";

export interface DeploymentResult {
  success: boolean;
  toolName: string;
  path: string;
  error?: string;
  rollbackAvailable: boolean;
  deployedAt: Date;
}

export interface DeploymentAuditEntry {
  id: string;
  toolName: string;
  action: "deploy" | "rollback" | "unregister";
  success: boolean;
  error?: string;
  timestamp: Date;
  previousCode?: string; // For rollback
}

/**
 * Service for deploying generated MCP tools.
 */
export class ToolDeployerService {
  private readonly generatedDir: string;
  private readonly auditLog: DeploymentAuditEntry[] = [];
  private readonly backups: Map<string, string> = new Map();

  constructor(generatedDir?: string) {
    this.generatedDir = generatedDir ?? "src/mcp/tools/generated";
  }

  /**
   * Deploy a generated tool.
   */
  async deploy(tool: GeneratedTool): Promise<DeploymentResult> {
    const auditEntry: DeploymentAuditEntry = {
      id: crypto.randomUUID(),
      toolName: tool.name,
      action: "deploy",
      success: false,
      timestamp: new Date(),
    };

    try {
      // Step 1: Backup existing tool if it exists
      const existingCode = await this.backupExisting(tool.path);
      if (existingCode) {
        auditEntry.previousCode = existingCode;
      }

      // Step 2: Ensure directory exists
      await fs.mkdir(path.dirname(tool.path), { recursive: true });

      // Step 3: Write tool code
      await fs.writeFile(tool.path, tool.code, "utf-8");

      // Step 4: Update registry index
      await this.updateRegistryIndex(tool);

      auditEntry.success = true;
      this.auditLog.push(auditEntry);

      return {
        success: true,
        toolName: tool.name,
        path: tool.path,
        rollbackAvailable: !!existingCode,
        deployedAt: new Date(),
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : String(error);
      this.auditLog.push(auditEntry);

      // Attempt rollback if we have a backup
      if (this.backups.has(tool.name)) {
        await this.rollback(tool.name);
      }

      return {
        success: false,
        toolName: tool.name,
        path: tool.path,
        error: auditEntry.error,
        rollbackAvailable: false,
        deployedAt: new Date(),
      };
    }
  }

  /**
   * Deploy multiple tools.
   */
  async deployBatch(tools: GeneratedTool[]): Promise<DeploymentResult[]> {
    const results: DeploymentResult[] = [];

    for (const tool of tools) {
      const result = await this.deploy(tool);
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Rollback a deployed tool.
   */
  async rollback(toolName: string): Promise<boolean> {
    const backup = this.backups.get(toolName);
    if (!backup) {
      return false;
    }

    const auditEntry: DeploymentAuditEntry = {
      id: crypto.randomUUID(),
      toolName,
      action: "rollback",
      success: false,
      timestamp: new Date(),
    };

    try {
      const toolPath = `${this.generatedDir}/${toolName}.ts`;
      await fs.writeFile(toolPath, backup, "utf-8");

      // Update registry to remove new version
      await this.removeFromRegistryIndex(toolName);

      auditEntry.success = true;
      this.auditLog.push(auditEntry);
      this.backups.delete(toolName);

      return true;
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : String(error);
      this.auditLog.push(auditEntry);
      return false;
    }
  }

  /**
   * Unregister and delete a tool.
   */
  async unregister(toolName: string): Promise<boolean> {
    const auditEntry: DeploymentAuditEntry = {
      id: crypto.randomUUID(),
      toolName,
      action: "unregister",
      success: false,
      timestamp: new Date(),
    };

    try {
      const toolPath = `${this.generatedDir}/${toolName}.ts`;

      // Backup before deletion
      try {
        const code = await fs.readFile(toolPath, "utf-8");
        auditEntry.previousCode = code;
      } catch {
        // File might not exist
      }

      // Delete the file
      await fs.unlink(toolPath);

      // Update registry
      await this.removeFromRegistryIndex(toolName);

      auditEntry.success = true;
      this.auditLog.push(auditEntry);

      return true;
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : String(error);
      this.auditLog.push(auditEntry);
      return false;
    }
  }

  /**
   * Get deployment audit log.
   */
  getAuditLog(options?: {
    toolName?: string;
    action?: "deploy" | "rollback" | "unregister";
    limit?: number;
  }): DeploymentAuditEntry[] {
    let entries = [...this.auditLog];

    if (options?.toolName) {
      entries = entries.filter((e) => e.toolName === options.toolName);
    }
    if (options?.action) {
      entries = entries.filter((e) => e.action === options.action);
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * List all deployed tools.
   */
  async listDeployed(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.generatedDir);
      return files
        .filter((f) => f.endsWith(".ts") && f !== "index.ts")
        .map((f) => f.replace(".ts", ""));
    } catch {
      return [];
    }
  }

  /**
   * Check if a tool is deployed.
   */
  async isDeployed(toolName: string): Promise<boolean> {
    const toolPath = `${this.generatedDir}/${toolName}.ts`;
    try {
      await fs.access(toolPath);
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async backupExisting(toolPath: string): Promise<string | null> {
    try {
      const code = await fs.readFile(toolPath, "utf-8");
      const toolName = path.basename(toolPath, ".ts");
      this.backups.set(toolName, code);
      return code;
    } catch {
      return null;
    }
  }

  private async updateRegistryIndex(tool: GeneratedTool): Promise<void> {
    const indexPath = `${this.generatedDir}/index.ts`;

    let indexContent: string;
    try {
      indexContent = await fs.readFile(indexPath, "utf-8");
    } catch {
      indexContent = this.createInitialIndex();
    }

    // Add export if not present
    const exportLine = `export { ${this.toExportName(tool.name)} } from "./${tool.name}";`;
    if (!indexContent.includes(exportLine)) {
      // Add before the closing of tools array or at end
      if (indexContent.includes("export const generatedTools")) {
        const exportName = this.toExportName(tool.name);
        indexContent = indexContent.replace(
          /export const generatedTools = \[([\s\S]*?)\];/,
          (match, content) => {
            const trimmed = content.trim();
            const newContent = trimmed
              ? `${trimmed},\n  ${exportName},`
              : `\n  ${exportName},\n`;
            return `export const generatedTools = [${newContent}];`;
          }
        );
        indexContent = exportLine + "\n" + indexContent;
      } else {
        indexContent += "\n" + exportLine;
      }
    }

    await fs.writeFile(indexPath, indexContent, "utf-8");
  }

  private async removeFromRegistryIndex(toolName: string): Promise<void> {
    const indexPath = `${this.generatedDir}/index.ts`;

    try {
      let indexContent = await fs.readFile(indexPath, "utf-8");
      const exportName = this.toExportName(toolName);

      // Remove export line
      const exportLine = new RegExp(
        `export \\{ ${exportName} \\} from "\\./${toolName}";\\n?`,
        "g"
      );
      indexContent = indexContent.replace(exportLine, "");

      // Remove from array
      indexContent = indexContent.replace(
        new RegExp(`\\s*${exportName},?`, "g"),
        ""
      );

      await fs.writeFile(indexPath, indexContent, "utf-8");
    } catch {
      // Index might not exist
    }
  }

  private createInitialIndex(): string {
    return `/**
 * Auto-generated MCP Tools Registry
 *
 * This file is auto-generated by ToolDeployerService.
 * Do not edit manually.
 */

export const generatedTools = [];
`;
  }

  private toExportName(name: string): string {
    return name
      .split("_")
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join("") + "Tool";
  }
}
