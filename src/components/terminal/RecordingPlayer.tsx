"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import { getTerminalTheme, getThemeBackground } from "@/lib/terminal-themes";
import { Play, Pause, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ParsedRecording } from "@/types/recording";
import { formatDuration } from "@/types/recording";

interface RecordingPlayerProps {
  recording: ParsedRecording;
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  onClose?: () => void;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export function RecordingPlayer({
  recording,
  theme = "tokyo-night",
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
  onClose,
}: RecordingPlayerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermType | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number>(0);
  const eventIndexRef = useRef<number>(0);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let terminal: XTermType;
    let fitAddon: FitAddonType;
    let mounted = true;

    async function initTerminal() {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      await import("@xterm/xterm/css/xterm.css");

      if (!mounted || !terminalRef.current) return;

      terminal = new XTerm({
        cursorBlink: false,
        fontSize,
        fontFamily,
        theme: getTerminalTheme(theme),
        cols: recording.terminalCols,
        rows: recording.terminalRows,
        disableStdin: true, // Read-only for playback
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);

      await document.fonts.ready;
      fitAddon.fit();

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
    }

    initTerminal();

    return () => {
      mounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [recording, fontSize, fontFamily, theme]);

  // Update terminal options when preferences change
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    terminal.options.theme = getTerminalTheme(theme);
    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;
    fitAddonRef.current?.fit();
  }, [theme, fontSize, fontFamily]);

  // Render events up to a given time
  const renderToTime = useCallback(
    (targetTime: number) => {
      const terminal = xtermRef.current;
      if (!terminal) return;

      const events = recording.data.events;

      // If seeking backwards, reset and replay
      if (targetTime < currentTime) {
        terminal.reset();
        eventIndexRef.current = 0;
      }

      // Write all events up to targetTime
      while (
        eventIndexRef.current < events.length &&
        events[eventIndexRef.current].t <= targetTime
      ) {
        terminal.write(events[eventIndexRef.current].d);
        eventIndexRef.current++;
      }

      setCurrentTime(targetTime);
    },
    [recording.data.events, currentTime]
  );

  // Playback loop
  const tick = useCallback(() => {
    if (!startTimeRef.current) return;

    const elapsed = (Date.now() - startTimeRef.current) * speed;
    const newTime = pausedAtRef.current + elapsed;

    if (newTime >= recording.duration) {
      // Playback complete
      renderToTime(recording.duration);
      setIsPlaying(false);
      startTimeRef.current = null;
      return;
    }

    renderToTime(newTime);
    animationFrameRef.current = requestAnimationFrame(tick);
  }, [speed, recording.duration, renderToTime]);

  // Start/stop playback
  useEffect(() => {
    if (isPlaying) {
      startTimeRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(tick);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      pausedAtRef.current = currentTime;
      startTimeRef.current = null;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, tick, currentTime]);

  const handlePlayPause = useCallback(() => {
    if (currentTime >= recording.duration) {
      // Restart from beginning
      handleRestart();
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, currentTime, recording.duration]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    pausedAtRef.current = 0;
    eventIndexRef.current = 0;
    xtermRef.current?.reset();
    setCurrentTime(0);
  }, []);

  const handleSeek = useCallback(
    (value: number[]) => {
      const newTime = value[0];
      pausedAtRef.current = newTime;
      renderToTime(newTime);
    },
    [renderToTime]
  );

  const handleSpeedChange = useCallback(() => {
    const speeds: PlaybackSpeed[] = [0.5, 1, 2, 4];
    const currentIndex = speeds.indexOf(speed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setSpeed(speeds[nextIndex]);
  }, [speed]);

  return (
    <div className="flex flex-col h-full bg-slate-950 rounded-xl overflow-hidden border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{recording.name}</span>
          <span className="text-xs text-slate-400">
            {formatDuration(recording.duration)}
          </span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={{ backgroundColor: getThemeBackground(theme) }}
      />

      {/* Controls */}
      <div className="px-4 py-3 bg-slate-900/50 border-t border-white/5">
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePlayPause}
            className="w-8 h-8 text-white hover:bg-white/10"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </Button>

          {/* Restart */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRestart}
            className="w-8 h-8 text-slate-400 hover:text-white hover:bg-white/10"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>

          {/* Current time */}
          <span className="text-xs text-slate-400 font-mono w-16">
            {formatDuration(currentTime)}
          </span>

          {/* Timeline slider */}
          <div className="flex-1">
            <Slider
              value={[currentTime]}
              max={recording.duration}
              step={100}
              onValueChange={handleSeek}
              className="cursor-pointer"
            />
          </div>

          {/* Duration */}
          <span className="text-xs text-slate-400 font-mono w-16 text-right">
            {formatDuration(recording.duration)}
          </span>

          {/* Speed */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSpeedChange}
            className="text-xs text-slate-400 hover:text-white hover:bg-white/10 px-2"
          >
            {speed}x
          </Button>
        </div>
      </div>
    </div>
  );
}
