export class ProjectHierarchyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ProjectHierarchyError";
  }

  static projectCannotHaveChildren(projectId: string): ProjectHierarchyError {
    return new ProjectHierarchyError(
      `Project ${projectId} is a leaf and cannot have children`,
      "PROJECT_CANNOT_NEST"
    );
  }

  static cycleDetected(groupId: string): ProjectHierarchyError {
    return new ProjectHierarchyError(
      `Moving group ${groupId} under its own descendant would create a cycle`,
      "CYCLE"
    );
  }

  static groupMustHaveUserScope(): ProjectHierarchyError {
    return new ProjectHierarchyError(
      "Project groups require userId",
      "INVALID_SCOPE"
    );
  }
}
