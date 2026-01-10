/**
 * Task Decomposition Service - Break complex tasks into smaller beads issues
 *
 * Uses patterns and heuristics to decompose epics and features into
 * executable subtasks with proper dependencies.
 */

import { exec } from "child_process";
import { promisify } from "util";
import {
  classifyTask,
  estimateComplexity,
  type TaskCategory,
} from "@/lib/agent-heuristics";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DecompositionInput {
  title: string;
  description: string;
  type: "epic" | "feature" | "task";
  priority?: number;
}

export interface SubtaskDefinition {
  title: string;
  description?: string;
  type: "task" | "bug" | "feature";
  priority: number;
  category: TaskCategory;
  estimatedComplexity: "low" | "medium" | "high";
  dependsOn: number[]; // Indices of other subtasks in the array
}

export interface DecompositionResult {
  parentId?: string;
  subtasks: SubtaskDefinition[];
  dependencies: Array<{ from: number; to: number }>;
  parallelGroups: number[][]; // Groups of subtask indices that can run in parallel
  criticalPath: number[]; // Indices of subtasks on critical path
  reasoning: string;
}

export interface CreatedIssues {
  parentId: string;
  subtaskIds: string[];
  dependencyEdges: Array<{ from: string; to: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decomposition Patterns
// ─────────────────────────────────────────────────────────────────────────────

interface DecompositionPattern {
  name: string;
  matches: (input: DecompositionInput) => boolean;
  decompose: (input: DecompositionInput) => SubtaskDefinition[];
}

const DECOMPOSITION_PATTERNS: DecompositionPattern[] = [
  {
    name: "feature-with-api",
    matches: (input) =>
      /\b(api|endpoint|backend|server)\b/i.test(input.description) &&
      /\b(frontend|ui|component|page)\b/i.test(input.description),
    decompose: (input) => [
      {
        title: `Research: ${input.title} requirements`,
        description: `Analyze requirements and design approach for ${input.title}`,
        type: "task",
        priority: 2,
        category: "research",
        estimatedComplexity: "low",
        dependsOn: [],
      },
      {
        title: `Backend: API for ${input.title}`,
        description: `Implement backend API endpoints for ${input.title}`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "medium",
        dependsOn: [0],
      },
      {
        title: `Frontend: UI for ${input.title}`,
        description: `Implement frontend UI components for ${input.title}`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "medium",
        dependsOn: [1],
      },
      {
        title: `Tests: ${input.title}`,
        description: `Write tests for ${input.title}`,
        type: "task",
        priority: 3,
        category: "testing",
        estimatedComplexity: "low",
        dependsOn: [2],
      },
      {
        title: `Review: ${input.title}`,
        description: `Security and code review for ${input.title}`,
        type: "task",
        priority: 3,
        category: "review",
        estimatedComplexity: "low",
        dependsOn: [3],
      },
    ],
  },
  {
    name: "auth-feature",
    matches: (input) =>
      /\b(auth|authentication|login|signup|oauth|sso)\b/i.test(
        input.title + " " + input.description
      ),
    decompose: (input) => [
      {
        title: `Research: Auth patterns for ${input.title}`,
        description: `Research best practices and patterns for ${input.title}`,
        type: "task",
        priority: 2,
        category: "research",
        estimatedComplexity: "low",
        dependsOn: [],
      },
      {
        title: `Design: Auth flow for ${input.title}`,
        description: `Design authentication flow and data model`,
        type: "task",
        priority: 2,
        category: "architecture",
        estimatedComplexity: "medium",
        dependsOn: [0],
      },
      {
        title: `Backend: Auth routes for ${input.title}`,
        description: `Implement backend authentication endpoints`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "high",
        dependsOn: [1],
      },
      {
        title: `Frontend: Auth UI for ${input.title}`,
        description: `Implement login/signup forms and auth UI`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "medium",
        dependsOn: [2],
      },
      {
        title: `Security review: ${input.title}`,
        description: `Security audit of authentication implementation`,
        type: "task",
        priority: 1,
        category: "review",
        estimatedComplexity: "medium",
        dependsOn: [3],
      },
      {
        title: `Tests: ${input.title}`,
        description: `Write comprehensive auth tests`,
        type: "task",
        priority: 2,
        category: "testing",
        estimatedComplexity: "medium",
        dependsOn: [3],
      },
    ],
  },
  {
    name: "database-migration",
    matches: (input) =>
      /\b(database|migration|schema|model|table)\b/i.test(
        input.title + " " + input.description
      ),
    decompose: (input) => [
      {
        title: `Design: Schema for ${input.title}`,
        description: `Design database schema and relationships`,
        type: "task",
        priority: 2,
        category: "architecture",
        estimatedComplexity: "medium",
        dependsOn: [],
      },
      {
        title: `Migration: ${input.title}`,
        description: `Create and run database migration`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "medium",
        dependsOn: [0],
      },
      {
        title: `Update queries: ${input.title}`,
        description: `Update application queries for new schema`,
        type: "task",
        priority: 2,
        category: "complex_code",
        estimatedComplexity: "medium",
        dependsOn: [1],
      },
      {
        title: `Tests: ${input.title}`,
        description: `Write database and integration tests`,
        type: "task",
        priority: 3,
        category: "testing",
        estimatedComplexity: "low",
        dependsOn: [2],
      },
    ],
  },
  {
    name: "refactoring",
    matches: (input) =>
      /\b(refactor|clean|reorganize|restructure|improve)\b/i.test(
        input.title + " " + input.description
      ),
    decompose: (input) => [
      {
        title: `Analyze: Current state of ${input.title}`,
        description: `Document current implementation and identify issues`,
        type: "task",
        priority: 2,
        category: "research",
        estimatedComplexity: "low",
        dependsOn: [],
      },
      {
        title: `Design: Refactoring plan for ${input.title}`,
        description: `Create step-by-step refactoring plan`,
        type: "task",
        priority: 2,
        category: "architecture",
        estimatedComplexity: "medium",
        dependsOn: [0],
      },
      {
        title: `Tests: Add coverage for ${input.title}`,
        description: `Add tests before refactoring to catch regressions`,
        type: "task",
        priority: 2,
        category: "testing",
        estimatedComplexity: "medium",
        dependsOn: [1],
      },
      {
        title: `Refactor: ${input.title}`,
        description: `Execute refactoring according to plan`,
        type: "task",
        priority: 2,
        category: "refactoring",
        estimatedComplexity: "high",
        dependsOn: [2],
      },
      {
        title: `Verify: ${input.title}`,
        description: `Run tests and verify refactoring success`,
        type: "task",
        priority: 3,
        category: "testing",
        estimatedComplexity: "low",
        dependsOn: [3],
      },
    ],
  },
  {
    name: "generic-feature",
    matches: () => true, // Fallback pattern
    decompose: (input) => {
      const complexity = estimateComplexity(input.title, input.description);
      const classification = classifyTask(input.title, input.description);

      const subtasks: SubtaskDefinition[] = [
        {
          title: `Research: ${input.title}`,
          description: `Research requirements and approach for ${input.title}`,
          type: "task",
          priority: input.priority || 2,
          category: "research",
          estimatedComplexity: "low",
          dependsOn: [],
        },
        {
          title: `Implement: ${input.title}`,
          description: `Core implementation of ${input.title}`,
          type: "task",
          priority: input.priority || 2,
          category: classification.category,
          estimatedComplexity: complexity.level,
          dependsOn: [0],
        },
      ];

      // Add tests if complex enough
      if (complexity.level !== "low") {
        subtasks.push({
          title: `Tests: ${input.title}`,
          description: `Write tests for ${input.title}`,
          type: "task",
          priority: (input.priority || 2) + 1,
          category: "testing",
          estimatedComplexity: "low",
          dependsOn: [1],
        });
      }

      // Add review for high complexity
      if (complexity.level === "high") {
        subtasks.push({
          title: `Review: ${input.title}`,
          description: `Code review for ${input.title}`,
          type: "task",
          priority: (input.priority || 2) + 1,
          category: "review",
          estimatedComplexity: "low",
          dependsOn: [subtasks.length - 1],
        });
      }

      return subtasks;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class TaskDecompositionService {
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
  }

  /**
   * Decompose a complex task into subtasks.
   */
  decompose(input: DecompositionInput): DecompositionResult {
    // Find matching pattern
    const pattern = DECOMPOSITION_PATTERNS.find((p) => p.matches(input));
    if (!pattern) {
      throw new Error("No decomposition pattern found");
    }

    const subtasks = pattern.decompose(input);

    // Build dependencies
    const dependencies: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < subtasks.length; i++) {
      for (const dep of subtasks[i].dependsOn) {
        dependencies.push({ from: i, to: dep });
      }
    }

    // Calculate parallel groups
    const parallelGroups = this.calculateParallelGroups(subtasks);

    // Find critical path
    const criticalPath = this.findCriticalPath(subtasks);

    return {
      subtasks,
      dependencies,
      parallelGroups,
      criticalPath,
      reasoning: `Decomposed using '${pattern.name}' pattern into ${subtasks.length} subtasks`,
    };
  }

  /**
   * Calculate groups of subtasks that can run in parallel.
   */
  private calculateParallelGroups(subtasks: SubtaskDefinition[]): number[][] {
    const groups: number[][] = [];
    const completed = new Set<number>();

    while (completed.size < subtasks.length) {
      const group: number[] = [];

      for (let i = 0; i < subtasks.length; i++) {
        if (completed.has(i)) continue;

        // Check if all dependencies are satisfied
        const allDepsComplete = subtasks[i].dependsOn.every((dep) =>
          completed.has(dep)
        );

        if (allDepsComplete) {
          group.push(i);
        }
      }

      if (group.length === 0) {
        // Circular dependency detected
        break;
      }

      groups.push(group);
      for (const idx of group) {
        completed.add(idx);
      }
    }

    return groups;
  }

  /**
   * Find the critical path through the subtasks.
   */
  private findCriticalPath(subtasks: SubtaskDefinition[]): number[] {
    const complexityScore = {
      low: 1,
      medium: 2,
      high: 3,
    };

    // Calculate longest path weight
    const pathWeights = new Map<number, number>();
    const pathPredecessors = new Map<number, number>();

    // Topological sort order
    const order = this.topologicalSort(subtasks);

    for (const idx of order) {
      const task = subtasks[idx];
      const weight = complexityScore[task.estimatedComplexity];

      let maxPredWeight = 0;
      let bestPred = -1;

      for (const dep of task.dependsOn) {
        const predWeight = pathWeights.get(dep) || 0;
        if (predWeight > maxPredWeight) {
          maxPredWeight = predWeight;
          bestPred = dep;
        }
      }

      pathWeights.set(idx, maxPredWeight + weight);
      if (bestPred >= 0) {
        pathPredecessors.set(idx, bestPred);
      }
    }

    // Find end node with max weight
    let maxWeight = 0;
    let endNode = 0;
    for (const [idx, weight] of pathWeights) {
      if (weight > maxWeight) {
        maxWeight = weight;
        endNode = idx;
      }
    }

    // Reconstruct path
    const path: number[] = [];
    let current: number | undefined = endNode;
    while (current !== undefined) {
      path.unshift(current);
      current = pathPredecessors.get(current);
    }

    return path;
  }

  /**
   * Topological sort of subtasks.
   */
  private topologicalSort(subtasks: SubtaskDefinition[]): number[] {
    const visited = new Set<number>();
    const result: number[] = [];

    const visit = (idx: number) => {
      if (visited.has(idx)) return;
      visited.add(idx);

      for (const dep of subtasks[idx].dependsOn) {
        visit(dep);
      }

      result.push(idx);
    };

    for (let i = 0; i < subtasks.length; i++) {
      visit(i);
    }

    return result;
  }

  /**
   * Create beads issues from decomposition result.
   */
  async createIssues(
    parentInput: DecompositionInput,
    decomposition: DecompositionResult
  ): Promise<CreatedIssues> {
    // Create parent epic
    const { stdout: parentOut } = await execAsync(
      `bd create --title="${parentInput.title.replace(/"/g, '\\"')}" --type=epic --priority=${parentInput.priority || 2}`,
      { cwd: this.workingDir }
    );

    // Extract parent ID from output
    const parentMatch = parentOut.match(/Created\s+([\w-]+)/i);
    const parentId = parentMatch ? parentMatch[1] : "unknown";

    // Create subtasks
    const subtaskIds: string[] = [];
    for (const subtask of decomposition.subtasks) {
      const { stdout } = await execAsync(
        `bd create --title="${subtask.title.replace(/"/g, '\\"')}" --type=${subtask.type} --priority=${subtask.priority}`,
        { cwd: this.workingDir }
      );

      const match = stdout.match(/Created\s+([\w-]+)/i);
      subtaskIds.push(match ? match[1] : "unknown");
    }

    // Create dependencies
    const dependencyEdges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < decomposition.subtasks.length; i++) {
      for (const depIdx of decomposition.subtasks[i].dependsOn) {
        const fromId = subtaskIds[i];
        const toId = subtaskIds[depIdx];

        await execAsync(`bd dep add ${fromId} ${toId}`, {
          cwd: this.workingDir,
        });

        dependencyEdges.push({ from: fromId, to: toId });
      }
    }

    return {
      parentId,
      subtaskIds,
      dependencyEdges,
    };
  }

  /**
   * Get decomposition preview without creating issues.
   */
  preview(input: DecompositionInput): {
    decomposition: DecompositionResult;
    estimatedEffort: string;
    parallelization: string;
  } {
    const decomposition = this.decompose(input);

    const complexityPoints = {
      low: 1,
      medium: 3,
      high: 5,
    };

    const totalPoints = decomposition.subtasks.reduce(
      (sum, t) => sum + complexityPoints[t.estimatedComplexity],
      0
    );

    const parallelRatio =
      decomposition.parallelGroups.length / decomposition.subtasks.length;

    return {
      decomposition,
      estimatedEffort: `${decomposition.subtasks.length} subtasks, ~${totalPoints} complexity points`,
      parallelization: `${decomposition.parallelGroups.length} parallel phases (${Math.round(parallelRatio * 100)}% parallelization)`,
    };
  }

  /**
   * Suggest decomposition pattern for an input.
   */
  suggestPattern(input: DecompositionInput): {
    patternName: string;
    confidence: number;
    reasoning: string;
  } {
    for (const pattern of DECOMPOSITION_PATTERNS) {
      if (pattern.matches(input)) {
        // Calculate confidence based on keyword matches
        const keywords = [
          "api",
          "frontend",
          "backend",
          "auth",
          "database",
          "refactor",
        ];
        const text = `${input.title} ${input.description}`.toLowerCase();
        const matchCount = keywords.filter((k) => text.includes(k)).length;
        const confidence = Math.min(0.5 + matchCount * 0.1, 1);

        return {
          patternName: pattern.name,
          confidence,
          reasoning: `Matched pattern '${pattern.name}' based on task description`,
        };
      }
    }

    return {
      patternName: "generic-feature",
      confidence: 0.5,
      reasoning: "Using generic decomposition pattern",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const decompositionCache = new Map<string, TaskDecompositionService>();

export function getTaskDecompositionService(
  workingDir?: string
): TaskDecompositionService {
  const dir = workingDir || process.cwd();
  if (!decompositionCache.has(dir)) {
    decompositionCache.set(dir, new TaskDecompositionService(dir));
  }
  return decompositionCache.get(dir)!;
}

export { TaskDecompositionService };
