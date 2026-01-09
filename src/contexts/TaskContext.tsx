"use client";

/**
 * TaskContext - React context for task state management.
 *
 * Provides:
 * - Task list and current task state
 * - Task submission and cancellation
 * - Real-time status updates
 * - Optimistic updates for better UX
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { AgentProviderType } from "@/types/session";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "queued"
  | "planning"
  | "executing"
  | "monitoring"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskType =
  | "feature"
  | "bug"
  | "refactor"
  | "test"
  | "docs"
  | "query"
  | "unknown";

export interface Task {
  id: string;
  orchestratorId: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  confidence: number;
  estimatedDuration: number | null;
  assignedAgent: AgentProviderType | null;
  delegationId: string | null;
  folderId: string | null;
  beadsIssueId: string | null;
  result: {
    success: boolean;
    summary: string;
    filesModified: string[];
    learnings: string[];
  } | null;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ExecutionPlan {
  taskId: string;
  selectedAgent: AgentProviderType;
  isolationStrategy: "worktree" | "branch" | "none";
  worktreePath?: string;
  branchName?: string;
  contextToInject: string;
  estimatedTokens: number;
  reasoning: string;
}

interface TaskState {
  tasks: Task[];
  currentPlan: ExecutionPlan | null;
  loading: boolean;
  error: string | null;
  selectedTaskId: string | null;
}

type TaskAction =
  | { type: "SET_TASKS"; tasks: Task[] }
  | { type: "ADD_TASK"; task: Task }
  | { type: "UPDATE_TASK"; task: Task }
  | { type: "REMOVE_TASK"; taskId: string }
  | { type: "SET_PLAN"; plan: ExecutionPlan | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SELECT_TASK"; taskId: string | null };

interface TaskContextValue {
  state: TaskState;
  submitTask: (input: string, options?: { folderId?: string; beadsIssueId?: string }) => Promise<Task>;
  planTask: (taskId: string, folderPath: string) => Promise<ExecutionPlan>;
  executeTask: (taskId: string, plan: ExecutionPlan) => Promise<Task>;
  cancelTask: (taskId: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const TaskContext = createContext<TaskContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

const initialState: TaskState = {
  tasks: [],
  currentPlan: null,
  loading: false,
  error: null,
  selectedTaskId: null,
};

function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case "SET_TASKS":
      return { ...state, tasks: action.tasks };

    case "ADD_TASK":
      return { ...state, tasks: [action.task, ...state.tasks] };

    case "UPDATE_TASK":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.task.id ? action.task : t
        ),
      };

    case "REMOVE_TASK":
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.taskId),
      };

    case "SET_PLAN":
      return { ...state, currentPlan: action.plan };

    case "SET_LOADING":
      return { ...state, loading: action.loading };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "SELECT_TASK":
      return { ...state, selectedTaskId: action.taskId };

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface TaskProviderProps {
  children: ReactNode;
  orchestratorId: string;
}

export function TaskProvider({ children, orchestratorId }: TaskProviderProps) {
  const [state, dispatch] = useReducer(taskReducer, initialState);

  // Refresh task list
  const refreshTasks = useCallback(async () => {
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const response = await fetch(`/api/orchestrators/${orchestratorId}/tasks`);
      if (!response.ok) {
        throw new Error("Failed to fetch tasks");
      }

      const data = await response.json();
      const tasks = data.tasks.map(parseTask);
      dispatch({ type: "SET_TASKS", tasks });
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [orchestratorId]);

  // Fetch tasks on mount and orchestrator change
  useEffect(() => {
    if (orchestratorId) {
      refreshTasks();
    }
  }, [orchestratorId, refreshTasks]);

  // Submit a new task
  const submitTask = useCallback(
    async (
      input: string,
      options?: { folderId?: string; beadsIssueId?: string }
    ): Promise<Task> => {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });

      try {
        const response = await fetch(`/api/orchestrators/${orchestratorId}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input,
            folderId: options?.folderId,
            beadsIssueId: options?.beadsIssueId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to submit task");
        }

        const data = await response.json();
        const task = parseTask(data.task);

        dispatch({ type: "ADD_TASK", task });
        return task;
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [orchestratorId]
  );

  // Plan task execution
  const planTask = useCallback(
    async (taskId: string, folderPath: string): Promise<ExecutionPlan> => {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });

      try {
        const response = await fetch(
          `/api/orchestrators/${orchestratorId}/tasks/${taskId}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "plan",
              folderPath,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to plan task");
        }

        const data = await response.json();
        const plan = data.plan as ExecutionPlan;

        dispatch({ type: "SET_PLAN", plan });
        dispatch({ type: "UPDATE_TASK", task: parseTask(data.task) });

        return plan;
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [orchestratorId]
  );

  // Execute a planned task
  const executeTask = useCallback(
    async (taskId: string, plan: ExecutionPlan): Promise<Task> => {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });

      try {
        const response = await fetch(
          `/api/orchestrators/${orchestratorId}/tasks/${taskId}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "execute",
              plan,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to execute task");
        }

        const data = await response.json();
        const task = parseTask(data.task);

        dispatch({ type: "UPDATE_TASK", task });
        dispatch({ type: "SET_PLAN", plan: null });

        return task;
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [orchestratorId]
  );

  // Cancel a task
  const cancelTask = useCallback(
    async (taskId: string): Promise<void> => {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });

      try {
        const response = await fetch(
          `/api/orchestrators/${orchestratorId}/tasks/${taskId}`,
          {
            method: "DELETE",
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to cancel task");
        }

        const data = await response.json();
        dispatch({ type: "UPDATE_TASK", task: parseTask(data.task) });
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [orchestratorId]
  );

  // Select a task
  const selectTask = useCallback((taskId: string | null) => {
    dispatch({ type: "SELECT_TASK", taskId });
  }, []);

  const value: TaskContextValue = {
    state,
    submitTask,
    planTask,
    executeTask,
    cancelTask,
    refreshTasks,
    selectTask,
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useTaskContext(): TaskContextValue {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTaskContext must be used within a TaskProvider");
  }
  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseTask(data: Record<string, unknown>): Task {
  return {
    id: data.id as string,
    orchestratorId: data.orchestratorId as string,
    description: data.description as string,
    type: data.type as TaskType,
    status: data.status as TaskStatus,
    confidence: data.confidence as number,
    estimatedDuration: data.estimatedDuration as number | null,
    assignedAgent: data.assignedAgent as AgentProviderType | null,
    delegationId: data.delegationId as string | null,
    folderId: data.folderId as string | null,
    beadsIssueId: data.beadsIssueId as string | null,
    result: data.result as Task["result"],
    error: data.error as Task["error"],
    createdAt: new Date(data.createdAt as string),
    updatedAt: new Date(data.updatedAt as string),
    completedAt: data.completedAt ? new Date(data.completedAt as string) : null,
  };
}
