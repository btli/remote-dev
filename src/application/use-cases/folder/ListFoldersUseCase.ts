/**
 * ListFoldersUseCase - Lists all folders and session-to-folder mappings.
 *
 * Returns both the folder hierarchy and a mapping of which sessions
 * belong to which folders, useful for building the sidebar tree view.
 */

import type { Folder } from "@/domain/entities/Folder";
import type { FolderRepository } from "@/application/ports/FolderRepository";

export interface ListFoldersInput {
  userId: string;
}

export interface SessionFolderMapping {
  sessionId: string;
  folderId: string;
}

export interface ListFoldersResult {
  folders: Folder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
}

export interface SessionFolderQueryPort {
  findSessionFolderMappings(
    userId: string
  ): Promise<SessionFolderMapping[]>;
}

export class ListFoldersUseCase {
  constructor(
    private readonly folderRepository: FolderRepository,
    private readonly sessionFolderQuery: SessionFolderQueryPort
  ) {}

  async execute(input: ListFoldersInput): Promise<ListFoldersResult> {
    const [folders, mappings] = await Promise.all([
      this.folderRepository.findByUser(input.userId, {
        orderBy: { field: "sortOrder", direction: "asc" },
      }),
      this.sessionFolderQuery.findSessionFolderMappings(input.userId),
    ]);

    const sessionFolders: Record<string, string> = {};
    for (const mapping of mappings) {
      sessionFolders[mapping.sessionId] = mapping.folderId;
    }

    return {
      folders,
      sessionFolders,
    };
  }
}
