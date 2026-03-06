"use client";

import { useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoiceCapture } from "@/hooks/useVoiceCapture";
import { cn } from "@/lib/utils";

interface VoiceMicButtonProps {
  getWebSocket: () => WebSocket | null;
  className?: string;
}

/**
 * Mic button for voice input to Claude Code agent sessions.
 *
 * Tap to start/stop recording. Browser audio is captured and relayed to the
 * terminal server via WebSocket binary frames. The server handles triggering
 * Claude Code's voice listening mode (SPACE hold simulation) and piping audio
 * through a FIFO to the sox shim.
 */
export function VoiceMicButton({ getWebSocket, className }: VoiceMicButtonProps) {
  const { state, error, start, stop } = useVoiceCapture({ getWebSocket });

  const handleClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (state === "recording") {
        stop();
      } else if (state === "idle" || state === "error") {
        start();
      }
    },
    [state, start, stop]
  );

  const isRecording = state === "recording";
  const isError = state === "error";

  return (
    <button
      onClick={handleClick}
      onTouchEnd={handleClick}
      className={cn(
        "p-1.5 rounded-full transition-colors shadow-md backdrop-blur-sm",
        isRecording
          ? "text-red-400 bg-red-500/30 animate-pulse ring-1 ring-red-500/50"
          : isError
            ? "text-red-400 bg-background/80 opacity-60 cursor-not-allowed"
            : "text-muted-foreground bg-background/80 hover:text-foreground hover:bg-accent/90 ring-1 ring-border/50",
        className
      )}
      title={
        isError
          ? `Voice error: ${error}`
          : isRecording
            ? "Tap to stop recording"
            : "Tap to speak (requires /voice enabled in Claude Code)"
      }
    >
      {isError ? (
        <MicOff className="w-3.5 h-3.5" />
      ) : (
        <Mic className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
