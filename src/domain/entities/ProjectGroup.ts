import { ProjectHierarchyError } from "../errors/ProjectHierarchyError";

export interface ProjectGroupProps {
  id: string;
  userId: string;
  parentGroupId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  legacyFolderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectGroup {
  private constructor(public readonly props: Readonly<ProjectGroupProps>) {}

  static create(props: ProjectGroupProps): ProjectGroup {
    if (!props.userId) throw ProjectHierarchyError.groupMustHaveUserScope();
    if (!props.name.trim()) {
      throw new ProjectHierarchyError("Group name is required", "INVALID_NAME");
    }
    return new ProjectGroup({ ...props, name: props.name.trim() });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get parentGroupId(): string | null { return this.props.parentGroupId; }
  get name(): string { return this.props.name; }
  get collapsed(): boolean { return this.props.collapsed; }
  get sortOrder(): number { return this.props.sortOrder; }
  get legacyFolderId(): string | null { return this.props.legacyFolderId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  rename(name: string): ProjectGroup {
    return ProjectGroup.create({ ...this.props, name, updatedAt: new Date() });
  }

  moveUnder(parentGroupId: string | null): ProjectGroup {
    if (parentGroupId === this.id) {
      throw ProjectHierarchyError.cycleDetected(this.id);
    }
    return ProjectGroup.create({
      ...this.props,
      parentGroupId,
      updatedAt: new Date(),
    });
  }

  setCollapsed(collapsed: boolean): ProjectGroup {
    return ProjectGroup.create({ ...this.props, collapsed, updatedAt: new Date() });
  }

  setSortOrder(sortOrder: number): ProjectGroup {
    return ProjectGroup.create({ ...this.props, sortOrder, updatedAt: new Date() });
  }
}
