/**
 * Folder Resources - Read-only access to folder data
 */
import { createResource, extractUriParams } from "../registry";
import * as FolderService from "@/services/folder-service";
import * as PreferencesService from "@/services/preferences-service";
import type { RegisteredResource } from "../types";

/**
 * rdv://folders - List all folders
 */
const foldersListResource = createResource({
  uri: "rdv://folders",
  name: "Folders List",
  description: "List all folders in the folder hierarchy.",
  mimeType: "application/json",
  handler: async (_uri, context) => {
    const folders = await FolderService.getFolders(context.userId);

    const data = {
      count: folders.length,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        collapsed: f.collapsed,
        sortOrder: f.sortOrder,
      })),
    };

    return {
      uri: "rdv://folders",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * rdv://folders/{id} - Get folder details with preferences
 */
const folderDetailResource = createResource({
  uri: "rdv://folders/{id}",
  name: "Folder Details",
  description: "Get folder details including preferences.",
  mimeType: "application/json",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://folders/{id}", uri);
    const folderId = params.id;

    const folders = await FolderService.getFolders(context.userId);
    const folder = folders.find((f) => f.id === folderId);

    if (!folder) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Folder not found",
          code: "FOLDER_NOT_FOUND",
        }),
      };
    }

    // Get resolved preferences for this folder
    const preferences = await PreferencesService.getResolvedPreferences(
      context.userId,
      folderId
    );

    const data = {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      collapsed: folder.collapsed,
      preferences: {
        defaultWorkingDirectory: preferences.defaultWorkingDirectory,
        startupCommand: preferences.startupCommand,
        theme: preferences.theme,
        fontSize: preferences.fontSize,
        fontFamily: preferences.fontFamily,
      },
    };

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * rdv://preferences - Get user settings
 */
const preferencesResource = createResource({
  uri: "rdv://preferences",
  name: "User Preferences",
  description: "Get user-level settings and preferences.",
  mimeType: "application/json",
  handler: async (_uri, context) => {
    const settings = await PreferencesService.getUserSettings(context.userId);

    const data = {
      defaultWorkingDirectory: settings.defaultWorkingDirectory,
      defaultShell: settings.defaultShell,
      startupCommand: settings.startupCommand,
      theme: settings.theme,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      activeFolderId: settings.activeFolderId,
      pinnedFolderId: settings.pinnedFolderId,
      autoFollowActiveSession: settings.autoFollowActiveSession,
    };

    return {
      uri: "rdv://preferences",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * Export all folder resources
 */
export const folderResources: RegisteredResource[] = [
  foldersListResource,
  folderDetailResource,
  preferencesResource,
];
