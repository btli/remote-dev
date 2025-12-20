"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export interface SessionFolder {
  id: string;
  name: string;
  collapsed: boolean;
}

interface FolderContextValue {
  folders: SessionFolder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
  loading: boolean;
  createFolder: (name: string) => Promise<SessionFolder>;
  updateFolder: (folderId: string, updates: Partial<{ name: string; collapsed: boolean }>) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolder: (folderId: string) => Promise<void>;
  moveSessionToFolder: (sessionId: string, folderId: string | null) => Promise<void>;
  refreshFolders: () => Promise<void>;
}

const FolderContext = createContext<FolderContextValue | null>(null);

interface FolderProviderProps {
  children: ReactNode;
}

export function FolderProvider({ children }: FolderProviderProps) {
  const [folders, setFolders] = useState<SessionFolder[]>([]);
  const [sessionFolders, setSessionFolders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refreshFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders");
      if (!response.ok) throw new Error("Failed to fetch folders");
      const data = await response.json();

      setFolders(
        data.folders.map((f: { id: string; name: string; collapsed: boolean }) => ({
          id: f.id,
          name: f.name,
          collapsed: f.collapsed ?? false,
        }))
      );
      setSessionFolders(data.sessionFolders || {});
    } catch (error) {
      console.error("Error fetching folders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch folders on mount
  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const createFolder = useCallback(
    async (name: string): Promise<SessionFolder> => {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error("Failed to create folder");
      }

      const folder = await response.json();
      const newFolder: SessionFolder = {
        id: folder.id,
        name: folder.name,
        collapsed: folder.collapsed ?? false,
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
      setSessionFolders((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((sessionId) => {
          if (next[sessionId] === folderId) {
            delete next[sessionId];
          }
        });
        return next;
      });

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

  const moveSessionToFolder = useCallback(
    async (sessionId: string, folderId: string | null) => {
      // Optimistic update
      setSessionFolders((prev) => {
        const next = { ...prev };
        if (folderId) {
          next[sessionId] = folderId;
        } else {
          delete next[sessionId];
        }
        return next;
      });

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
    [refreshFolders]
  );

  return (
    <FolderContext.Provider
      value={{
        folders,
        sessionFolders,
        loading,
        createFolder,
        updateFolder,
        deleteFolder,
        toggleFolder,
        moveSessionToFolder,
        refreshFolders,
      }}
    >
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
