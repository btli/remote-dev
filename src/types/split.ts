/**
 * Split terminal types for terminal pane management
 */

export type SplitDirection = "horizontal" | "vertical";

export interface SplitGroup {
  id: string;
  userId: string;
  direction: SplitDirection;
  createdAt: Date;
  updatedAt: Date;
}

export interface SplitSession {
  sessionId: string;
  splitOrder: number;
  splitSize: number;
}

export interface SplitGroupWithSessions extends SplitGroup {
  sessions: SplitSession[];
}

export interface CreateSplitInput {
  sourceSessionId: string;
  direction: SplitDirection;
  newSessionName?: string;
}

export interface AddToSplitInput {
  splitGroupId: string;
  sessionId?: string;
  newSessionName?: string;
}

export interface UpdateSplitLayoutInput {
  splitGroupId: string;
  layout: Array<{
    sessionId: string;
    size: number;
  }>;
}

// State management types
export type SplitAction =
  | { type: "LOAD_SPLITS"; splits: SplitGroupWithSessions[] }
  | { type: "CREATE_SPLIT"; split: SplitGroupWithSessions }
  | { type: "UPDATE_SPLIT"; splitId: string; updates: Partial<SplitGroup> }
  | { type: "UPDATE_LAYOUT"; splitId: string; layout: SplitSession[] }
  | { type: "DELETE_SPLIT"; splitId: string }
  | { type: "SET_ACTIVE_PANE"; splitId: string; sessionId: string };

export interface SplitState {
  splits: SplitGroupWithSessions[];
  activePanes: Record<string, string>; // splitGroupId -> active sessionId in that group
  loading: boolean;
  error: Error | null;
}
