"use client";

/**
 * useNotes - Hook for managing session notes with SDK API.
 *
 * Provides CRUD operations for notes with:
 * - Filtering by session, folder, type, tags
 * - Search functionality
 * - Pin and archive management
 * - Real-time polling
 */

import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type NoteType =
  | "observation"
  | "decision"
  | "gotcha"
  | "pattern"
  | "question"
  | "todo"
  | "reference";

export const NOTE_TYPES: NoteType[] = [
  "observation",
  "decision",
  "gotcha",
  "pattern",
  "question",
  "todo",
  "reference",
];

export interface Note {
  id: string;
  userId: string;
  sessionId: string | null;
  folderId: string | null;
  type: NoteType;
  title: string | null;
  content: string;
  tags: string[];
  context: Record<string, unknown> | null;
  priority: number;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteInput {
  type?: NoteType;
  title?: string;
  content: string;
  tags?: string[];
  sessionId?: string;
  folderId?: string;
  priority?: number;
  context?: Record<string, unknown>;
}

export interface UpdateNoteInput {
  type?: NoteType;
  title?: string;
  content?: string;
  tags?: string[];
  priority?: number;
  pinned?: boolean;
  archived?: boolean;
  context?: Record<string, unknown>;
}

export interface UseNotesOptions {
  sessionId?: string | null;
  folderId?: string | null;
  /** Filter by specific types */
  types?: NoteType[];
  /** Filter by tags */
  tags?: string[];
  /** Show archived notes */
  includeArchived?: boolean;
  /** Only show pinned notes */
  pinnedOnly?: boolean;
  /** Search query */
  searchQuery?: string;
  /** Polling interval in milliseconds. 0 = disabled. Default: 30000 (30s) */
  pollInterval?: number;
  /** Limit results */
  limit?: number;
  /** Initial fetch on mount */
  autoFetch?: boolean;
}

export interface UseNotesReturn {
  /** All notes */
  notes: Note[];
  /** Notes grouped by type */
  byType: Record<NoteType, Note[]>;
  /** Pinned notes */
  pinned: Note[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh notes */
  refresh: () => Promise<void>;
  /** Create a new note */
  createNote: (input: CreateNoteInput) => Promise<Note | null>;
  /** Update a note */
  updateNote: (noteId: string, input: UpdateNoteInput) => Promise<boolean>;
  /** Delete a note */
  deleteNote: (noteId: string) => Promise<boolean>;
  /** Toggle pin status */
  togglePin: (noteId: string) => Promise<boolean>;
  /** Toggle archive status */
  toggleArchive: (noteId: string) => Promise<boolean>;
  /** Counts by type */
  counts: Record<NoteType, number> & { total: number; pinned: number };
  /** Active filter types */
  filterTypes: NoteType[];
  /** Set filter types */
  setFilterTypes: Dispatch<SetStateAction<NoteType[]>>;
  /** Search query */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const parseNote = (data: Record<string, unknown>): Note => ({
  id: data.id as string,
  userId: data.userId as string,
  sessionId: data.sessionId as string | null,
  folderId: data.folderId as string | null,
  type: data.type as NoteType,
  title: data.title as string | null,
  content: data.content as string,
  tags: (data.tags as string[]) ?? [],
  context: data.context as Record<string, unknown> | null,
  priority: (data.priority as number) ?? 0.5,
  pinned: (data.pinned as boolean) ?? false,
  archived: (data.archived as boolean) ?? false,
  createdAt: new Date(data.createdAt as string),
  updatedAt: new Date(data.updatedAt as string),
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useNotes({
  sessionId,
  folderId,
  types,
  tags,
  includeArchived = false,
  pinnedOnly = false,
  searchQuery: initialSearchQuery = "",
  pollInterval = 30000,
  limit = 100,
  autoFetch = true,
}: UseNotesOptions = {}): UseNotesReturn {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTypes, setFilterTypes] = useState<NoteType[]>(types ?? NOTE_TYPES);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch notes from API
   */
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (sessionId) params.set("sessionId", sessionId);
      if (folderId) params.set("folderId", folderId);
      if (filterTypes.length < NOTE_TYPES.length) {
        params.set("type", filterTypes.join(","));
      }
      if (tags && tags.length > 0) {
        params.set("tag", tags.join(","));
      }
      if (!includeArchived) params.set("archived", "false");
      if (pinnedOnly) params.set("pinned", "true");
      if (searchQuery) params.set("search", searchQuery);
      params.set("limit", String(limit));

      const url = `/api/sdk/notes?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const data = await response.json();
      const mapped = (data as Record<string, unknown>[]).map(parseNote);
      setNotes(mapped);
    } catch (err) {
      console.error("[useNotes] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch notes");
    } finally {
      setLoading(false);
    }
  }, [sessionId, folderId, filterTypes, tags, includeArchived, pinnedOnly, searchQuery, limit]);

  /**
   * Create a new note
   */
  const createNote = useCallback(async (input: CreateNoteInput): Promise<Note | null> => {
    try {
      const response = await fetch("/api/sdk/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: input.type ?? "observation",
          title: input.title,
          content: input.content,
          tags: input.tags ?? [],
          sessionId: input.sessionId ?? sessionId,
          folderId: input.folderId ?? folderId,
          priority: input.priority ?? 0.5,
          context: input.context,
        }),
      });

      if (!response.ok) {
        throw new Error(`Create failed: ${response.statusText}`);
      }

      const data = await response.json();
      const note = parseNote(data);

      // Optimistically add to list
      setNotes((prev) => [note, ...prev]);

      return note;
    } catch (err) {
      console.error("[useNotes] Create error:", err);
      setError(err instanceof Error ? err.message : "Failed to create note");
      return null;
    }
  }, [sessionId, folderId]);

  /**
   * Update a note
   */
  const updateNote = useCallback(async (noteId: string, input: UpdateNoteInput): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sdk/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.statusText}`);
      }

      const data = await response.json();
      const updated = parseNote(data);

      // Optimistically update in list
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));

