"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type {
  SessionRecording,
  ParsedRecording,
  CreateRecordingInput,
  RecordingData,
} from "@/types/recording";

interface RecordingContextValue {
  recordings: SessionRecording[];
  loading: boolean;

  // CRUD operations
  fetchRecordings: () => Promise<void>;
  createRecording: (input: CreateRecordingInput) => Promise<SessionRecording>;
  deleteRecording: (recordingId: string) => Promise<void>;
  getRecording: (recordingId: string) => Promise<ParsedRecording | null>;

  // Active recording state (for the currently recording session)
  activeRecording: {
    sessionId: string;
    isRecording: boolean;
    startTime: number;
  } | null;
  startActiveRecording: (sessionId: string) => void;
  stopActiveRecording: () => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRecording, setActiveRecording] = useState<{
    sessionId: string;
    isRecording: boolean;
    startTime: number;
  } | null>(null);

  const fetchRecordings = useCallback(async () => {
    try {
      const response = await fetch("/api/recordings");
      if (response.ok) {
        const data = await response.json();
        setRecordings(data);
      }
    } catch (error) {
      console.error("Failed to fetch recordings:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  const createRecording = useCallback(
    async (input: CreateRecordingInput): Promise<SessionRecording> => {
      const response = await fetch("/api/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error("Failed to create recording");
      }

      const recording = await response.json();
      setRecordings((prev) => [recording, ...prev]);
      return recording;
    },
    []
  );

  const deleteRecording = useCallback(async (recordingId: string) => {
    const response = await fetch(`/api/recordings/${recordingId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete recording");
    }

    setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
  }, []);

  const getRecording = useCallback(
    async (recordingId: string): Promise<ParsedRecording | null> => {
      const response = await fetch(`/api/recordings/${recordingId}?parsed=true`);
      if (!response.ok) {
        return null;
      }
      return response.json();
    },
    []
  );

  const startActiveRecording = useCallback((sessionId: string) => {
    setActiveRecording({
      sessionId,
      isRecording: true,
      startTime: Date.now(),
    });
  }, []);

  const stopActiveRecording = useCallback(() => {
    setActiveRecording(null);
  }, []);

  return (
    <RecordingContext.Provider
      value={{
        recordings,
        loading,
        fetchRecordings,
        createRecording,
        deleteRecording,
        getRecording,
        activeRecording,
        startActiveRecording,
        stopActiveRecording,
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext() {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error("useRecordingContext must be used within a RecordingProvider");
  }
  return context;
}
