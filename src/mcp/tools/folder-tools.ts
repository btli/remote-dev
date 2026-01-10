/**
 * Folder Tools - Folder and Preferences Management
 *
 * Tools for organizing sessions into folders and managing preferences.
 * Includes hierarchy tools for agent context awareness.
 */
import { z } from "zod";
import { createTool } from "../registry";
import { successResult } from "../utils/error-handler";
import * as FolderService from "@/services/folder-service";
import * as PreferencesService from "@/services/preferences-service";
import { DrizzleProjectMetadataRepository } from "@/infrastructure/persistence/repositories/DrizzleProjectMetadataRepository";
import { ProjectMetadataMapper } from "@/infrastructure/persistence/mappers/ProjectMetadataMapper";
import type { RegisteredTool } from "../types";
import type {
  FolderChildResponse,
  FolderMetadataSummary,
  FolderContextResponse,
} from "@/types/mcp-responses";

// Repository instance for metadata lookups
const metadataRepository = new DrizzleProjectMetadataRepository();

/**
 * folder_list - List all folders
 */
const folderList = createTool({
  name: "folder_list",
  description: "List all folders for organizing terminal sessions.",
  inputSchema: z.object({}),
  handler: async (_input, context) => {
    const folders = await FolderService.getFolders(context.userId);

    return successResult({
      success: true,
      count: folders.length,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        collapsed: f.collapsed,
        sortOrder: f.sortOrder,
      })),
    });
  },
});

/**
 * folder_create - Create a new folder
 */
const folderCreate = createTool({
  name: "folder_create",
  description: "Create a new folder for organizing sessions.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Folder name"),
    parentId: z
      .string()
      .uuid()
      .optional()
      .describe("Parent folder ID for nested folders"),
  }),
  handler: async (input, context) => {
    const folder = await FolderService.createFolder(
      context.userId,
      input.name,
      input.parentId
    );

    return successResult({
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      },
    });
  },
});

/**
 * folder_update - Update a folder
 */
const folderUpdate = createTool({
  name: "folder_update",
  description: "Update folder properties like name or parent.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder ID to update"),
    name: z.string().optional().describe("New folder name"),
    parentId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("New parent folder ID (null for root level)"),
    collapsed: z.boolean().optional().describe("Collapse/expand folder"),
  }),
  handler: async (input, context) => {
    const updates: {
      name?: string;
      parentId?: string | null;
      collapsed?: boolean;
    } = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.parentId !== undefined) updates.parentId = input.parentId;
    if (input.collapsed !== undefined) updates.collapsed = input.collapsed;

    const folder = await FolderService.updateFolder(
      input.folderId,
      context.userId,
      updates
    );

    if (!folder) {
      return successResult({
        success: false,
        error: "Folder not found",
        code: "FOLDER_NOT_FOUND",
      });
    }

    return successResult({
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        collapsed: folder.collapsed,
      },
    });
  },
});

/**
 * folder_delete - Delete a folder
 */
const folderDelete = createTool({
  name: "folder_delete",
  description:
    "Delete a folder. Sessions in the folder will be moved to root level.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder ID to delete"),
  }),
  handler: async (input, context) => {
    await FolderService.deleteFolder(input.folderId, context.userId);

    return successResult({
      success: true,
      folderId: input.folderId,
      message: "Folder deleted. Sessions moved to root level.",
    });
  },
});

/**
 * preferences_get - Get user preferences
 */
const preferencesGet = createTool({
  name: "preferences_get",
  description:
    "Get user settings and folder preferences. Shows the active folder and preference inheritance.",
  inputSchema: z.object({
    folderId: z
      .string()
      .uuid()
      .optional()
      .describe("Get resolved preferences for a specific folder"),
  }),
  handler: async (input, context) => {
    if (input.folderId) {
      // Get resolved preferences for specific folder
      const resolved = await PreferencesService.getResolvedPreferences(
        context.userId,
        input.folderId
      );

      return successResult({
        success: true,
        folderId: input.folderId,
        resolved: {
          defaultWorkingDirectory: resolved.defaultWorkingDirectory,
          defaultShell: resolved.defaultShell,
          startupCommand: resolved.startupCommand,
          theme: resolved.theme,
          fontSize: resolved.fontSize,
          fontFamily: resolved.fontFamily,
        },
      });
    }

    // Get all user settings
    const settings = await PreferencesService.getUserSettings(context.userId);

    return successResult({
      success: true,
      userSettings: {
        defaultWorkingDirectory: settings.defaultWorkingDirectory,
        defaultShell: settings.defaultShell,
        startupCommand: settings.startupCommand,
        theme: settings.theme,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        activeFolderId: settings.activeFolderId,
        pinnedFolderId: settings.pinnedFolderId,
      },
    });
  },
});

