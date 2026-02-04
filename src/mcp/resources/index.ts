/**
 * MCP Resources Index
 *
 * Aggregates all resources from domain-specific modules.
 */
import { sessionResources } from "./session-resources.js";
import { folderResources } from "./folder-resources.js";
import { profileResources } from "./profile-resources.js";
import { matchUri } from "../registry.js";
import type { RegisteredResource } from "../types.js";

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
 * Profile Resources:
 * - rdv://profiles - List all agent profiles
 * - rdv://profiles/{id} - Profile details with environment
 */
export const allResources: RegisteredResource[] = [
  ...sessionResources,
  ...folderResources,
  ...profileResources,
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
