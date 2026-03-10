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
import type {
  ProjectTask,
  CreateTaskInput,
  UpdateTaskInput,
  TaskSource,
  TaskLabel,
  TaskSubtask,
} from "@/types/task";
import { usePreferencesContext } from "./PreferencesContext";
import { useSessionContext } from "./SessionContext";

/** Hydrate date strings from API response into Date objects */
function hydrateTask(raw: Record<string, unknown>): ProjectTask {
  return {
    ...(raw as unknown as ProjectTask),
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
    labels: (raw.labels as TaskLabel[]) ?? [],
    subtasks: (raw.subtasks as TaskSubtask[]) ?? [],
    dueDate: raw.dueDate ? new Date(raw.dueDate as string) : null,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    instructions: (raw.instructions as string | null) ?? null,
    agentTaskKey: (raw.agentTaskKey as string | null) ?? null,
    owner: (raw.owner as string | null) ?? null,
    blockedBy: (raw.blockedBy as string[]) ?? [],
  };
}

interface TaskContextValue {
  /** Tasks scoped to the active session (or empty when no session is active) */
  tasks: ProjectTask[];
  loading: boolean;
  error: string | null;
  activeFolderId: string | null;
  refreshTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<ProjectTask | null>;
  updateTask: (
    id: string,
    input: UpdateTaskInput
  ) => Promise<ProjectTask | null>;
  deleteTask: (id: string) => Promise<boolean>;
  clearTasks: (
    source?: TaskSource,
    options?: { sessionId?: string; completedOnly?: boolean }
  ) => Promise<number>;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function useTaskContext() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTaskContext must be used within a TaskProvider");
  }
  return context;
}

interface TaskProviderProps {
  children: ReactNode;
}

export function TaskProvider({ children }: TaskProviderProps) {
  const [allTasks, setAllTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeProject } = usePreferencesContext();
  const activeFolderId = activeProject.folderId;
  const { activeSessionId } = useSessionContext();

  const refreshTasks = useCallback(async () => {
    if (!activeFolderId) {
      setAllTasks([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/tasks?folderId=${encodeURIComponent(activeFolderId)}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch tasks");
      }
      const data = await response.json();
      setAllTasks(data.map(hydrateTask));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [activeFolderId]);

  // Reload when active folder changes
  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<ProjectTask | null> => {
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            folderId: input.folderId ?? activeFolderId,
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to create task");
        }
        const task = hydrateTask(await response.json());
        setAllTasks((prev) => [task, ...prev]);
        return task;
      } catch (err) {
        console.error("Error creating task:", err);
        return null;
      }
    },
    [activeFolderId]
  );

  const updateTask = useCallback(
    async (
      id: string,
      input: UpdateTaskInput
    ): Promise<ProjectTask | null> => {
      try {
        const response = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          throw new Error("Failed to update task");
        }
        const task = hydrateTask(await response.json());
        setAllTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
        return task;
      } catch (err) {
        console.error("Error updating task:", err);
        return null;
      }
    },
    []
  );

  const deleteTask = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete task");
      }
      setAllTasks((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch (err) {
      console.error("Error deleting task:", err);
      return false;
    }
  }, []);

  const clearTasks = useCallback(
    async (
      source?: TaskSource,
      options?: { sessionId?: string; completedOnly?: boolean }
    ): Promise<number> => {
      if (!activeFolderId) return 0;
      try {
        const params = new URLSearchParams({
          folderId: activeFolderId,
        });
        if (source) params.set("source", source);
        if (options?.sessionId) params.set("sessionId", options.sessionId);
        if (options?.completedOnly) params.set("completedOnly", "true");

        const response = await fetch(`/api/tasks?${params.toString()}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Failed to clear tasks");
        }
        const { deleted } = await response.json();

        setAllTasks((prev) =>
          prev.filter((t) => {
            if (t.folderId !== activeFolderId) return true;
            if (source && t.source !== source) return true;
            if (options?.sessionId && t.sessionId !== options.sessionId) return true;
            if (options?.completedOnly && t.status !== "done" && t.status !== "cancelled") return true;
            return false;
          })
        );
        return deleted;
      } catch (err) {
        console.error("Error clearing tasks:", err);
        return 0;
      }
    },
    [activeFolderId]
  );

  const activeSessionTasks = useMemo(
    () =>
      activeSessionId
        ? allTasks.filter((t) => t.sessionId === activeSessionId)
        : [],
    [allTasks, activeSessionId]
  );

  const value = useMemo(
    () => ({
      tasks: activeSessionTasks,
      loading,
      error,
      activeFolderId,
      refreshTasks,
      createTask,
      updateTask,
      deleteTask,
      clearTasks,
    }),
    [
      activeSessionTasks,
      loading,
      error,
      activeFolderId,
      refreshTasks,
      createTask,
      updateTask,
      deleteTask,
      clearTasks,
    ]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
