/**
 * useLoopScheduler — Interval-based prompt scheduler for monitoring loops
 *
 * Fires a configured prompt to the agent via WebSocket at regular intervals.
 * Skips firing when the agent is already running to avoid prompt queuing.
 * Uses the same WebSocket input channel as keyboard input.
 */

import { useCallback, useEffect, useRef } from "react";

interface UseLoopSchedulerOptions {
  /** Whether the scheduler is active */
  enabled: boolean;
  /** Interval in seconds between prompt fires */
  intervalSeconds: number;
  /** The prompt text to send */
  prompt: string;
  /** Current agent activity status */
  agentStatus: string;
  /** Maximum number of iterations (null = unlimited) */
  maxIterations?: number | null;
  /** Current iteration count */
  currentIteration?: number;
  /** Send a message to the agent via WebSocket */
  sendMessage: (text: string) => void;
  /** Called when a prompt is fired */
  onPromptFired?: (iterationNumber: number) => void;
}

/**
 * Hook that schedules recurring prompts for monitoring loop sessions
 *
 * Usage:
 *   useLoopScheduler({
 *     enabled: loopConfig.loopType === "monitoring",
 *     intervalSeconds: loopConfig.intervalSeconds ?? 300,
 *     prompt: loopConfig.promptTemplate ?? "",
 *     agentStatus: activityStatus,
 *     sendMessage: (text) => wsRef.current?.send(JSON.stringify({ type: "input", data: text + "\n" })),
 *     onPromptFired: (n) => console.log(`Iteration ${n} fired`),
 *   });
 */
export function useLoopScheduler({
  enabled,
  intervalSeconds,
  prompt,
  agentStatus,
  maxIterations = null,
  currentIteration = 0,
  sendMessage,
  onPromptFired,
}: UseLoopSchedulerOptions): void {
  const iterationRef = useRef(currentIteration);
  const promptRef = useRef(prompt);
  const agentStatusRef = useRef(agentStatus);

  // Keep refs in sync without re-running the interval effect
  useEffect(() => {
    iterationRef.current = currentIteration;
    promptRef.current = prompt;
    agentStatusRef.current = agentStatus;
  }, [currentIteration, prompt, agentStatus]);

  const firePrompt = useCallback(() => {
    // Skip if agent is busy (running or compacting)
    const status = agentStatusRef.current;
    if (status === "running" || status === "compacting") {
      return;
    }

    // Check iteration limit
    if (maxIterations !== null && iterationRef.current >= maxIterations) {
      return;
    }

    const currentPrompt = promptRef.current;
    if (!currentPrompt.trim()) return;

    const nextIteration = iterationRef.current + 1;
    iterationRef.current = nextIteration;

    sendMessage(currentPrompt);
    onPromptFired?.(nextIteration);
  }, [sendMessage, onPromptFired, maxIterations]);

  useEffect(() => {
    if (!enabled || intervalSeconds <= 0 || !prompt.trim()) return;

    const intervalMs = intervalSeconds * 1000;
    const timer = setInterval(firePrompt, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalSeconds, prompt, firePrompt]);
}