      return true;
    } catch (err) {
      console.error("[useNotes] Update error:", err);
      setError(err instanceof Error ? err.message : "Failed to update note");
      return false;
    }
  }, []);

  /**
   * Delete a note
   */
  const deleteNote = useCallback(async (noteId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sdk/notes/${noteId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }

      // Optimistically remove from list
      setNotes((prev) => prev.filter((n) => n.id !== noteId));

      return true;
    } catch (err) {
      console.error("[useNotes] Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete note");
      return false;
    }
  }, []);

  /**
   * Toggle pin status
   */
  const togglePin = useCallback(async (noteId: string): Promise<boolean> => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return false;
    return updateNote(noteId, { pinned: !note.pinned });
  }, [notes, updateNote]);

  /**
   * Toggle archive status
   */
  const toggleArchive = useCallback(async (noteId: string): Promise<boolean> => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return false;
    return updateNote(noteId, { archived: !note.archived });
  }, [notes, updateNote]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchNotes();
    }
  }, [autoFetch, fetchNotes]);

  // Polling - always return cleanup to handle condition changes
  useEffect(() => {
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchNotes, pollInterval);
    }
    // Always return cleanup to clear any existing interval when deps change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollInterval, fetchNotes]);

  // Group by type
  const byType = notes.reduce(
    (acc, note) => {
      if (!acc[note.type]) {
        acc[note.type] = [];
      }
      acc[note.type].push(note);
      return acc;
    },
    {} as Record<NoteType, Note[]>
  );

  // Ensure all types have arrays
  for (const type of NOTE_TYPES) {
    if (!byType[type]) {
      byType[type] = [];
    }
  }

  // Pinned notes
  const pinned = notes.filter((n) => n.pinned);

  // Counts
  const counts = {
    observation: byType.observation.length,
    decision: byType.decision.length,
    gotcha: byType.gotcha.length,
    pattern: byType.pattern.length,
    question: byType.question.length,
    todo: byType.todo.length,
    reference: byType.reference.length,
    total: notes.length,
    pinned: pinned.length,
  };

  return {
    notes,
    byType,
    pinned,
    loading,
    error,
    refresh: fetchNotes,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
    toggleArchive,
    counts,
    filterTypes,
    setFilterTypes,
    searchQuery,
    setSearchQuery,
  };
}
