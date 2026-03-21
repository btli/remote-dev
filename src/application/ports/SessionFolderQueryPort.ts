/**
 * SessionFolderQueryPort - Port for querying session-to-folder mappings.
 *
 * This is a lightweight query port that avoids full domain entity mapping,
 * used by ListFoldersUseCase to build the sidebar folder tree.
 */

export interface SessionFolderMapping {
  sessionId: string;
  folderId: string;
}

export interface SessionFolderQueryPort {
  findSessionFolderMappings(
    userId: string
  ): Promise<SessionFolderMapping[]>;
}
