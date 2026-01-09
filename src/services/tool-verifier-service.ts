/**
 * ToolVerifierService - Verifies generated MCP tools work correctly.
 *
 * Provides:
 * - Sandbox execution for testing generated tools
 * - Test case execution
 * - Side effect detection
 * - Safety validation
 */

import type { GeneratedTool, GeneratedTestCase } from "./tool-generator-service";
import { execFile } from "@/lib/exec";

export interface VerificationResult {
  toolName: string;
  success: boolean;
  score: number; // 0-1
  testResults: TestResult[];
  safetyCheck: SafetyCheckResult;
  duration: number;
}

export interface TestResult {
  testCase: GeneratedTestCase;
  passed: boolean;
  actualOutput: unknown;
  error?: string;
  duration: number;
}

export interface SafetyCheckResult {
  passed: boolean;
  warnings: string[];
  blockers: string[];
}

/**
 * Dangerous patterns to check for in generated code.
 */
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+\/(?!\S)/g, message: "Potential root deletion" },
  { pattern: /:\(\)\{\s*:\|\:&\s*\};:/g, message: "Fork bomb detected" },
  { pattern: />\s*\/dev\/sd[a-z]/g, message: "Direct disk write" },
  { pattern: /dd\s+if=.*of=\/dev/g, message: "Disk overwrite" },
  { pattern: /mkfs\./g, message: "Filesystem format" },
  { pattern: /chmod\s+-R\s+777/g, message: "Dangerous permission change" },
  { pattern: /eval\s*\(/g, message: "Eval usage (potential injection)" },
  { pattern: /process\.exit/g, message: "Process exit call" },
];

/**
 * Warning patterns (not blockers but should be reviewed).
 */
const WARNING_PATTERNS = [
  { pattern: /sudo\s+/g, message: "Sudo usage" },
  { pattern: /curl\s+.*\|\s*bash/g, message: "Piping curl to bash" },
  { pattern: /wget\s+.*\|\s*sh/g, message: "Piping wget to shell" },
  { pattern: /fs\.rmdir|fs\.unlink/g, message: "File deletion" },
  { pattern: /execSync|spawnSync/g, message: "Synchronous shell execution" },
];

/**
 * Service for verifying generated tools.
 */
export class ToolVerifierService {
  private readonly sandboxDir: string;
  private readonly timeout: number;

  constructor(options?: { sandboxDir?: string; timeout?: number }) {
    this.sandboxDir = options?.sandboxDir ?? "/tmp/tool-sandbox";
    this.timeout = options?.timeout ?? 30000;
  }

  /**
   * Verify a generated tool.
   */
  async verify(tool: GeneratedTool): Promise<VerificationResult> {
    const startTime = Date.now();

    // Step 1: Safety check
    const safetyCheck = this.checkSafety(tool.code);

    if (safetyCheck.blockers.length > 0) {
      return {
        toolName: tool.name,
        success: false,
        score: 0,
        testResults: [],
        safetyCheck,
        duration: Date.now() - startTime,
      };
    }

    // Step 2: Run test cases
    const testResults: TestResult[] = [];

    for (const testCase of tool.testCases) {
      const result = await this.runTestCase(tool, testCase);
      testResults.push(result);
    }

    // Calculate score
    const passedCount = testResults.filter((r) => r.passed).length;
    const score = testResults.length > 0 ? passedCount / testResults.length : 0;
    const success = score >= 0.8 && safetyCheck.passed;

    return {
      toolName: tool.name,
      success,
      score,
      testResults,
      safetyCheck,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Quick safety check without running tests.
   */
  checkSafety(code: string): SafetyCheckResult {
    const warnings: string[] = [];
    const blockers: string[] = [];

    // Check for dangerous patterns
    for (const { pattern, message } of DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        blockers.push(message);
      }
      // Reset regex lastIndex for next use
      pattern.lastIndex = 0;
    }

    // Check for warning patterns
    for (const { pattern, message } of WARNING_PATTERNS) {
      if (pattern.test(code)) {
        warnings.push(message);
      }
      pattern.lastIndex = 0;
    }

    return {
      passed: blockers.length === 0,
      warnings,
      blockers,
    };
  }

  /**
   * Run a single test case.
   */
  private async runTestCase(
    tool: GeneratedTool,
    testCase: GeneratedTestCase
  ): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Create a sandboxed execution environment
      const result = await this.executeSandboxed(tool, testCase.input);

      const passed = testCase.expectedSuccess
        ? result.success === true
        : result.success === false;

      return {
        testCase,
        passed,
        actualOutput: result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testCase,
        passed: !testCase.expectedSuccess, // If expecting failure, this is a pass
        actualOutput: null,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tool in sandboxed environment.
   */
  private async executeSandboxed(
    tool: GeneratedTool,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    // Create a temporary test file that imports and runs the tool
    const testScript = `
const tool = require("${tool.path}");
const input = ${JSON.stringify(input)};

(async () => {
  try {
    // Get the tool export
    const toolExport = Object.values(tool).find(t => t?.handler);
    if (!toolExport) {
      console.log(JSON.stringify({ success: false, error: "No tool handler found" }));
      return;
    }

    const result = await toolExport.handler(input);
    console.log(JSON.stringify({ success: true, output: result }));
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message || String(error)
    }));
  }
})();
`;

    try {
      // Execute in a separate process with timeout
      const result = await execFile("node", ["-e", testScript], {
        timeout: this.timeout,
        cwd: this.sandboxDir,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || `Exit code: ${result.exitCode}`,
        };
      }

      // Parse output
      const output = JSON.parse(result.stdout.trim());
      return output;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch verify multiple tools.
   */
  async verifyBatch(tools: GeneratedTool[]): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const tool of tools) {
      const result = await this.verify(tool);
      results.push(result);
    }

    return results;
  }

  /**
   * Get verification statistics.
   */
  getStats(results: VerificationResult[]): {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
    totalWarnings: number;
    totalBlockers: number;
  } {
    const total = results.length;
    const passed = results.filter((r) => r.success).length;
    const failed = total - passed;
    const avgScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;
    const totalWarnings = results.reduce(
      (sum, r) => sum + r.safetyCheck.warnings.length,
      0
    );
    const totalBlockers = results.reduce(
      (sum, r) => sum + r.safetyCheck.blockers.length,
      0
    );

    return { total, passed, failed, avgScore, totalWarnings, totalBlockers };
  }
}
