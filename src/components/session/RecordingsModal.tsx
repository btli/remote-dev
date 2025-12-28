"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRecordingContext } from "@/contexts/RecordingContext";
import { RecordingPlayer } from "@/components/terminal/RecordingPlayer";
import { formatDuration } from "@/types/recording";
import { Video, Play, Trash2, Calendar, Clock } from "lucide-react";
import type { ParsedRecording } from "@/types/recording";

interface RecordingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordingsModal({ open, onOpenChange }: RecordingsModalProps) {
  const { recordings, loading, deleteRecording, getRecording } = useRecordingContext();
  const [playingRecording, setPlayingRecording] = useState<ParsedRecording | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handlePlay = useCallback(
    async (recordingId: string) => {
      setLoadingId(recordingId);
      try {
        const recording = await getRecording(recordingId);
        if (recording) {
          setPlayingRecording(recording);
        }
      } catch (error) {
        console.error("Failed to load recording:", error);
      } finally {
        setLoadingId(null);
      }
    },
    [getRecording]
  );

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

  const handleClosePlayer = useCallback(() => {
    setPlayingRecording(null);
  }, []);

  // Format date
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            Session Recordings
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            View and playback your recorded terminal sessions
          </DialogDescription>
        </DialogHeader>

        {/* Player or List */}
        {playingRecording ? (
          <div className="h-[500px]">
            <RecordingPlayer recording={playingRecording} onClose={handleClosePlayer} />
          </div>
        ) : (
          <div className="mt-4 max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading recordings...</div>
              </div>
            ) : recordings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Video className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-2">No recordings yet</p>
                <p className="text-sm text-muted-foreground/70">
                  Start recording a session to capture terminal output
                </p>
              </div>
            ) : (
              <div className="space-y-2">
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
                          {formatDate(recording.createdAt)} at {formatTime(recording.createdAt)}
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
                        disabled={loadingId === recording.id}
                        className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-accent"
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(recording.id)}
                        className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
