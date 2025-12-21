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
