/**
 * Dependency Resolver Service - Resolve task dependencies and execution order
 *
 * Works with beads issues to determine which tasks are ready for execution
 * and manages the dependency graph for parallel/sequential execution.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BeadsIssue {
  id: string;
  title: string;
  status: "open" | "in_progress" | "closed";
  priority: number;
  type: "task" | "bug" | "feature" | "epic";
  description?: string;
  dependsOn: string[];
  blockedBy: string[];
  createdAt: Date;
}

export interface DependencyGraph {
  nodes: Map<string, BeadsIssue>;
  edges: Map<string, Set<string>>; // issueId -> set of issues it depends on
  reverseEdges: Map<string, Set<string>>; // issueId -> set of issues that depend on it
}

export interface ExecutionOrder {
  parallel: string[][]; // Groups of issues that can run in parallel
  sequential: string[]; // Flattened execution order
  criticalPath: string[]; // Longest dependency chain
}

export interface ReadyIssues {
  ready: BeadsIssue[];
  blocked: Array<{
    issue: BeadsIssue;
    blockers: string[];
  }>;
  inProgress: BeadsIssue[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class DependencyResolverService {
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
  }

  /**
   * Parse beads CLI output into structured issues.
   */
  private parseBeadsOutput(output: string): BeadsIssue[] {
    const issues: BeadsIssue[] = [];
    const lines = output.trim().split("\n");

    // Parse each line - beads outputs in a structured format
    for (const line of lines) {
      // Skip empty lines and headers
      if (!line.trim() || line.startsWith("─") || line.includes("issues")) {
        continue;
      }

      // Try to parse as JSON if available
      try {
        const issue = JSON.parse(line);
        if (issue.id) {
          issues.push({
            id: issue.id,
            title: issue.title || "",
            status: issue.status || "open",
            priority: issue.priority ?? 2,
            type: issue.type || "task",
            description: issue.description,
            dependsOn: issue.depends_on || [],
            blockedBy: issue.blocked_by || [],
            createdAt: new Date(issue.created_at || Date.now()),
          });
        }
      } catch {
        // Try to parse as formatted output
        const match = line.match(
          /\[P(\d)\]\s+\[(\w+)\]\s+([\w-]+):\s+(.+)/
        );
        if (match) {
          issues.push({
            id: match[3],
            title: match[4],
            status: "open",
            priority: parseInt(match[1], 10),
            type: match[2] as BeadsIssue["type"],
            description: undefined,
            dependsOn: [],
            blockedBy: [],
            createdAt: new Date(),
          });
        }
      }
    }

    return issues;
  }

  /**
   * Get all open issues from beads.
   */
  async getOpenIssues(): Promise<BeadsIssue[]> {
    try {
      const { stdout } = await execAsync("bd list --status=open --format=json", {
        cwd: this.workingDir,
      });
      return this.parseBeadsOutput(stdout);
    } catch (error) {
      // Fallback to non-JSON format
      try {
        const { stdout } = await execAsync("bd list --status=open", {
          cwd: this.workingDir,
        });
        return this.parseBeadsOutput(stdout);
      } catch {
        console.error("Failed to get open issues from beads:", error);
        return [];
      }
    }
  }

  /**
   * Get issues that are ready to work on (no blockers).
   */
  async getReadyIssues(): Promise<ReadyIssues> {
    try {
      const { stdout } = await execAsync("bd ready --format=json", {
        cwd: this.workingDir,
      });
      const ready = this.parseBeadsOutput(stdout);

      // Get all open issues to find blocked ones
      const allOpen = await this.getOpenIssues();
      const readyIds = new Set(ready.map((i) => i.id));

      const inProgress = allOpen.filter((i) => i.status === "in_progress");
      const blocked = allOpen
        .filter((i) => !readyIds.has(i.id) && i.status === "open")
        .map((issue) => ({
          issue,
          blockers: issue.dependsOn.filter(
            (dep) => !allOpen.find((i) => i.id === dep && i.status === "closed")
          ),
        }));

      return { ready, blocked, inProgress };
    } catch {
      // Fallback to bd ready without JSON
      try {
        const { stdout } = await execAsync("bd ready", {
          cwd: this.workingDir,
        });
        const ready = this.parseBeadsOutput(stdout);
        return { ready, blocked: [], inProgress: [] };
      } catch (error) {
        console.error("Failed to get ready issues:", error);
        return { ready: [], blocked: [], inProgress: [] };
      }
    }
  }

  /**
   * Get issue details by ID.
   */
  async getIssue(issueId: string): Promise<BeadsIssue | null> {
    try {
      const { stdout } = await execAsync(`bd show ${issueId} --format=json`, {
        cwd: this.workingDir,
      });
      const issues = this.parseBeadsOutput(stdout);
      return issues[0] || null;
    } catch {
      try {
        const { stdout } = await execAsync(`bd show ${issueId}`, {
          cwd: this.workingDir,
        });
        // Parse the show output
        const lines = stdout.split("\n");
        const titleLine = lines.find((l) => l.includes(issueId));
        const title = titleLine?.split(":")[1]?.trim() || "";

        return {
          id: issueId,
          title,
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        };
      } catch (error) {
        console.error(`Failed to get issue ${issueId}:`, error);
        return null;
      }
    }
  }

  /**
   * Build a dependency graph from issues.
   */
  buildDependencyGraph(issues: BeadsIssue[]): DependencyGraph {
    const nodes = new Map<string, BeadsIssue>();
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();

    // Add all nodes
    for (const issue of issues) {
      nodes.set(issue.id, issue);
      edges.set(issue.id, new Set());
      reverseEdges.set(issue.id, new Set());
    }

    // Add edges
    for (const issue of issues) {
      for (const dep of issue.dependsOn) {
        edges.get(issue.id)?.add(dep);
        reverseEdges.get(dep)?.add(issue.id);
      }
    }

    return { nodes, edges, reverseEdges };
  }

  /**
   * Perform topological sort to get execution order.
   */
  topologicalSort(graph: DependencyGraph): ExecutionOrder {
    const visited = new Set<string>();
    const stack: string[] = [];
    const parallel: string[][] = [];

    // Find all nodes with no dependencies (start nodes)
    const findReady = (): string[] => {
      const ready: string[] = [];
      for (const [id, deps] of graph.edges) {
        if (
          !visited.has(id) &&
          [...deps].every((d) => visited.has(d) || !graph.nodes.has(d))
        ) {
          ready.push(id);
        }
      }
      return ready;
    };

    // Process in waves (parallel groups)
    let ready = findReady();
    while (ready.length > 0) {
      parallel.push(ready);
      for (const id of ready) {
        visited.add(id);
        stack.push(id);
      }
      ready = findReady();
    }

    // Find critical path (longest chain)
    const criticalPath = this.findCriticalPath(graph);

    return {
      parallel,
      sequential: stack,
      criticalPath,
    };
  }

  /**
   * Find the critical path (longest dependency chain).
   */
  private findCriticalPath(graph: DependencyGraph): string[] {
    const memo = new Map<string, string[]>();

    const longestPath = (nodeId: string): string[] => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId)!;
      }

      const deps = graph.edges.get(nodeId) || new Set();
      if (deps.size === 0) {
        memo.set(nodeId, [nodeId]);
        return [nodeId];
      }

      let longest: string[] = [];
      for (const dep of deps) {
        if (graph.nodes.has(dep)) {
          const path = longestPath(dep);
          if (path.length > longest.length) {
            longest = path;
          }
        }
      }

      const result = [...longest, nodeId];
      memo.set(nodeId, result);
      return result;
    };

    // Find longest path starting from any node
    let critical: string[] = [];
    for (const nodeId of graph.nodes.keys()) {
      const path = longestPath(nodeId);
      if (path.length > critical.length) {
        critical = path;
      }
    }

    return critical;
  }

  /**
   * Detect cycles in the dependency graph.
   */
  detectCycles(graph: DependencyGraph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      if (stack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart));
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      stack.add(nodeId);
      path.push(nodeId);

      const deps = graph.edges.get(nodeId) || new Set();
      for (const dep of deps) {
        if (graph.nodes.has(dep)) {
          dfs(dep);
        }
      }

      stack.delete(nodeId);
      path.pop();
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Get issues that can be executed in parallel right now.
   */
  async getParallelExecutionSet(): Promise<{
    canRunParallel: BeadsIssue[];
    mustRunSequential: BeadsIssue[];
    reasoning: string;
  }> {
    const { ready } = await this.getReadyIssues();

    if (ready.length === 0) {
      return {
        canRunParallel: [],
        mustRunSequential: [],
        reasoning: "No issues are ready for execution",
      };
    }

    if (ready.length === 1) {
      return {
        canRunParallel: [],
        mustRunSequential: ready,
        reasoning: "Only one issue is ready, no parallelization possible",
      };
    }

    // Check for any dependencies between ready issues
    const readyIds = new Set(ready.map((i) => i.id));
    const sequential: BeadsIssue[] = [];
    const parallel: BeadsIssue[] = [];

    for (const issue of ready) {
      const hasDependencyInReady = issue.dependsOn.some((dep) =>
        readyIds.has(dep)
      );

      if (hasDependencyInReady) {
        sequential.push(issue);
      } else {
        parallel.push(issue);
      }
    }

    return {
      canRunParallel: parallel,
      mustRunSequential: sequential,
      reasoning: `${parallel.length} issues can run in parallel, ${sequential.length} have inter-dependencies`,
    };
  }

  /**
   * Add a dependency between two issues.
   */
  async addDependency(issueId: string, dependsOnId: string): Promise<boolean> {
    try {
      await execAsync(`bd dep add ${issueId} ${dependsOnId}`, {
        cwd: this.workingDir,
      });
      return true;
    } catch (error) {
      console.error(`Failed to add dependency ${issueId} -> ${dependsOnId}:`, error);
      return false;
    }
  }

  /**
   * Remove a dependency between two issues.
   */
  async removeDependency(
    issueId: string,
    dependsOnId: string
  ): Promise<boolean> {
    try {
      await execAsync(`bd dep remove ${issueId} ${dependsOnId}`, {
        cwd: this.workingDir,
      });
      return true;
    } catch (error) {
      console.error(`Failed to remove dependency ${issueId} -> ${dependsOnId}:`, error);
      return false;
    }
  }

  /**
   * Check if executing an issue would cause any issues.
   */
  async validateExecution(issueId: string): Promise<{
    canExecute: boolean;
    blockers: string[];
    warnings: string[];
  }> {
    const issue = await this.getIssue(issueId);
    if (!issue) {
      return {
        canExecute: false,
        blockers: [`Issue ${issueId} not found`],
        warnings: [],
      };
    }

    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check if already in progress
    if (issue.status === "in_progress") {
      warnings.push("Issue is already in progress");
    }

    // Check if already closed
    if (issue.status === "closed") {
      blockers.push("Issue is already closed");
    }

    // Check dependencies
    for (const dep of issue.dependsOn) {
      const depIssue = await this.getIssue(dep);
      if (depIssue && depIssue.status !== "closed") {
        blockers.push(`Blocked by ${dep}: ${depIssue.title}`);
      }
    }

    return {
      canExecute: blockers.length === 0,
      blockers,
      warnings,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const resolverCache = new Map<string, DependencyResolverService>();

export function getDependencyResolver(
  workingDir?: string
): DependencyResolverService {
  const dir = workingDir || process.cwd();
  if (!resolverCache.has(dir)) {
    resolverCache.set(dir, new DependencyResolverService(dir));
  }
  return resolverCache.get(dir)!;
}

export { DependencyResolverService };
