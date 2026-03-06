"use client";

import { useCallback, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoiceCapture } from "@/hooks/useVoiceCapture";
import { cn } from "@/lib/utils";

interface VoiceMicButtonProps {
  getWebSocket: () => WebSocket | null;
  className?: string;
}

export function VoiceMicButton({ getWebSocket, className }: VoiceMicButtonProps) {
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { state, error, start, stop } = useVoiceCapture({
    getWebSocket,
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      // Debounce: require 200ms hold
      holdTimeoutRef.current = setTimeout(() => {
        start();
      }, 200);
    },
    [start]
  );

  const handlePointerUp = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (state === "recording") {
      stop();
    }
  }, [state, stop]);

  const isRecording = state === "recording";
  const isError = state === "error";

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
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
            ? "Release to stop recording"
            : "Hold to speak (requires /voice enabled in Claude Code)"
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
