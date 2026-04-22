import { container } from "@/infrastructure/container";
import { NodeRef, NodeType } from "@/domain/value-objects/NodeRef";

export class GroupScopeService {
  static async resolveProjectIds(input: {
    id: string;
    type: NodeType;
  }): Promise<string[]> {
    const ref =
      input.type === "group"
        ? NodeRef.group(input.id)
        : NodeRef.project(input.id);
    return container.useCases.resolveProjectScope.execute(ref);
  }
}
