import { useCallback, useRef, useState } from "react";
import type { RecordingEvent, RecordingData, RecordingState } from "@/types/recording";

interface UseRecordingOptions {
  sessionId?: string;
  terminalCols?: number;
  terminalRows?: number;
  onSave?: (data: {
    sessionId?: string;
    name: string;
    duration: number;
    terminalCols: number;
    terminalRows: number;
    data: RecordingData;
  }) => Promise<void>;
}

export function useRecording({
  sessionId,
  terminalCols = 80,
  terminalRows = 24,
  onSave,
}: UseRecordingOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const eventsRef = useRef<RecordingEvent[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const colsRef = useRef(terminalCols);
  const rowsRef = useRef(terminalRows);

  // Update terminal dimensions
  const updateDimensions = useCallback((cols: number, rows: number) => {
    colsRef.current = cols;
    rowsRef.current = rows;
  }, []);

  // Start recording
  const startRecording = useCallback(() => {
    if (isRecording) return;

    startTimeRef.current = Date.now();
    eventsRef.current = [];
    setDuration(0);
    setIsRecording(true);

    // Update duration every 100ms
    intervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setDuration(Date.now() - startTimeRef.current);
      }
    }, 100);
  }, [isRecording]);

  // Stop recording and optionally save
  const stopRecording = useCallback(
    async (name?: string): Promise<RecordingData | null> => {
      if (!isRecording || !startTimeRef.current) return null;

      // Clear interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const finalDuration = Date.now() - startTimeRef.current;
      const data: RecordingData = { events: eventsRef.current };

      setIsRecording(false);
      setDuration(0);

      // Save if callback provided and name given
      if (onSave && name) {
        await onSave({
          sessionId,
          name,
          duration: finalDuration,
          terminalCols: colsRef.current,
          terminalRows: rowsRef.current,
          data,
        });
      }

      // Reset
      startTimeRef.current = null;
      eventsRef.current = [];

      return data;
    },
    [isRecording, onSave, sessionId]
  );

  // Cancel recording without saving
  const cancelRecording = useCallback(() => {
    if (!isRecording) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRecording(false);
    setDuration(0);
    startTimeRef.current = null;
    eventsRef.current = [];
  }, [isRecording]);

  // Record a piece of terminal output
  const recordOutput = useCallback(
    (data: string) => {
      if (!isRecording || !startTimeRef.current) return;

      const event: RecordingEvent = {
        t: Date.now() - startTimeRef.current,
        d: data,
      };
      eventsRef.current.push(event);
    },
    [isRecording]
  );

  // Get current recording state
  const getState = useCallback((): RecordingState => {
    return {
      isRecording,
      startTime: startTimeRef.current,
      events: eventsRef.current,
      terminalCols: colsRef.current,
      terminalRows: rowsRef.current,
    };
  }, [isRecording]);

  return {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    recordOutput,
    updateDimensions,
    getState,
  };
}
