/**
 * BeadsClient - Wrapper for beads (bd) CLI commands.
 *
 * Provides programmatic access to beads issue tracking for
 * orchestrator-agent coordination.
 *
 * Security: Uses execFile (not exec) to prevent shell injection.
 */

import { execFile, execFileNoThrow } from "@/lib/exec";

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "closed";
  priority: number;
  issueType: "task" | "bug" | "feature" | "epic";
  assignee?: string;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
  dependencyCount: number;
  dependentCount: number;
}

export interface CreateIssueOptions {
  title: string;
  type?: "task" | "bug" | "feature" | "epic";
  priority?: number;
  body?: string;
  assignee?: string;
  labels?: string[];
}

export interface UpdateIssueOptions {
  status?: "open" | "in_progress" | "closed";
  title?: string;
  body?: string;
  assignee?: string;
  priority?: number;
}

/**
 * Client for interacting with beads CLI.
 * Uses execFile for safety (no shell interpolation).
 */
export class BeadsClient {
  constructor(private readonly workingDir?: string) {}

  /**
   * Execute a beads command using execFile (safe from injection).
   */
  private async run(args: string[]): Promise<string> {
    const options = this.workingDir ? { cwd: this.workingDir } : {};
    const result = await execFile("bd", args, options);
    return result.stdout;
  }

  /**
   * Execute a beads command, returning null on failure.
   */
  private async runSafe(args: string[]): Promise<string | null> {
    const options = this.workingDir ? { cwd: this.workingDir } : {};
    const result = await execFileNoThrow("bd", args, options);
    return result.exitCode === 0 ? result.stdout : null;
  }

  /**
   * Create a new issue.
   */
  async create(options: CreateIssueOptions): Promise<string> {
    const args = ["create", `--title=${options.title}`];

    if (options.type) {
      args.push(`--type=${options.type}`);
    }
    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`);
    }
    if (options.body) {
      args.push(`--body=${options.body}`);
    }
    if (options.assignee) {
      args.push(`--assignee=${options.assignee}`);
    }

    const output = await this.run(args);
    // Parse issue ID from output like "Created remote-dev-xxx: ..."
    const match = output.match(/Created ([\w-]+):/);
    if (!match) {
      throw new Error(`Failed to parse issue ID from: ${output}`);
    }
    return match[1];
  }

  /**
   * Get issue details.
   */
  async show(issueId: string): Promise<BeadsIssue | null> {
    const output = await this.runSafe(["show", issueId, "--json"]);
    if (!output) return null;

    try {
      const data = JSON.parse(output);
      return this.parseIssue(data);
    } catch {
      return null;
    }
  }

  /**
   * List issues.
   */
  async list(options?: {
    status?: "open" | "in_progress" | "closed";
    type?: string;
    assignee?: string;
  }): Promise<BeadsIssue[]> {
    const args = ["list", "--json"];

    if (options?.status) {
      args.push(`--status=${options.status}`);
    }
    if (options?.type) {
      args.push(`--type=${options.type}`);
    }
    if (options?.assignee) {
      args.push(`--assignee=${options.assignee}`);
    }

    const output = await this.runSafe(args);
    if (!output) return [];

    try {
      const data = JSON.parse(output);
      return Array.isArray(data) ? data.map((d: unknown) => this.parseIssue(d)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Get ready issues (no blockers).
   */
  async ready(): Promise<BeadsIssue[]> {
    const output = await this.runSafe(["ready", "--json"]);
    if (!output) return [];

    try {
      const data = JSON.parse(output);
      return Array.isArray(data) ? data.map((d: unknown) => this.parseIssue(d)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Get blocked issues.
   */
  async blocked(): Promise<BeadsIssue[]> {
    const output = await this.runSafe(["blocked", "--json"]);
    if (!output) return [];

    try {
      const data = JSON.parse(output);
      return Array.isArray(data) ? data.map((d: unknown) => this.parseIssue(d)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Update an issue.
   */
  async update(issueId: string, options: UpdateIssueOptions): Promise<void> {
    const args = ["update", issueId];

    if (options.status) {
      args.push(`--status=${options.status}`);
    }
    if (options.title) {
      args.push(`--title=${options.title}`);
    }
    if (options.body) {
      args.push(`--body=${options.body}`);
    }
    if (options.assignee) {
      args.push(`--assignee=${options.assignee}`);
    }
    if (options.priority !== undefined) {
      args.push(`--priority=${options.priority}`);
    }

    await this.run(args);
  }

  /**
   * Close an issue.
   */
  async close(issueId: string, reason?: string): Promise<void> {
    const args = ["close", issueId];
    if (reason) {
      args.push(`--reason=${reason}`);
    }
    await this.run(args);
  }

  /**
   * Add a dependency.
   */
  async addDependency(issueId: string, dependsOnId: string): Promise<void> {
    await this.run(["dep", "add", issueId, dependsOnId]);
  }

  /**
   * Sync with remote.
   */
  async sync(): Promise<void> {
    await this.run(["sync"]);
  }

  /**
   * Parse raw issue data into BeadsIssue.
   */
  private parseIssue(data: unknown): BeadsIssue {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.id ?? ""),
      title: String(d.title ?? ""),
      description: String(d.description ?? ""),
      status: (d.status as BeadsIssue["status"]) ?? "open",
      priority: Number(d.priority ?? 2),
      issueType: (d.issue_type as BeadsIssue["issueType"]) ?? "task",
      assignee: d.assignee ? String(d.assignee) : undefined,
      labels: Array.isArray(d.labels) ? d.labels.map(String) : [],
      createdAt: new Date(String(d.created_at ?? Date.now())),
      updatedAt: new Date(String(d.updated_at ?? Date.now())),
      dependencyCount: Number(d.dependency_count ?? 0),
      dependentCount: Number(d.dependent_count ?? 0),
    };
  }
}

/**
 * Get a beads client for a directory.
 */
export function getBeadsClient(workingDir?: string): BeadsClient {
  return new BeadsClient(workingDir);
}
