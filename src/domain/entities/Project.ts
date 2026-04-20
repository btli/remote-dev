import { ProjectHierarchyError } from "../errors/ProjectHierarchyError";

export interface ProjectProps {
  id: string;
  userId: string;
  groupId: string;
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
    if (!props.groupId) {
      throw new ProjectHierarchyError(
        "Project must belong to a group",
        "MISSING_GROUP"
      );
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
  get groupId(): string { return this.props.groupId; }
  get name(): string { return this.props.name; }
  get collapsed(): boolean { return this.props.collapsed; }
  get sortOrder(): number { return this.props.sortOrder; }
  get isAutoCreated(): boolean { return this.props.isAutoCreated; }
  get legacyFolderId(): string | null { return this.props.legacyFolderId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  moveTo(groupId: string): Project {
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
