"use client";

/**
 * useTaskExecution - Hook for task submission and monitoring.
 *
 * Provides:
 * - Submit natural language tasks
 * - Plan and execute with confirmation
 * - Monitor task progress
 * - Cancel running tasks
 */

import { useState, useCallback } from "react";
import { useTaskContext, type Task, type ExecutionPlan } from "@/contexts/TaskContext";

interface UseTaskExecutionOptions {
  onTaskSubmitted?: (task: Task) => void;
  onTaskCompleted?: (task: Task) => void;
  onTaskFailed?: (task: Task, error: Error) => void;
  autoExecute?: boolean;
}

interface UseTaskExecutionReturn {
  submitting: boolean;
  planning: boolean;
  executing: boolean;
  currentTask: Task | null;
  currentPlan: ExecutionPlan | null;
  error: string | null;
  submit: (input: string, options?: { folderId?: string; beadsIssueId?: string }) => Promise<Task>;
  plan: (taskId: string, folderPath: string) => Promise<ExecutionPlan>;
  execute: (taskId: string, plan: ExecutionPlan) => Promise<Task>;
  cancel: (taskId: string) => Promise<void>;
  clearError: () => void;
}

export function useTaskExecution(
  options: UseTaskExecutionOptions = {}
): UseTaskExecutionReturn {
  const { submitTask, planTask, executeTask, cancelTask, state } = useTaskContext();

  const [submitting, setSubmitting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (
      input: string,
      submitOptions?: { folderId?: string; beadsIssueId?: string }
    ): Promise<Task> => {
      setSubmitting(true);
      setError(null);

      try {
        const task = await submitTask(input, submitOptions);
        setCurrentTask(task);
        options.onTaskSubmitted?.(task);

        // If autoExecute is enabled, plan and execute immediately
        if (options.autoExecute && submitOptions?.folderId) {
          const plan = await planTask(task.id, submitOptions.folderId);
          await executeTask(task.id, plan);
        }

        return task;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to submit task";
        setError(errorMessage);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [submitTask, planTask, executeTask, options]
  );

  const plan = useCallback(
    async (taskId: string, folderPath: string): Promise<ExecutionPlan> => {
      setPlanning(true);
      setError(null);

      try {
        const executionPlan = await planTask(taskId, folderPath);
        return executionPlan;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to plan task";
        setError(errorMessage);
        throw e;
      } finally {
        setPlanning(false);
      }
    },
    [planTask]
  );

  const execute = useCallback(
    async (taskId: string, executionPlan: ExecutionPlan): Promise<Task> => {
      setExecuting(true);
      setError(null);

      try {
        const task = await executeTask(taskId, executionPlan);
        setCurrentTask(task);

        if (task.status === "completed") {
          options.onTaskCompleted?.(task);
        } else if (task.status === "failed" && task.error) {
          options.onTaskFailed?.(task, new Error(task.error.message));
        }

        return task;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to execute task";
        setError(errorMessage);
        throw e;
      } finally {
        setExecuting(false);
      }
    },
    [executeTask, options]
  );

  const cancel = useCallback(
    async (taskId: string): Promise<void> => {
      setError(null);

      try {
        await cancelTask(taskId);
        setCurrentTask(null);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to cancel task";
        setError(errorMessage);
        throw e;
      }
    },
    [cancelTask]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    submitting,
    planning,
    executing,
    currentTask,
    currentPlan: state.currentPlan,
    error,
    submit,
    plan,
    execute,
    cancel,
    clearError,
  };
}
