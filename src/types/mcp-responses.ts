/**
 * MCP response types for folder hierarchy tools
 *
 * These types define the response structures for MCP tools that provide
 * folder context to autonomous agents.
 */

import type { ResolvedPreferences } from "./preferences";

/**
 * Summary metadata for a folder (lightweight, for listings)
 */
export interface FolderMetadataSummary {
  category: string;
  framework: string | null;
  primaryLanguage: string | null;
  enrichmentStatus: string;
  enrichedAt: string | null;
}

/**
 * Child folder response with optional metadata
 */
export interface FolderChildResponse {
  id: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  metadata?: FolderMetadataSummary;
}

/**
 * Response for folder_get_children tool
 */
export interface FolderChildrenResponse {
  success: boolean;
  count: number;
  children: FolderChildResponse[];
}

/**
 * Parent folder in hierarchy chain
 */
export interface FolderParentChainItem {
  id: string;
  name: string;
}

/**
 * Dependency info for project context
 */
export interface DependencyInfo {
  name: string;
  version: string | null;
  isDev: boolean;
}

/**
 * Full project metadata response
 */
export interface ProjectMetadataContext {
  category: string;
  framework: string | null;
  primaryLanguage: string | null;
  languages: string[];
  packageManager: string | null;
  dependencyCount: number;
  devDependencyCount: number;
  testFramework: string | null;
  buildTool: string | null;
  suggestedStartupCommands: string[];
  enrichmentStatus: string;
  enrichedAt: string | null;
}

/**
 * Complete folder context for agent startup
 */
export interface FolderContextResponse {
  success: boolean;
  folder: {
    id: string;
    name: string;
    path: string | null;
  };
  preferences: ResolvedPreferences;
  projectMetadata: ProjectMetadataContext | null;
  children: FolderChildResponse[] | null;
  parentChain: FolderParentChainItem[] | null;
  hint: string;
}
