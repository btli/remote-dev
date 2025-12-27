/**
 * ListFoldersUseCase - Lists all folders and session-to-folder mappings.
 *
 * Returns both the folder hierarchy and a mapping of which sessions
 * belong to which folders, useful for building the sidebar tree view.
 */

import type { Folder } from "@/domain/entities/Folder";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import type { SessionRepository } from "@/application/ports/SessionRepository";

export interface ListFoldersInput {
  userId: string;
}

export interface ListFoldersResult {
  folders: Folder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
}

export class ListFoldersUseCase {
  constructor(
    private readonly folderRepository: FolderRepository,
    private readonly sessionRepository: SessionRepository
  ) {}

  async execute(input: ListFoldersInput): Promise<ListFoldersResult> {
    // Fetch folders and sessions in parallel
    const [folders, sessions] = await Promise.all([
      this.folderRepository.findByUser(input.userId, {
        orderBy: { field: "sortOrder", direction: "asc" },
      }),
      this.sessionRepository.findByUser(input.userId),
    ]);

    // Build session-to-folder mapping
    const sessionFolders: Record<string, string> = {};
    for (const session of sessions) {
      if (session.folderId) {
        sessionFolders[session.id] = session.folderId;
      }
    }

    return {
      folders,
      sessionFolders,
    };
  }
}
