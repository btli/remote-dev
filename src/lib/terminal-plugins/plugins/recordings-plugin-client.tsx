/**
 * RecordingsPlugin (client half) — React rendering for the recordings
 * browser terminal type.
 *
 * Two modes, switched by `typeMetadata.selectedRecordingId`:
 *  - **List view** (`selectedRecordingId == null`): full-panel recordings
 *    list with play/delete actions. Replaces the list body of the legacy
 *    `RecordingsModal` (which D1 will delete once C3 wires the entry point).
 *  - **Playback view** (`selectedRecordingId` set): the `RecordingPlayer`
 *    occupies the entire workspace panel so xterm finally gets real-world
 *    dimensions instead of the ~500px dialog cap.
 *
 * The pane owns no xterm instance itself. `RecordingPlayer` internally
 * initializes and disposes its own xterm in the same `useEffect` that
 * mounts it to the DOM — its cleanup calls `xtermRef.current?.dispose()`
 * and nulls the refs. `SessionManager` currently remounts the plugin
 * component whenever the session id changes (`key={session.id}`), so the
 * xterm instance survives re-renders caused by metadata or prop updates
 * within the same session. Switching the selected recording swaps the
 * inner view (list <-> player) which triggers RecordingPlayer's cleanup
 * and a fresh xterm is created on the next mount. When tabs are torn down
 * — back button, session close, or session id change — the cleanup runs
 * cleanly. Verified by inspecting the cleanup in `RecordingPlayer.tsx`
 * lines 135-143.
 *
 * @see ./recordings-plugin-server.ts for lifecycle.
 */

import { useState, useCallback, useEffect } from "react";
import { Film, Play, Trash2, Calendar, Clock, ArrowLeft } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { ParsedRecording } from "@/types/recording";
import { formatDuration } from "@/types/recording";
import { Button } from "@/components/ui/button";
import { useRecordingContext } from "@/contexts/RecordingContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { RecordingPlayer } from "@/components/terminal/RecordingPlayer";
import type { RecordingsSessionMetadata } from "./recordings-plugin-server";

// Re-export the metadata interface so client code can import it without
// crossing the server file boundary.
export type { RecordingsSessionMetadata } from "./recordings-plugin-server";

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface RecordingsListProps {
  onSelect: (recordingId: string) => void;
}

function RecordingsList({ onSelect }: RecordingsListProps) {
  const { recordings, loading, deleteRecording } = useRecordingContext();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (recordingId: string) => {
      if (!confirm("Are you sure you want to delete this recording?")) return;
      try {
        await deleteRecording(recordingId);
      } catch (error) {
        console.error("Failed to delete recording:", error);
      }
    },
    [deleteRecording]
  );

  const handlePlay = useCallback(
    (recordingId: string) => {
      setPendingId(recordingId);
      onSelect(recordingId);
    },
    [onSelect]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading recordings...</div>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Film className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground mb-2">No recordings yet</p>
        <p className="text-sm text-muted-foreground/70">
          Start recording a session to capture terminal output
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      {recordings.map((recording) => (
        <div
          key={recording.id}
          className="flex items-center justify-between p-3 rounded-lg bg-card/50 hover:bg-card/80 transition-colors group"
        >
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground truncate">
              {recording.name}
            </h4>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(recording.duration)}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(recording.createdAt)} at{" "}
                {formatTime(recording.createdAt)}
              </span>
              <span className="text-muted-foreground/70">
                {recording.terminalCols}x{recording.terminalRows}
              </span>
            </div>
            {recording.description && (
              <p className="mt-1 text-xs text-muted-foreground/70 truncate">
                {recording.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 ml-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handlePlay(recording.id)}
              disabled={pendingId === recording.id}
              className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label={`Play ${recording.name}`}
            >
              <Play className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(recording.id)}
              className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Delete ${recording.name}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface RecordingsPlayerViewProps {
  recordingId: string;
  fontSize: number;
  fontFamily: string;
  onBack: () => void;
}

function RecordingsPlayerView({
  recordingId,
  fontSize,
  fontFamily,
  onBack,
}: RecordingsPlayerViewProps) {
  const { getRecording } = useRecordingContext();
  const [recording, setRecording] = useState<ParsedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the recording when the id changes. We intentionally re-fetch on
  // every mount so stale data from a previous session of the same tab never
  // leaks in.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await getRecording(recordingId);
      if (!parsed) {
        setError("Recording not found");
      } else {
        setRecording(parsed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recording");
    } finally {
      setLoading(false);
    }
  }, [recordingId, getRecording]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-popover/30 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Back to recordings list"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to recordings
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading recording...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-destructive">
            {error}
          </div>
        ) : recording ? (
          <RecordingPlayer
            recording={recording}
            fontSize={fontSize}
            fontFamily={fontFamily}
            onClose={onBack}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Recordings tab content. Dispatches between the list view and the
 * playback view based on `session.typeMetadata.selectedRecordingId`.
 */
function RecordingsTabContent({
  session,
  fontSize,
  fontFamily,
}: TerminalTypeClientComponentProps) {
  const { updateSession } = useSessionContext();
  const metadata = session.typeMetadata as RecordingsSessionMetadata | null;
  const selectedRecordingId = metadata?.selectedRecordingId ?? null;

  const selectRecording = useCallback(
    (recordingId: string) => {
      // Persist via typeMetadataPatch — the only shape the PATCH
      // /api/sessions/:id route honors (see F1 finding).
      void updateSession(session.id, {
        typeMetadataPatch: { selectedRecordingId: recordingId },
      });
    },
    [session.id, updateSession]
  );

  const clearRecording = useCallback(() => {
    void updateSession(session.id, {
      typeMetadataPatch: { selectedRecordingId: null },
    });
  }, [session.id, updateSession]);

  if (selectedRecordingId) {
    return (
      <RecordingsPlayerView
        key={selectedRecordingId}
        recordingId={selectedRecordingId}
        fontSize={fontSize}
        fontFamily={fontFamily}
        onBack={clearRecording}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-popover/30 shrink-0">
        <Film className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          Session Recordings
        </span>
        <span className="text-xs text-muted-foreground">
          View and play back your recorded terminal sessions
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <RecordingsList onSelect={selectRecording} />
      </div>
    </div>
  );
}

/** Default recordings client plugin instance */
export const RecordingsClientPlugin: TerminalTypeClientPlugin = {
  type: "recordings",
  displayName: "Recordings",
  description: "Session recordings browser",
  icon: Film,
  priority: 70,
  builtIn: true,
  component: RecordingsTabContent,
  deriveTitle: (session) => {
    const md = session.typeMetadata as RecordingsSessionMetadata | null;
    return md?.selectedRecordingId ? "Recording playback" : "Recordings";
  },
};
