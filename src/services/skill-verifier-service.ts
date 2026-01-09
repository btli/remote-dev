/**
 * SkillVerifierService - Verifies skills work correctly.
 *
 * Based on Voyager's self-verification pattern:
 * 1. Run skill against test cases
 * 2. Check output matches expected
 * 3. Calculate verification score
 * 4. Mark skill as verified if passing
 */

import type { Skill, TestCase } from "@/domain/entities/Skill";
import type { SkillExecutorService, ExecutionContext } from "./skill-executor-service";
import type { SkillLibraryService } from "./skill-library-service";

export interface VerificationResult {
  skillId: string;
  success: boolean;
  score: number; // 0-1
  testResults: TestCaseResult[];
  duration: number;
  errors: string[];
}

export interface TestCaseResult {
  testCase: TestCase;
  passed: boolean;
  actualOutput: unknown;
  error?: string;
  duration: number;
}

/**
 * Service for verifying skills.
 */
export class SkillVerifierService {
  constructor(
    private readonly executor: SkillExecutorService,
    private readonly library: SkillLibraryService
  ) {}

  /**
   * Verify a skill against its test cases.
   */
  async verify(
    skill: Skill,
    context: Omit<ExecutionContext, "input">
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const testResults: TestCaseResult[] = [];
    const errors: string[] = [];

    const testCases = skill.verification.testCases;

    if (testCases.length === 0) {
      errors.push("No test cases defined");
      return {
        skillId: skill.id,
        success: false,
        score: 0,
        testResults: [],
        duration: Date.now() - startTime,
        errors,
      };
    }

    // Run each test case
    for (const testCase of testCases) {
      const testStart = Date.now();

      try {
        const execContext: ExecutionContext = {
          ...context,
          input: testCase.input,
        };

        const result = await this.executor.execute(skill, execContext);

        const passed = this.checkResult(testCase, result.success, result.output);

        testResults.push({
          testCase,
          passed,
          actualOutput: result.output,
          error: result.error,
          duration: Date.now() - testStart,
        });

        if (!passed && result.error) {
          errors.push(`Test "${testCase.name}": ${result.error}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Test "${testCase.name}" threw: ${errorMsg}`);

        testResults.push({
          testCase,
          passed: false,
          actualOutput: null,
          error: errorMsg,
          duration: Date.now() - testStart,
        });
      }
    }

    // Calculate score
    const passedCount = testResults.filter((r) => r.passed).length;
    const score = testResults.length > 0 ? passedCount / testResults.length : 0;
    const success = score >= 0.8; // 80% pass rate required

    // Update skill verification status
    await this.library.updateVerification(skill.id, score);

    return {
      skillId: skill.id,
      success,
      score,
      testResults,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Check if test result matches expected.
   */
  private checkResult(
    testCase: TestCase,
    actualSuccess: boolean,
    actualOutput: unknown
  ): boolean {
    const expected = testCase.expected;

    // Check success flag
    if (expected.success !== actualSuccess) {
      return false;
    }

    // If expecting failure, we don't need to check output
    if (!expected.success) {
      // Optionally check error message
      if (expected.error && typeof actualOutput === "string") {
        return actualOutput.includes(expected.error);
      }
      return true;
    }

    // Check output if specified
    if (expected.output !== undefined) {
      return this.deepEqual(expected.output, actualOutput);
    }

    // If no specific output expected, success is enough
    return true;
  }

  /**
   * Deep equality check.
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    if (typeof a !== typeof b) return false;

    if (a === null || b === null) return a === b;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => this.deepEqual(item, b[index]));
    }

    if (typeof a === "object" && typeof b === "object") {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);

      if (aKeys.length !== bKeys.length) return false;

      return aKeys.every((key) =>
        this.deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
      );
    }

    return false;
  }

  /**
   * Generate test cases from examples.
   *
   * Helper to create test cases from input/output pairs.
   */
  generateTestCases(
    examples: Array<{
      name: string;
      input: Record<string, unknown>;
      expectedOutput?: unknown;
      expectSuccess?: boolean;
      expectError?: string;
    }>
  ): TestCase[] {
    return examples.map((example, index) => ({
      id: crypto.randomUUID(),
      name: example.name || `Test ${index + 1}`,
      input: example.input,
      expected: {
        success: example.expectSuccess ?? true,
        output: example.expectedOutput,
        error: example.expectError,
      },
    }));
  }

  /**
   * Run quick health check on skill.
   *
   * Runs a minimal test to ensure skill is executable.
   */
  async healthCheck(
    skill: Skill,
    context: Omit<ExecutionContext, "input">
  ): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Use first test case input or empty object
      const testInput = skill.verification.testCases[0]?.input ?? {};

      const result = await this.executor.execute(skill, {
        ...context,
        input: testInput,
        timeout: 5000, // Quick timeout for health check
      });

      return {
        healthy: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch verify all unverified skills.
   */
  async verifyUnverified(
    context: Omit<ExecutionContext, "input">,
    options?: {
      maxSkills?: number;
      minTestCases?: number;
    }
  ): Promise<VerificationResult[]> {
    const { maxSkills = 10, minTestCases = 1 } = options ?? {};
    const results: VerificationResult[] = [];

    // Get skills that need verification
    const stats = await this.library.getStats();
    const allSkills = await this.library.getGlobalSkills();

    const unverified = allSkills
      .filter((s) => !s.isVerified)
      .filter((s) => s.verification.testCases.length >= minTestCases)
      .slice(0, maxSkills);

    for (const skill of unverified) {
      const result = await this.verify(skill, context);
      results.push(result);
    }

    return results;
  }
}
