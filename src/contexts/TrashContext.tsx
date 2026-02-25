"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { TrashItem, TrashItemWithMetadata, WorktreeTrashItem, RestoreOptions } from "@/types/trash";

/** Trash items grouped by folder */
export interface TrashByFolder {
  folderId: string | null;
  folderName: string | null;
  items: WorktreeTrashItem[];
}

interface TrashContextValue {
  /** List of trash items with full metadata */
  trashItems: TrashItemWithMetadata[];
  /** Loading state */
  loading: boolean;
  /** Whether trash has any items */
  isEmpty: boolean;
  /** Number of items in trash */
  count: number;
  /** Trash items grouped by original folder */
  trashByFolder: TrashByFolder[];
  /** Get trash items for a specific folder */
  getTrashForFolder: (folderId: string | null) => WorktreeTrashItem[];

  /** Refresh trash list from server */
  refreshTrash: () => Promise<void>;

  /** Get detailed trash item with metadata */
  getTrashItem: (trashItemId: string) => Promise<TrashItemWithMetadata | null>;

  /** Trash a worktree session */
  trashSession: (sessionId: string) => Promise<TrashItem | null>;

  /** Restore an item from trash */
  restoreItem: (trashItemId: string, options?: RestoreOptions) => Promise<boolean>;

  /** Permanently delete an item */
  deleteItem: (trashItemId: string) => Promise<boolean>;

  /** Cleanup expired items */
  cleanupExpired: () => Promise<number>;

  /** Check restore availability for a trash item */
  checkRestoreAvailability: (trashItemId: string) => Promise<{
    isPathAvailable: boolean;
    originalFolderId: string | null;
    item: TrashItemWithMetadata | null;
  } | null>;
}

const TrashContext = createContext<TrashContextValue | null>(null);

interface TrashProviderProps {
  children: ReactNode;
}

