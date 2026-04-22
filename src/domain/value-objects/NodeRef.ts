export type NodeType = "group" | "project";

export class NodeRef {
  private constructor(
    public readonly id: string,
    public readonly type: NodeType
  ) {}

  static group(id: string): NodeRef {
    return new NodeRef(id, "group");
  }

  static project(id: string): NodeRef {
    return new NodeRef(id, "project");
  }

  static fromPlain(value: { id: string; type: NodeType }): NodeRef {
    return new NodeRef(value.id, value.type);
  }

  equals(other: NodeRef): boolean {
    return this.id === other.id && this.type === other.type;
  }

  isGroup(): boolean {
    return this.type === "group";
  }

  isProject(): boolean {
    return this.type === "project";
  }
}
