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
} from "@/types/task";
import { usePreferencesContext } from "./PreferencesContext";

/** Hydrate date strings from API response into Date objects */
function hydrateTask(raw: Record<string, unknown>): ProjectTask {
  return {
    ...(raw as unknown as ProjectTask),
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
    dueDate: raw.dueDate ? new Date(raw.dueDate as string) : null,
  };
}

interface TaskContextValue {
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
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeProject } = usePreferencesContext();
  const activeFolderId = activeProject.folderId;

  const refreshTasks = useCallback(async () => {
    if (!activeFolderId) {
      setTasks([]);
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
      setTasks(data.map(hydrateTask));
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
        setTasks((prev) => [task, ...prev]);
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
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
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
      setTasks((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch (err) {
      console.error("Error deleting task:", err);
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      tasks,
      loading,
      error,
      activeFolderId,
      refreshTasks,
      createTask,
      updateTask,
      deleteTask,
    }),
    [
      tasks,
      loading,
      error,
      activeFolderId,
      refreshTasks,
      createTask,
      updateTask,
      deleteTask,
    ]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
