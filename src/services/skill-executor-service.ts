/**
 * SkillExecutorService - Executes skills safely.
 *
 * Supports:
 * - Bash skills (shell commands)
 * - TypeScript skills (dynamic function execution)
 * - MCP tool skills (call MCP tools)
 * - Composite skills (call other skills)
 *
 * Safety:
 * - Timeout limits
 * - Output capture
 * - Error handling
 * - Side effect tracking
 */

import { execFileNoThrow } from "@/lib/exec";
import type { Skill, SkillImplementationType } from "@/domain/entities/Skill";
import type { SkillLibraryService } from "./skill-library-service";

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number; // milliseconds
  sideEffects: SideEffect[];
}

export interface SideEffect {
  type: "file_created" | "file_modified" | "command_run" | "api_call";
  target: string;
  description: string;
}

export interface ExecutionContext {
  workingDir: string;
  env?: Record<string, string>;
  timeout?: number; // milliseconds, default 30000
  input: Record<string, unknown>;
}

/**
 * Service for executing skills.
 */
export class SkillExecutorService {
  private readonly defaultTimeout = 30000; // 30 seconds

  constructor(private readonly skillLibrary: SkillLibraryService) {}

  /**
   * Execute a skill.
   */
  async execute(skill: Skill, context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const result = await this.executeByType(skill, context);
      const duration = Date.now() - startTime;

      // Record execution in library
      await this.skillLibrary.recordExecution(skill.id, result.success, duration);

      return {
        ...result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure
      await this.skillLibrary.recordExecution(skill.id, false, duration);

      return {
        success: false,
        output: null,
        error: errorMessage,
        duration,
        sideEffects: [],
      };
    }
  }

  /**
   * Execute skill by implementation type.
   */
  private async executeByType(
    skill: Skill,
    context: ExecutionContext
  ): Promise<Omit<ExecutionResult, "duration">> {
    const impl = skill.implementation;

    switch (impl.type) {
      case "bash":
        return this.executeBash(impl.code, context);

      case "typescript":
        return this.executeTypeScript(impl.code, impl.entrypoint, context);

      case "mcp_tool":
        return this.executeMcpTool(impl.code, context);

      case "composite":
        return this.executeComposite(skill, context);

      default:
        return {
          success: false,
          output: null,
          error: `Unknown implementation type: ${impl.type}`,
          sideEffects: [],
        };
    }
  }

  /**
   * Execute a bash skill.
   */
  private async executeBash(
    code: string,
    context: ExecutionContext
  ): Promise<Omit<ExecutionResult, "duration">> {
    const sideEffects: SideEffect[] = [];

    // Replace input placeholders in code
    let processedCode = code;
    for (const [key, value] of Object.entries(context.input)) {
      const placeholder = `\${input.${key}}`;
      processedCode = processedCode.replace(
        new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        String(value)
      );
    }

    // Execute using bash -c to support complex commands
    const result = await execFileNoThrow("bash", ["-c", processedCode], {
      cwd: context.workingDir,
      env: { ...process.env, ...context.env },
      timeout: context.timeout ?? this.defaultTimeout,
    });

    sideEffects.push({
      type: "command_run",
      target: processedCode.split("\n")[0].substring(0, 50),
      description: "Bash command executed",
    });

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        error: result.stderr || `Exit code: ${result.exitCode}`,
        sideEffects,
      };
    }

    return {
      success: true,
      output: result.stdout,
      sideEffects,
    };
  }

  /**
   * Execute a TypeScript skill.
   *
   * Note: In production, this would use a sandboxed environment.
   * For now, we create a dynamic function and execute it.
   */
  private async executeTypeScript(
    code: string,
    entrypoint: string | undefined,
    context: ExecutionContext
  ): Promise<Omit<ExecutionResult, "duration">> {
    const sideEffects: SideEffect[] = [];

    try {
      // Create a function from the code
      // The function receives: input, context, and helper utilities
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

      const fn = new AsyncFunction(
        "input",
        "context",
        "helpers",
        code
      );

      // Helper utilities available to skills
      const helpers = {
        log: console.log,
        execFile: execFileNoThrow,
        fetch: globalThis.fetch,
      };

      const output = await fn(context.input, context, helpers);

      sideEffects.push({
        type: "command_run",
        target: entrypoint ?? "anonymous",
        description: "TypeScript skill executed",
      });

      return {
        success: true,
        output,
        sideEffects,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        sideEffects,
      };
    }
  }

  /**
   * Execute an MCP tool skill.
   */
  private async executeMcpTool(
    toolSpec: string,
    context: ExecutionContext
  ): Promise<Omit<ExecutionResult, "duration">> {
    // Parse tool spec (format: "toolName" or "server:toolName")
    const [toolName] = toolSpec.split(":");

    // In production, this would call the actual MCP tool
    // For now, return a stub response
    return {
      success: false,
      output: null,
      error: `MCP tool execution not implemented: ${toolName}`,
      sideEffects: [{
        type: "api_call",
        target: toolName,
        description: "MCP tool call (stub)",
      }],
    };
  }

  /**
   * Execute a composite skill (calls other skills).
   */
  private async executeComposite(
    skill: Skill,
    context: ExecutionContext
  ): Promise<Omit<ExecutionResult, "duration">> {
    const sideEffects: SideEffect[] = [];
    const outputs: unknown[] = [];

    // Get dependencies
    const dependencyIds = skill.getDependencies();

    for (const depId of dependencyIds) {
      const depSkill = await this.skillLibrary.getSkill(depId);
      if (!depSkill) {
        return {
          success: false,
          output: outputs,
          error: `Dependency skill not found: ${depId}`,
          sideEffects,
        };
      }

      // Execute dependency
      const result = await this.execute(depSkill, context);

      if (!result.success) {
        return {
          success: false,
          output: outputs,
          error: `Dependency skill failed: ${depSkill.name} - ${result.error}`,
          sideEffects: [...sideEffects, ...result.sideEffects],
        };
      }

      outputs.push(result.output);
      sideEffects.push(...result.sideEffects);

      // Update context input with previous output for chaining
      context = {
        ...context,
        input: {
          ...context.input,
          [`${depSkill.name}_output`]: result.output,
        },
      };
    }

    return {
      success: true,
      output: outputs,
      sideEffects,
    };
  }

  /**
   * Validate skill input against schema.
   */
  validateInput(skill: Skill, input: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const schema = skill.inputSchema;

    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in input)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    return errors;
  }

  /**
   * Dry run a skill (validate without executing).
   */
  async dryRun(
    skill: Skill,
    context: ExecutionContext
  ): Promise<{
    valid: boolean;
    errors: string[];
    wouldExecute: string;
  }> {
    const errors = this.validateInput(skill, context.input);

    let wouldExecute: string;
    switch (skill.implementation.type) {
      case "bash":
        wouldExecute = `Bash: ${skill.implementation.code.substring(0, 100)}...`;
        break;
      case "typescript":
        wouldExecute = `TypeScript: ${skill.implementation.entrypoint ?? "inline code"}`;
        break;
      case "mcp_tool":
        wouldExecute = `MCP Tool: ${skill.implementation.code}`;
        break;
      case "composite":
        wouldExecute = `Composite: ${skill.composedFrom.join(" → ")}`;
        break;
      default:
        wouldExecute = "Unknown";
    }

    return {
      valid: errors.length === 0,
      errors,
      wouldExecute,
    };
  }
}