/**
 * preferences_set - Update user or folder preferences
 */
const preferencesSet = createTool({
  name: "preferences_set",
  description:
    "Update user settings or folder-specific preferences. " +
    "Folder preferences override user settings for sessions in that folder.",
  inputSchema: z.object({
    folderId: z
      .string()
      .uuid()
      .optional()
      .describe("Folder ID to set preferences for (omit for user settings)"),
    defaultWorkingDirectory: z.string().optional(),
    startupCommand: z.string().optional(),
    environmentVars: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables as key-value pairs"),
    localRepoPath: z
      .string()
      .optional()
      .describe("Local git repository path for worktree operations"),
  }),
  handler: async (input, context) => {
    if (input.folderId) {
      // Update folder preferences
      const result = await PreferencesService.updateFolderPreferences(
        input.folderId,
        context.userId,
        {
          defaultWorkingDirectory: input.defaultWorkingDirectory,
          startupCommand: input.startupCommand,
          environmentVars: input.environmentVars,
          localRepoPath: input.localRepoPath,
        }
      );

      return successResult({
        success: true,
        folderId: input.folderId,
        preferences: {
          defaultWorkingDirectory: result.preferences.defaultWorkingDirectory,
          startupCommand: result.preferences.startupCommand,
          environmentVars: result.preferences.environmentVars,
          localRepoPath: result.preferences.localRepoPath,
        },
        portValidation: result.portValidation,
      });
    }

    // Update user settings
    const settings = await PreferencesService.updateUserSettings(
      context.userId,
      {
        defaultWorkingDirectory: input.defaultWorkingDirectory,
        startupCommand: input.startupCommand,
      }
    );

    return successResult({
      success: true,
      userSettings: {
        defaultWorkingDirectory: settings.defaultWorkingDirectory,
        startupCommand: settings.startupCommand,
      },
    });
  },
});

/**
 * folder_get_children - Get child folders for a parent
 *
 * Used by agents to understand what sub-projects exist under their assigned folder.
 */
const folderGetChildren = createTool({
  name: "folder_get_children",
  description:
    "Get immediate child folders for a parent folder. " +
    "Use this to discover sub-projects in your assigned scope. " +
    "Set includeMetadata=true to get tech stack info for each child.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("Parent folder ID to get children for"),
    includeMetadata: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include project metadata (tech stack) for each child"),
  }),
  handler: async (input, context) => {
    // Validate folder exists and belongs to user
    const folder = await FolderService.getFolderById(input.folderId, context.userId);
    if (!folder) {
      return successResult({
        success: false,
        error: "Folder not found or access denied",
        code: "FOLDER_NOT_FOUND",
      });
    }

    const children = await FolderService.getChildFolders(input.folderId, context.userId);

    // Optionally fetch metadata for each child
    const childResponses: FolderChildResponse[] = await Promise.all(
      children.map(async (child) => {
        const response: FolderChildResponse = {
          id: child.id,
          name: child.name,
          collapsed: child.collapsed,
          sortOrder: child.sortOrder,
        };

        if (input.includeMetadata) {
          const metadata = await metadataRepository.findByFolderId(child.id, context.userId);
          if (metadata) {
            response.metadata = {
              category: metadata.category,
              framework: metadata.framework,
              primaryLanguage: metadata.primaryLanguage,
              enrichmentStatus: metadata.enrichmentStatus.toString(),
              enrichedAt: metadata.enrichedAt?.toISOString() ?? null,
            };
          }
        }

        return response;
      })
    );

    return successResult({
      success: true,
      count: childResponses.length,
      children: childResponses,
    });
  },
});

