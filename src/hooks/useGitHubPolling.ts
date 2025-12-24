"use client";

/**
 * useGitHubPolling - Hook for managing GitHub stats background polling
 * Always polls regardless of visibility (as per user requirement)
 */

import { useEffect, useRef, useCallback, useState } from "react";

interface UseGitHubPollingOptions {
  enabled: boolean;
  intervalMinutes: number;
  onRefresh: () => Promise<void>;
  onVisibilityChange?: (isVisible: boolean) => void;
}

export function useGitHubPolling({
  enabled,
  intervalMinutes,
  onRefresh,
  onVisibilityChange,
}: UseGitHubPollingOptions) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Handle visibility changes for notification purposes
  useEffect(() => {
    if (!onVisibilityChange) return;

    const handleVisibilityChange = () => {
      onVisibilityChange(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onVisibilityChange]);

  // Set up polling interval
  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    if (!enabled || intervalMinutes <= 0) {
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    intervalRef.current = setInterval(async () => {
      setLastRefresh(new Date());
      await onRefresh();
    }, intervalMs);
  }, [enabled, intervalMinutes, onRefresh]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Manual refresh that resets the timer
  const manualRefresh = useCallback(async () => {
    // Reset timer on manual refresh
    stopPolling();
    setLastRefresh(new Date());
    await onRefresh();
    startPolling();
  }, [onRefresh, startPolling, stopPolling]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enabled, startPolling, stopPolling]);

  return {
    manualRefresh,
    stopPolling,
    startPolling,
    lastRefresh,
  };
}

/**
 * Calculate time until next refresh
 */
export function useTimeUntilRefresh(
  lastRefresh: Date | null,
  intervalMinutes: number
): {
  minutes: number;
  seconds: number;
  isOverdue: boolean;
} {
  if (!lastRefresh) {
    return { minutes: 0, seconds: 0, isOverdue: true };
  }

  const now = new Date();
  const nextRefresh = new Date(
    lastRefresh.getTime() + intervalMinutes * 60 * 1000
  );
  const diff = nextRefresh.getTime() - now.getTime();

  if (diff <= 0) {
    return { minutes: 0, seconds: 0, isOverdue: true };
  }

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return { minutes, seconds, isOverdue: false };
}
