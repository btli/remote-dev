/**
 * MCP Resources Index
 *
 * Aggregates all resources from domain-specific modules.
 */
import { sessionResources } from "./session-resources";
import { folderResources } from "./folder-resources";
import { taskResources } from "./task-resources";
import { matchUri } from "../registry";
import type { RegisteredResource } from "../types";

/**
 * All registered MCP resources:
 *
 * Session Resources:
 * - rdv://sessions - List all sessions
 * - rdv://sessions/{id} - Session details
 * - rdv://sessions/{id}/output - Terminal output
 *
 * Folder Resources:
 * - rdv://folders - List all folders
 * - rdv://folders/{id} - Folder details with preferences
 * - rdv://preferences - User settings
 *
 * Task Resources:
 * - rdv://tasks/{id} - Task details with delegations
 * - rdv://orchestrators/{id}/knowledge - Project knowledge for orchestrator
 */
export const allResources: RegisteredResource[] = [
  ...sessionResources,
  ...folderResources,
  ...taskResources,
];

/**
 * Find a resource by URI
 */
export function findResource(uri: string): RegisteredResource | undefined {
  return allResources.find((r) => matchUri(r.uri, uri));
}

/**
 * List all resource URIs
 */
export function listResourceUris(): string[] {
  return allResources.map((r) => r.uri);
}
