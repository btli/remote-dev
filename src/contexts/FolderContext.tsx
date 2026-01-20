"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export interface SessionFolder {
  id: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
}

interface FolderContextValue {
  folders: SessionFolder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
  loading: boolean;
  createFolder: (name: string, parentId?: string | null) => Promise<SessionFolder>;
  updateFolder: (folderId: string, updates: Partial<{ name: string; collapsed: boolean }>) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolder: (folderId: string) => Promise<void>;
  moveSessionToFolder: (sessionId: string, folderId: string | null) => Promise<void>;
  moveFolderToParent: (folderId: string, parentId: string | null) => Promise<void>;
  reorderFolders: (folderIds: string[]) => Promise<void>;
  refreshFolders: () => Promise<void>;
  /** Update local sessionFolders state without API call - used for newly created sessions */
  registerSessionFolder: (sessionId: string, folderId: string | null) => void;
}

const FolderContext = createContext<FolderContextValue | null>(null);

interface FolderProviderProps {
  children: ReactNode;
  initialFolders?: SessionFolder[];
  initialSessionFolders?: Record<string, string>;
}

export function FolderProvider({
  children,
  initialFolders = [],
  initialSessionFolders = {},
}: FolderProviderProps) {
  const [folders, setFolders] = useState<SessionFolder[]>(initialFolders);
  const [sessionFolders, setSessionFolders] = useState<Record<string, string>>(initialSessionFolders);
  const [loading, setLoading] = useState(initialFolders.length === 0);

  // Track if we've already fetched folders (guard against duplicate fetches)
  const hasFetchedFoldersRef = useRef(initialFolders.length > 0);
  const initialFoldersLengthRef = useRef(initialFolders.length);

  const refreshFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders");
      if (!response.ok) throw new Error("Failed to fetch folders");
      const data = await response.json();

      setFolders(
        data.folders.map((f: { id: string; parentId: string | null; name: string; collapsed: boolean; sortOrder?: number }) => ({
          id: f.id,
          parentId: f.parentId ?? null,
          name: f.name,
          collapsed: f.collapsed ?? false,
          sortOrder: f.sortOrder ?? 0,
        }))
      );
      setSessionFolders(data.sessionFolders || {});
    } catch (error) {
      console.error("Error fetching folders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch folders on mount if none provided (once on mount)
  useEffect(() => {
    if (hasFetchedFoldersRef.current) return;
    if (initialFoldersLengthRef.current === 0) {
      hasFetchedFoldersRef.current = true;
      refreshFolders();
    }
  }, [refreshFolders]);

  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<SessionFolder> => {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: parentId ?? null }),
      });

      if (!response.ok) {
        throw new Error("Failed to create folder");
      }

      const folder = await response.json();
      const newFolder: SessionFolder = {
        id: folder.id,
        parentId: folder.parentId ?? null,
        name: folder.name,
        collapsed: folder.collapsed ?? false,
        sortOrder: folder.sortOrder ?? 0,
      };

      setFolders((prev) => [...prev, newFolder]);
      return newFolder;
    },
    []
  );

  const updateFolder = useCallback(
    async (folderId: string, updates: Partial<{ name: string; collapsed: boolean }>) => {
      // Optimistic update
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, ...updates } : f))
      );

      try {
        const response = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          await refreshFolders();
          throw new Error("Failed to update folder");
        }
      } catch (error) {
        console.error("Error updating folder:", error);
        throw error;
      }
    },
    [refreshFolders]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      // Optimistic update
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      setSessionFolders((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([, folder]) => folder !== folderId)
        )
      );

      try {
        const response = await fetch(`/api/folders/${folderId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          await refreshFolders();
          throw new Error("Failed to delete folder");
        }
      } catch (error) {
        console.error("Error deleting folder:", error);
        throw error;
      }
    },
    [refreshFolders]
  );

  const toggleFolder = useCallback(
    async (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (folder) {
        await updateFolder(folderId, { collapsed: !folder.collapsed });
      }
    },
    [folders, updateFolder]
  );

  // Update local sessionFolders state without API call - used for newly created sessions
  const registerSessionFolder = useCallback(
    (sessionId: string, folderId: string | null) => {
      setSessionFolders((prev) => {
        const next = { ...prev };
        if (folderId) {
          next[sessionId] = folderId;
        } else {
          delete next[sessionId];
        }
        return next;
      });
    },
    []
  );

  const moveSessionToFolder = useCallback(
    async (sessionId: string, folderId: string | null) => {
      // Optimistic update
      registerSessionFolder(sessionId, folderId);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/folder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        });

        if (!response.ok) {
          await refreshFolders();
          throw new Error("Failed to move session");
        }
      } catch (error) {
        console.error("Error moving session:", error);
        throw error;
      }
    },
    [refreshFolders, registerSessionFolder]
  );

  const moveFolderToParent = useCallback(
    async (folderId: string, parentId: string | null) => {
      // Optimistic update
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, parentId } : f))
      );

      try {
        const response = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId }),
        });

        if (!response.ok) {
          await refreshFolders();
          const data = await response.json();
          throw new Error(data.error || "Failed to move folder");
        }
      } catch (error) {
        console.error("Error moving folder:", error);
        throw error;
      }
    },
    [refreshFolders]
  );

  const reorderFolders = useCallback(
    async (folderIds: string[]) => {
      // Optimistic update - update sortOrder based on array position
      setFolders((prev) => {
        const orderMap = new Map(folderIds.map((id, index) => [id, index]));
        return prev.map((f) => {
          const newOrder = orderMap.get(f.id);
          return newOrder !== undefined ? { ...f, sortOrder: newOrder } : f;
        }).sort((a, b) => a.sortOrder - b.sortOrder);
      });

      try {
        const response = await fetch("/api/folders/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderIds }),
        });

        if (!response.ok) {
          await refreshFolders();
          throw new Error("Failed to reorder folders");
        }
      } catch (error) {
        console.error("Error reordering folders:", error);
        throw error;
      }
    },
    [refreshFolders]
  );

  const contextValue = useMemo(
    () => ({
      folders,
      sessionFolders,
      loading,
      createFolder,
      updateFolder,
      deleteFolder,
      toggleFolder,
      moveSessionToFolder,
      moveFolderToParent,
      reorderFolders,
      refreshFolders,
      registerSessionFolder,
    }),
    [
      folders,
      sessionFolders,
      loading,
      createFolder,
      updateFolder,
      deleteFolder,
      toggleFolder,
      moveSessionToFolder,
      moveFolderToParent,
      reorderFolders,
      refreshFolders,
      registerSessionFolder,
    ]
  );

  return (
    <FolderContext.Provider value={contextValue}>
      {children}
    </FolderContext.Provider>
  );
}

export function useFolderContext() {
  const context = useContext(FolderContext);
  if (!context) {
    throw new Error("useFolderContext must be used within a FolderProvider");
  }
  return context;
}
