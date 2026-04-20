import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";

export interface NodePreferencesRepository {
  findForNode(node: NodeRef, userId: string): Promise<NodePreferences | null>;
  listForUser(userId: string): Promise<Map<string, NodePreferences>>;
  save(node: NodeRef, userId: string, prefs: NodePreferences): Promise<void>;
  delete(node: NodeRef, userId: string): Promise<void>;
}
