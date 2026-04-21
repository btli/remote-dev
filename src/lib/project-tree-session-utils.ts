import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

export interface MinimalSession {
  id: string;
  projectId: string | null;
  terminalType?: string | null;
}

export function sessionsForProject(
  sessions: MinimalSession[],
  projectId: string,
  opts: { excludeFileSessions?: boolean } = {}
): MinimalSession[] {
  return sessions.filter(
    (s) =>
      s.projectId === projectId &&
      (!opts.excludeFileSessions || s.terminalType !== "file")
  );
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
    (s) => s.projectId != null && ownProjectIds.has(s.projectId) && s.terminalType !== "file"
  ).length;
  const childGroupIds = groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id);
  const descendantCount = childGroupIds.reduce(
    (sum, cid) => sum + recursiveSessionCount(sessions, groups, projects, cid),
    0
  );
  return directCount + descendantCount;
}
