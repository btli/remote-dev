/**
 * Recording event - a single piece of terminal output with timestamp
 */
export interface RecordingEvent {
  /** Time offset from recording start in milliseconds */
  t: number;
  /** Terminal output data */
  d: string;
}

/**
 * Recording data structure stored as JSON
 */
export interface RecordingData {
  events: RecordingEvent[];
}

/**
 * Session recording metadata (from database)
 */
export interface SessionRecording {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  description: string | null;
  duration: number;
  terminalCols: number;
  terminalRows: number;
  data: string; // JSON string of RecordingData
  createdAt: Date;
}

/**
 * Parsed recording with data object instead of JSON string
 */
export interface ParsedRecording extends Omit<SessionRecording, "data"> {
  data: RecordingData;
}

/**
 * Input for creating a new recording
 */
export interface CreateRecordingInput {
  sessionId?: string;
  name: string;
  description?: string;
  duration: number;
  terminalCols: number;
  terminalRows: number;
  data: RecordingData;
}

/**
 * Input for updating a recording
 */
export interface UpdateRecordingInput {
  name?: string;
  description?: string;
}

/**
 * Recording state for the UI
 */
export interface RecordingState {
  isRecording: boolean;
  startTime: number | null;
  events: RecordingEvent[];
  terminalCols: number;
  terminalRows: number;
}

/**
 * Format duration as human-readable string (e.g., "2:34" or "1:02:34")
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
