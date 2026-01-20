/**
 * Folder Tools - Folder and Preferences Management
 *
 * Tools for organizing sessions into folders and managing preferences.
 */
import { z } from "zod";
import { createTool } from "../registry.js";
import { successResult } from "../utils/error-handler.js";
import * as FolderService from "@/services/folder-service";
import * as PreferencesService from "@/services/preferences-service";
import type { RegisteredTool } from "../types.js";

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
 * Export all folder tools
 */
export const folderTools: RegisteredTool[] = [
  folderList,
  folderCreate,
  folderUpdate,
  folderDelete,
  preferencesGet,
  preferencesSet,
];
