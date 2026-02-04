/**
 * Pinned Files Type Definitions
 *
 * Pinned files are stored per-folder in folder_preferences.
 * Users can pin config files (.env, JSON, YAML, etc.) to a folder
 * and open them as file-type sessions with syntax highlighting.
 */

export interface PinnedFile {
  /** Stable UUID for this pinned file entry */
  id: string;
  /** Absolute path to the file */
  path: string;
  /** Display name (basename of path) */
  name: string;
  /** Sort order for manual reordering */
  sortOrder: number;
  /** When this file was pinned */
  createdAt: string;
}

/**
 * Parse pinned files from JSON string (database storage)
 */
export function parsePinnedFiles(json: string | null): PinnedFile[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    // Filter out malformed entries — require at minimum id and path as strings
    const valid = parsed.filter(
      (item: unknown): item is PinnedFile =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).path === "string"
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

/**
 * Serialize pinned files to JSON string for database storage
 */
export function serializePinnedFiles(files: PinnedFile[] | null): string | null {
  if (!files || files.length === 0) return null;
  return JSON.stringify(files);
}
