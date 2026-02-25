import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FolderDTO } from "@remote-dev/domain";
import { getApiClient } from "@/infrastructure/api/RemoteDevApiClient";

interface FolderState {
  folders: FolderDTO[];
  loading: boolean;
  error: Error | null;
}

interface FolderActions {
  setFolders: (folders: FolderDTO[]) => void;
  addFolder: (folder: FolderDTO) => void;
  updateFolder: (id: string, updates: Partial<FolderDTO>) => void;
  removeFolder: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;

  // Async actions
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<FolderDTO>;
  deleteFolder: (id: string) => Promise<void>;
}

type FolderStore = FolderState & FolderActions;

/**
 * Folder store using Zustand with persistence.
 * Manages folder hierarchy for session organization.
 */
export const useFolderStore = create<FolderStore>()(
  persist(
    (set, get) => ({
      // Initial state
      folders: [],
      loading: false,
      error: null,

      // Mutations
      setFolders: (folders) => set({ folders, error: null }),
      addFolder: (folder) =>
        set((state) => ({ folders: [...state.folders, folder] })),
      updateFolder: (id, updates) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
        })),
      removeFolder: (id) =>
        set((state) => ({
          folders: state.folders.filter((f) => f.id !== id),
        })),
      toggleCollapsed: (id) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, collapsed: !f.collapsed } : f
          ),
        })),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      // Async actions
      fetchFolders: async () => {
        set({ loading: true, error: null });
        try {
          const apiClient = getApiClient();
          const folders = await apiClient.getFolders();
          set({ folders, loading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to fetch folders"),
            loading: false,
          });
        }
      },

      createFolder: async (name, parentId) => {
        set({ loading: true, error: null });
        try {
          const apiClient = getApiClient();
          const folder = await apiClient.createFolder({ name, parentId });
          get().addFolder(folder);
          set({ loading: false });
          return folder;
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to create folder"),
            loading: false,
          });
          throw error;
        }
      },

      deleteFolder: async (id) => {
        try {
          const apiClient = getApiClient();
          await apiClient.deleteFolder(id);
          get().removeFolder(id);
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to delete folder"),
          });
          throw error;
        }
      },
    }),
    {
      name: "folder-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ folders: state.folders }),
    }
  )
);
