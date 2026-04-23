import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";
import { isGlobalTerminalType } from "@/types/terminal-type";

export interface MinimalSession {
  id: string;
  projectId: string | null;
  terminalType?: string | null;
}

/**
 * Sessions whose terminalType is in GLOBAL_TERMINAL_TYPES render in the
 * sidebar's "Global" section and are NOT shown under their carrier project.
 * Per-project listing + counts must therefore exclude them.
 * See remote-dev-cvtz.3.
 */
function isGlobalSession(s: MinimalSession): boolean {
  return isGlobalTerminalType(s.terminalType ?? null);
}

export function sessionsForProject(
  sessions: MinimalSession[],
  projectId: string,
  opts: { excludeFileSessions?: boolean } = {}
): MinimalSession[] {
  return sessions.filter(
    (s) =>
      s.projectId === projectId &&
      !isGlobalSession(s) &&
      (!opts.excludeFileSessions || s.terminalType !== "file")
  );
}

/**
 * Return every session whose terminalType is in GLOBAL_TERMINAL_TYPES. These
 * surface in the sidebar "Global" section regardless of their projectId.
 */
export function globalSessions(sessions: MinimalSession[]): MinimalSession[] {
  return sessions.filter((s) => isGlobalSession(s));
}

export function recursiveSessionCount(
  sessions: MinimalSession[],
  groups: GroupNode[],
  projects: ProjectNode[],
  groupId: string
): number {
  const ownProjectIds = new Set(
    projects.filter((p) => p.groupId === groupId).map((p) => p.id)
  );
  const directCount = sessions.filter(
    (s) =>
      s.projectId != null &&
      ownProjectIds.has(s.projectId) &&
      s.terminalType !== "file" &&
      !isGlobalSession(s)
  ).length;
  const childGroupIds = groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id);
  const descendantCount = childGroupIds.reduce(
    (sum, cid) => sum + recursiveSessionCount(sessions, groups, projects, cid),
    0
  );
  return directCount + descendantCount;
}

export interface RepoStats {
  prCount: number;
  issueCount: number;
  hasChanges: boolean;
}

export function rolledUpRepoStats(
  groups: GroupNode[],
  projects: ProjectNode[],
  getProjectStats: (projectId: string) => RepoStats | null,
  node:
    | { type: "project"; id: string }
    | { type: "group"; id: string; collapsed: boolean }
): RepoStats | null {
  if (node.type === "project") return getProjectStats(node.id);
  if (!node.collapsed) return null;
  const descendantProjectIds = collectDescendantProjectIds(groups, projects, node.id);
  const acc: RepoStats = { prCount: 0, issueCount: 0, hasChanges: false };
  for (const pid of descendantProjectIds) {
    const s = getProjectStats(pid);
    if (!s) continue;
    acc.prCount += s.prCount;
    acc.issueCount += s.issueCount;
    acc.hasChanges = acc.hasChanges || s.hasChanges;
  }
  if (acc.prCount === 0 && acc.issueCount === 0 && !acc.hasChanges) return null;
  return acc;
}

function collectDescendantProjectIds(
  groups: GroupNode[],
  projects: ProjectNode[],
  rootGroupId: string
): string[] {
  const seen = new Set<string>([rootGroupId]);
  const queue = [rootGroupId];
  while (queue.length) {
    const gid = queue.shift()!;
    for (const child of groups) {
      if (child.parentGroupId === gid && !seen.has(child.id)) {
        seen.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return projects.filter((p) => p.groupId !== null && seen.has(p.groupId)).map((p) => p.id);
}
