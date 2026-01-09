/**
 * ToolGeneratorService - Generates MCP tool implementations.
 *
 * Takes tool specifications and generates:
 * - TypeScript MCP tool code
 * - Zod input/output schemas
 * - Handler implementation
 * - Test cases
 *
 * Generation is based on:
 * - Command patterns (shell command sequences)
 * - File operation patterns
 * - API integration patterns
 * - Composite skill patterns
 */

import type { JSONSchema as SkillJSONSchema } from "@/domain/entities/Skill";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  suggestedImplementation: string;
  category: "command" | "file" | "api" | "composite";
  evidence: PatternEvidence[];
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface PatternEvidence {
  type: "frequency" | "success_rate" | "user_request" | "error_prevention";
  value: number | string;
  source: string;
}

export interface GeneratedTool {
  name: string;
  description: string;
  code: string;
  path: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  testCases: GeneratedTestCase[];
  metadata: {
    generatedAt: Date;
    generatedFrom: string;
    category: ToolSpec["category"];
    confidence: number;
  };
}

export interface GeneratedTestCase {
  name: string;
  input: Record<string, unknown>;
  expectedSuccess: boolean;
  expectedOutput?: unknown;
}

/**
 * Service for generating MCP tool implementations.
 */
export class ToolGeneratorService {
  private readonly generatedDir: string;

  constructor(generatedDir?: string) {
    this.generatedDir = generatedDir ?? "src/mcp/tools/generated";
  }

  /**
   * Generate a tool from specification.
   */
  generate(spec: ToolSpec): GeneratedTool {
    const safeName = this.toSafeName(spec.name);
    const exportName = this.toExportName(spec.name);

    // Generate code based on category
    let code: string;
    switch (spec.category) {
      case "command":
        code = this.generateCommandTool(spec, safeName, exportName);
        break;
      case "file":
        code = this.generateFileTool(spec, safeName, exportName);
        break;
      case "api":
        code = this.generateApiTool(spec, safeName, exportName);
        break;
      case "composite":
        code = this.generateCompositeTool(spec, safeName, exportName);
        break;
      default:
        code = this.generateCommandTool(spec, safeName, exportName);
    }

    // Generate test cases
    const testCases = this.generateTestCases(spec);

    // Calculate confidence based on evidence
    const confidence = this.calculateConfidence(spec.evidence);

    return {
      name: safeName,
      description: spec.description,
      code,
      path: `${this.generatedDir}/${safeName}.ts`,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      testCases,
      metadata: {
        generatedAt: new Date(),
        generatedFrom: spec.evidence.map((e) => e.source).join(", "),
        category: spec.category,
        confidence,
      },
    };
  }

