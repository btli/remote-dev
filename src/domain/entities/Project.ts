import { ProjectHierarchyError } from "../errors/ProjectHierarchyError";

export interface ProjectProps {
  id: string;
  userId: string;
  // Null means the project lives at the tree root, alongside top-level groups.
  groupId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  isAutoCreated: boolean;
  legacyFolderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Project {
  private constructor(public readonly props: Readonly<ProjectProps>) {}

  static create(props: ProjectProps): Project {
    if (!props.userId) {
      throw new ProjectHierarchyError("Project userId required", "INVALID_SCOPE");
    }
    if (!props.name.trim()) {
      throw new ProjectHierarchyError(
        "Project name is required",
        "INVALID_NAME"
      );
    }
    return new Project({ ...props, name: props.name.trim() });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get groupId(): string | null { return this.props.groupId; }
  get name(): string { return this.props.name; }
  get collapsed(): boolean { return this.props.collapsed; }
  get sortOrder(): number { return this.props.sortOrder; }
  get isAutoCreated(): boolean { return this.props.isAutoCreated; }
  get legacyFolderId(): string | null { return this.props.legacyFolderId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Move this project into a group, or to the tree root (groupId === null). */
  moveTo(groupId: string | null): Project {
    return Project.create({ ...this.props, groupId, updatedAt: new Date() });
  }

  rename(name: string): Project {
    return Project.create({ ...this.props, name, updatedAt: new Date() });
  }

  setCollapsed(collapsed: boolean): Project {
    return Project.create({ ...this.props, collapsed, updatedAt: new Date() });
  }

  setSortOrder(sortOrder: number): Project {
    return Project.create({ ...this.props, sortOrder, updatedAt: new Date() });
  }
}
