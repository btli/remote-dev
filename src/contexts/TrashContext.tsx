"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { TrashItem, TrashItemWithMetadata, RestoreOptions } from "@/types/trash";

interface TrashContextValue {
  /** List of trash items */
  trashItems: TrashItem[];
  /** Loading state */
  loading: boolean;
  /** Whether trash has any items */
  isEmpty: boolean;
  /** Number of items in trash */
  count: number;

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
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshTrash = useCallback(async () => {
    try {
      const response = await fetch("/api/trash");
      if (!response.ok) throw new Error("Failed to fetch trash");
      const data = await response.json();

      setTrashItems(
        data.items.map((item: TrashItem) => ({
          ...item,
          trashedAt: new Date(item.trashedAt),
          expiresAt: new Date(item.expiresAt),
        }))
      );
    } catch (error) {
      console.error("Error fetching trash:", error);
    } finally {
      setLoading(false);
    }
  }, []);

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

        // Refresh trash list
        await refreshTrash();

        // Find the newly created trash item
        const newTrashItem = trashItems.find(
          (item) => item.resourceId === sessionId
        );
        return newTrashItem || null;
      } catch (error) {
        console.error("Error trashing session:", error);
        return null;
      }
    },
    [refreshTrash, trashItems]
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
          // Rollback on error
          await refreshTrash();
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error restoring from trash:", error);
        await refreshTrash();
        return false;
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

  return (
    <TrashContext.Provider
      value={{
        trashItems,
        loading,
        isEmpty: trashItems.length === 0,
        count: trashItems.length,
        refreshTrash,
        getTrashItem,
        trashSession,
        restoreItem,
        deleteItem,
        cleanupExpired,
        checkRestoreAvailability,
      }}
    >
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