  /**
   * Generate tool from command pattern.
   */
  generateFromCommandPattern(
    commandPattern: string,
    name: string,
    description: string
  ): GeneratedTool {
    const spec: ToolSpec = {
      name,
      description,
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description: "Working directory",
            default: ".",
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          output: { type: "string" },
        },
      },
      suggestedImplementation: `Execute: ${commandPattern}`,
      category: "command",
      evidence: [
        {
          type: "frequency",
          value: 1.0,
          source: "command_pattern",
        },
      ],
    };

    return this.generate(spec);
  }

  /**
   * Generate a command-based tool.
   */
  private generateCommandTool(
    spec: ToolSpec,
    safeName: string,
    exportName: string
  ): string {
    const commands = this.extractCommands(spec.suggestedImplementation);
    const inputProps = this.schemaToZod(spec.inputSchema);

    return `/**
 * Auto-generated MCP Tool: ${safeName}
 * ${spec.description}
 *
 * Generated: ${new Date().toISOString()}
 * From: ${spec.evidence.map((e) => e.source).join(", ")}
 */

import { z } from "zod";
import { execFile } from "@/lib/exec";

export const ${exportName} = {
  name: "${safeName}",
  description: "${this.escapeString(spec.description)}",

  inputSchema: z.object({
    ${inputProps}
  }),

  handler: async (input: { cwd?: string }) => {
    const cwd = input.cwd ?? ".";

    try {
      ${commands.map((cmd, i) => `
      // Step ${i + 1}: ${cmd}
      const result${i} = await execFile("bash", ["-c", ${JSON.stringify(cmd)}], { cwd });
      if (result${i}.exitCode !== 0) {
        return {
          success: false,
          error: result${i}.stderr || \`Command failed: ${cmd}\`,
        };
      }`).join("\n")}

      return {
        success: true,
        output: result${commands.length - 1}.stdout,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
`;
  }

  /**
   * Generate a file operation tool.
   */
  private generateFileTool(
    spec: ToolSpec,
    safeName: string,
    exportName: string
  ): string {
    const inputProps = this.schemaToZod(spec.inputSchema);

    return `/**
 * Auto-generated MCP Tool: ${safeName}
 * ${spec.description}
 *
 * Generated: ${new Date().toISOString()}
 * From: ${spec.evidence.map((e) => e.source).join(", ")}
 */

import { z } from "zod";
import { promises as fs } from "fs";
import * as path from "path";

export const ${exportName} = {
  name: "${safeName}",
  description: "${this.escapeString(spec.description)}",

  inputSchema: z.object({
    ${inputProps}
  }),

  handler: async (input: { path?: string; content?: string }) => {
    try {
      const targetPath = input.path ?? ".";

      // File operation based on specification
      // ${spec.suggestedImplementation}

      // Ensure directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      if (input.content) {
        await fs.writeFile(targetPath, input.content, "utf-8");
      }

      return {
        success: true,
        path: targetPath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
`;
  }

  /**
   * Generate an API integration tool.
   */
  private generateApiTool(
    spec: ToolSpec,
    safeName: string,
    exportName: string
  ): string {
    const inputProps = this.schemaToZod(spec.inputSchema);

    return `/**
 * Auto-generated MCP Tool: ${safeName}
 * ${spec.description}
 *
 * Generated: ${new Date().toISOString()}
 * From: ${spec.evidence.map((e) => e.source).join(", ")}
 */

import { z } from "zod";

export const ${exportName} = {
  name: "${safeName}",
  description: "${this.escapeString(spec.description)}",

  inputSchema: z.object({
    ${inputProps}
  }),

  handler: async (input: Record<string, unknown>) => {
    try {
      // API call based on specification
      // ${spec.suggestedImplementation}

      const response = await fetch(input.url as string ?? "", {
        method: input.method as string ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(input.headers as Record<string, string> ?? {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
      });

      const data = await response.json();

      return {
        success: response.ok,
        data,
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
`;
  }

  /**
   * Generate a composite tool (calls other tools/skills).
   */
  private generateCompositeTool(
    spec: ToolSpec,
    safeName: string,
    exportName: string
  ): string {
    const inputProps = this.schemaToZod(spec.inputSchema);
    const steps = this.extractSteps(spec.suggestedImplementation);

    return `/**
 * Auto-generated MCP Tool: ${safeName}
 * ${spec.description}
 *
 * Generated: ${new Date().toISOString()}
 * From: ${spec.evidence.map((e) => e.source).join(", ")}
 */

import { z } from "zod";

export const ${exportName} = {
  name: "${safeName}",
  description: "${this.escapeString(spec.description)}",

  inputSchema: z.object({
    ${inputProps}
  }),

  handler: async (input: Record<string, unknown>, context?: { callTool?: (name: string, input: unknown) => Promise<unknown> }) => {
    const results: unknown[] = [];

    try {
      ${steps.map((step, i) => `
      // Step ${i + 1}: ${step}
      // TODO: Implement step or call sub-tool
      results.push({ step: ${i + 1}, action: "${this.escapeString(step)}" });`).join("\n")}

      return {
        success: true,
        results,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        partialResults: results,
      };
    }
  },
};
`;
  }

  /**
   * Generate test cases for a tool.
   */
  private generateTestCases(spec: ToolSpec): GeneratedTestCase[] {
    const tests: GeneratedTestCase[] = [];

    // Basic success case
    tests.push({
      name: "Basic execution",
      input: this.getDefaultInput(spec.inputSchema),
      expectedSuccess: true,
    });

    // Error case (invalid input)
    tests.push({
      name: "Invalid input handling",
      input: {},
      expectedSuccess: false,
    });

    return tests;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private toSafeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private toExportName(name: string): string {
    const safe = this.toSafeName(name);
    return safe
      .split("_")
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join("") + "Tool";
  }

  private escapeString(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }

  private extractCommands(implementation: string): string[] {
    // Extract shell commands from implementation description
    const lines = implementation.split(/[;\n]/).map((l) => l.trim()).filter(Boolean);
    return lines.filter((l) => !l.startsWith("#") && !l.startsWith("//"));
  }

  private extractSteps(implementation: string): string[] {
    return implementation
      .split(/[.;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private schemaToZod(schema: JSONSchema): string {
    const props: string[] = [];

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const zodType = this.jsonTypeToZod(prop);
        const isRequired = schema.required?.includes(key);
        const withDefault = prop.default !== undefined
          ? `.default(${JSON.stringify(prop.default)})`
          : "";
        const optional = !isRequired && !prop.default ? ".optional()" : "";
        const description = prop.description
          ? `.describe("${this.escapeString(prop.description)}")`
          : "";

        props.push(`${key}: ${zodType}${withDefault}${optional}${description}`);
      }
    }

    return props.join(",\n    ");
  }

  private jsonTypeToZod(schema: JSONSchema): string {
    switch (schema.type) {
      case "string":
        return schema.enum
          ? `z.enum([${schema.enum.map((e) => `"${e}"`).join(", ")}])`
          : "z.string()";
      case "number":
      case "integer":
        return "z.number()";
      case "boolean":
        return "z.boolean()";
      case "array":
        return `z.array(${schema.items ? this.jsonTypeToZod(schema.items) : "z.unknown()"})`;
      case "object":
        return "z.record(z.unknown())";
      default:
        return "z.unknown()";
    }
  }

  private getDefaultInput(schema: JSONSchema): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.default !== undefined) {
          input[key] = prop.default;
        } else if (schema.required?.includes(key)) {
          input[key] = this.getDefaultValue(prop);
        }
      }
    }

    return input;
  }

  private getDefaultValue(schema: JSONSchema): unknown {
    switch (schema.type) {
      case "string":
        return schema.enum?.[0] ?? "";
      case "number":
      case "integer":
        return 0;
      case "boolean":
        return false;
      case "array":
        return [];
      case "object":
        return {};
      default:
        return null;
    }
  }

  private calculateConfidence(evidence: PatternEvidence[]): number {
    if (evidence.length === 0) return 0.5;

    let score = 0.5;

    for (const e of evidence) {
      switch (e.type) {
        case "frequency":
          score += typeof e.value === "number" ? e.value * 0.2 : 0.1;
          break;
        case "success_rate":
          score += typeof e.value === "number" ? e.value * 0.3 : 0.15;
          break;
        case "user_request":
          score += 0.3; // User requested = high confidence
          break;
        case "error_prevention":
          score += 0.2;
          break;
      }
    }

    return Math.min(score, 1.0);
  }
}