export function TrashProvider({ children }: TrashProviderProps) {
  const [trashItems, setTrashItems] = useState<TrashItemWithMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshTrash = useCallback(async () => {
    try {
      const response = await fetch("/api/trash");
      if (!response.ok) throw new Error("Failed to fetch trash");
      const data = await response.json();

      setTrashItems(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.items.map((item: any) => ({
          ...item,
          trashedAt: new Date(item.trashedAt),
          expiresAt: new Date(item.expiresAt),
          metadata: item.metadata
            ? {
                ...item.metadata,
                createdAt: new Date(item.metadata.createdAt),
              }
            : undefined,
        }))
      );
    } catch (error) {
      console.error("Error fetching trash:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Group trash items by original folder
  const trashByFolder = useMemo((): TrashByFolder[] => {
    const folderMap = new Map<string | null, WorktreeTrashItem[]>();

    for (const item of trashItems) {
      if (item.resourceType === "worktree") {
        const worktreeItem = item as WorktreeTrashItem;
        const folderId = worktreeItem.metadata?.originalFolderId ?? null;

        if (!folderMap.has(folderId)) {
          folderMap.set(folderId, []);
        }
        folderMap.get(folderId)!.push(worktreeItem);
      }
    }

    return Array.from(folderMap.entries()).map(([folderId, items]) => ({
      folderId,
      folderName: items[0]?.metadata?.originalFolderName ?? null,
      items,
    }));
  }, [trashItems]);

  // Get trash items for a specific folder
  const getTrashForFolder = useCallback(
    (folderId: string | null): WorktreeTrashItem[] => {
      return trashItems.filter(
        (item) =>
          item.resourceType === "worktree" &&
          (item as WorktreeTrashItem).metadata?.originalFolderId === folderId
      ) as WorktreeTrashItem[];
    },
    [trashItems]
  );

  // Fetch trash on mount
  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const getTrashItem = useCallback(
    async (trashItemId: string): Promise<TrashItemWithMetadata | null> => {
      try {
        const response = await fetch(`/api/trash/${trashItemId}`);
        if (!response.ok) return null;
        const data = await response.json();

        return {
          ...data.item,
          trashedAt: new Date(data.item.trashedAt),
          expiresAt: new Date(data.item.expiresAt),
          metadata: data.item.metadata
            ? {
                ...data.item.metadata,
                createdAt: new Date(data.item.metadata.createdAt),
              }
            : undefined,
        };
      } catch (error) {
        console.error("Error getting trash item:", error);
        return null;
      }
    },
    []
  );

  const trashSession = useCallback(
    async (sessionId: string): Promise<TrashItem | null> => {
      try {
        // Call the session close endpoint with trash parameter
        const response = await fetch(`/api/sessions/${sessionId}?trash=true`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to trash session");
        }

        // Parse response to get the trash item ID
        const data = await response.json();
        if (!data.success || !data.trashItemId) {
          throw new Error("Trash response missing trashItemId");
        }

        // Refresh trash list to update UI
        await refreshTrash();

        // Return a partial trash item - the full item will be in the refreshed list
        // The caller just needs to know it succeeded (non-null return)
        return {
          id: data.trashItemId,
          userId: "", // Will be populated by refresh
          resourceType: "worktree" as const,
          resourceId: sessionId,
          resourceName: "",
          trashedAt: new Date(),
          expiresAt: new Date(),
        };
      } catch (error) {
        console.error("Error trashing session:", error);
        return null;
      }
    },
    [refreshTrash]
  );

  const restoreItem = useCallback(
    async (trashItemId: string, options?: RestoreOptions): Promise<boolean> => {
      // Optimistic update
      setTrashItems((prev) => prev.filter((item) => item.id !== trashItemId));

      try {
        const response = await fetch(`/api/trash/${trashItemId}/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options || {}),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          // Rollback on error
          await refreshTrash();
          throw new Error(data.error || "Failed to restore from trash");
        }

        return true;
      } catch (error) {
        if (error instanceof Error && error.message !== "Failed to restore from trash") {
          // Re-throw errors with server messages
          throw error;
        }
        console.error("Error restoring from trash:", error);
        await refreshTrash();
        throw error;
      }
    },
    [refreshTrash]
  );

  const deleteItem = useCallback(
    async (trashItemId: string): Promise<boolean> => {
      // Optimistic update
      setTrashItems((prev) => prev.filter((item) => item.id !== trashItemId));

      try {
        const response = await fetch(`/api/trash/${trashItemId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          await refreshTrash();
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error deleting trash item:", error);
        await refreshTrash();
        return false;
      }
    },
    [refreshTrash]
  );

  const cleanupExpired = useCallback(async (): Promise<number> => {
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to cleanup");
      }

      const data = await response.json();
      await refreshTrash();
      return data.deletedCount || 0;
    } catch (error) {
      console.error("Error cleaning up trash:", error);
      return 0;
    }
  }, [refreshTrash]);

  const checkRestoreAvailability = useCallback(
    async (
      trashItemId: string
    ): Promise<{
      isPathAvailable: boolean;
      originalFolderId: string | null;
      item: TrashItemWithMetadata | null;
    } | null> => {
      try {
        const response = await fetch(`/api/trash/${trashItemId}/restore`);
        if (!response.ok) return null;

        const data = await response.json();
        return {
          isPathAvailable: data.isPathAvailable,
          originalFolderId: data.originalFolderId,
          item: data.item
            ? {
                ...data.item,
                trashedAt: new Date(data.item.trashedAt),
                expiresAt: new Date(data.item.expiresAt),
              }
            : null,
        };
      } catch (error) {
        console.error("Error checking restore availability:", error);
        return null;
      }
    },
    []
  );

  const contextValue = useMemo(
    () => ({
      trashItems,
      loading,
      isEmpty: trashItems.length === 0,
      count: trashItems.length,
      trashByFolder,
      getTrashForFolder,
      refreshTrash,
      getTrashItem,
      trashSession,
      restoreItem,
      deleteItem,
      cleanupExpired,
      checkRestoreAvailability,
    }),
    [
      trashItems,
      loading,
      trashByFolder,
      getTrashForFolder,
      refreshTrash,
      getTrashItem,
      trashSession,
      restoreItem,
      deleteItem,
      cleanupExpired,
      checkRestoreAvailability,
    ]
  );

  return (
    <TrashContext.Provider value={contextValue}>
      {children}
    </TrashContext.Provider>
  );
}

export function useTrashContext() {
  const context = useContext(TrashContext);
  if (!context) {
    throw new Error("useTrashContext must be used within a TrashProvider");
  }
  return context;
}