/**
 * folder_get_context - Get complete project context for agent startup
 *
 * This is the primary tool for agents to understand their assigned scope.
 * Returns folder metadata, preferences, tech stack, children, and parent chain.
 */
const folderGetContext = createTool({
  name: "folder_get_context",
  description:
    "Get complete project context for a folder. " +
    "Use this on startup to understand your assigned scope, tech stack, preferences, " +
    "child projects you can coordinate, and your position in the folder hierarchy. " +
    "Essential for autonomous agents to operate within their project boundary.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("Folder ID to get context for"),
    includeChildren: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include child folders and their metadata"),
    includeParentChain: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include parent folder chain to root"),
  }),
  handler: async (input, context) => {
    // Get folder details
    const folder = await FolderService.getFolderById(input.folderId, context.userId);
    if (!folder) {
      return successResult({
        success: false,
        error: "Folder not found or access denied",
        code: "FOLDER_NOT_FOUND",
      });
    }

    // Get resolved preferences (with inheritance)
    const preferences = await PreferencesService.getResolvedPreferences(
      context.userId,
      input.folderId
    );

    // Get project metadata if enriched
    const metadata = await metadataRepository.findByFolderId(input.folderId, context.userId);

    // Build response
    const response: FolderContextResponse = {
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        path: metadata?.projectPath ?? preferences.defaultWorkingDirectory ?? null,
      },
      preferences: preferences,
      projectMetadata: metadata
        ? {
            category: metadata.category,
            framework: metadata.framework,
            primaryLanguage: metadata.primaryLanguage,
            languages: metadata.languages,
            packageManager: metadata.packageManager,
            dependencyCount: metadata.dependencies.length,
            devDependencyCount: metadata.devDependencies.length,
            testFramework: metadata.testFramework?.framework ?? null,
            buildTool: metadata.buildTool?.tool ?? null,
            suggestedStartupCommands: metadata.suggestedStartupCommands,
            enrichmentStatus: metadata.enrichmentStatus.toString(),
            enrichedAt: metadata.enrichedAt?.toISOString() ?? null,
          }
        : null,
      children: null,
      parentChain: null,
      hint: "",
    };

    // Get children if requested
    if (input.includeChildren) {
      const children = await FolderService.getChildFolders(input.folderId, context.userId);
      response.children = await Promise.all(
        children.map(async (child) => {
          const childMeta = await metadataRepository.findByFolderId(child.id, context.userId);
          return {
            id: child.id,
            name: child.name,
            collapsed: child.collapsed,
            sortOrder: child.sortOrder,
            metadata: childMeta
              ? {
                  category: childMeta.category,
                  framework: childMeta.framework,
                  primaryLanguage: childMeta.primaryLanguage,
                  enrichmentStatus: childMeta.enrichmentStatus.toString(),
                  enrichedAt: childMeta.enrichedAt?.toISOString() ?? null,
                }
              : undefined,
          };
        })
      );
    }

    // Get parent chain if requested
    if (input.includeParentChain) {
      const parents = await FolderService.getParentChain(input.folderId, context.userId);
      response.parentChain = parents.map((p) => ({
        id: p.id,
        name: p.name,
      }));
    }

    // Generate contextual hint
    const hints: string[] = [];
    if (metadata) {
      hints.push(`${metadata.framework ?? metadata.category} project`);
      if (metadata.primaryLanguage) {
        hints.push(`primary language: ${metadata.primaryLanguage}`);
      }
    }
    if (response.children && response.children.length > 0) {
      hints.push(`${response.children.length} child project(s) in scope`);
    }
    if (!metadata) {
      hints.push("metadata not enriched - use project_metadata_enrich to detect tech stack");
    }
    response.hint = hints.join(", ");

    return successResult(response);
  },
});

/**
 * Export all folder tools
 */
export const folderTools: RegisteredTool[] = [
  folderList,
  folderCreate,
  folderUpdate,
  folderDelete,
  preferencesGet,
  preferencesSet,
  folderGetChildren,
  folderGetContext,
];
