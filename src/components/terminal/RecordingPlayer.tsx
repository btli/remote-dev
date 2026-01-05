"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import { Play, Pause, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ParsedRecording } from "@/types/recording";
import { formatDuration } from "@/types/recording";
import { useTerminalTheme } from "@/contexts/AppearanceContext";

interface RecordingPlayerProps {
  recording: ParsedRecording;
  fontSize?: number;
  fontFamily?: string;
  onClose?: () => void;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export function RecordingPlayer({
  recording,
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
  const lastRenderedTimeRef = useRef<number>(0);

  // Terminal theme from appearance context
  const terminalTheme = useTerminalTheme();
  // Use ref to avoid recreating terminal on theme changes
  const terminalThemeRef = useRef(terminalTheme);

  // Keep theme ref in sync for pending terminal initialization
  useEffect(() => {
    terminalThemeRef.current = terminalTheme;
  }, [terminalTheme]);

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

      // Build xterm.js theme from terminal palette
      const theme = terminalThemeRef.current;
      const xtermTheme = {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        cursorAccent: theme.cursorAccent,
        selectionBackground: theme.selectionBackground,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      };

      terminal = new XTerm({
        cursorBlink: false,
        cursorStyle: theme.cursorStyle,
        fontSize,
        fontFamily,
        theme: xtermTheme,
        cols: recording.terminalCols,
        rows: recording.terminalRows,
        disableStdin: true, // Read-only for playback
        allowTransparency: true, // Required for opacity/glass effect
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
  }, [recording, fontSize, fontFamily]);

  // Update terminal options when font preferences change
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;
    fitAddonRef.current?.fit();
  }, [fontSize, fontFamily]);

  // Update terminal theme when appearance changes
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Build xterm.js theme from terminal palette
    const xtermTheme = {
      background: terminalTheme.background,
      foreground: terminalTheme.foreground,
      cursor: terminalTheme.cursor,
      cursorAccent: terminalTheme.cursorAccent,
      selectionBackground: terminalTheme.selectionBackground,
      black: terminalTheme.black,
      red: terminalTheme.red,
      green: terminalTheme.green,
      yellow: terminalTheme.yellow,
      blue: terminalTheme.blue,
      magenta: terminalTheme.magenta,
      cyan: terminalTheme.cyan,
      white: terminalTheme.white,
      brightBlack: terminalTheme.brightBlack,
      brightRed: terminalTheme.brightRed,
      brightGreen: terminalTheme.brightGreen,
      brightYellow: terminalTheme.brightYellow,
      brightBlue: terminalTheme.brightBlue,
      brightMagenta: terminalTheme.brightMagenta,
      brightCyan: terminalTheme.brightCyan,
      brightWhite: terminalTheme.brightWhite,
    };

    // Apply theme and cursor style
    terminal.options.theme = xtermTheme;
    terminal.options.cursorStyle = terminalTheme.cursorStyle;
  }, [terminalTheme]);

  // Compute glass effect styles from terminal theme
  const glassStyles = useMemo(() => {
    const opacity = terminalTheme.opacity / 100; // Convert 0-100 to 0-1
    const blur = terminalTheme.blur;
    return {
      opacity: opacity < 1 ? opacity : undefined,
      backdropFilter: blur > 0 ? `blur(${blur}px)` : undefined,
      WebkitBackdropFilter: blur > 0 ? `blur(${blur}px)` : undefined, // Safari
    } as React.CSSProperties;
  }, [terminalTheme.opacity, terminalTheme.blur]);

  // Render events up to a given time
  const renderToTime = useCallback(
    (targetTime: number) => {
      const terminal = xtermRef.current;
      if (!terminal) return;

      const events = recording.data.events;

      // If seeking backwards, reset and replay from the beginning
      if (targetTime < lastRenderedTimeRef.current) {
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

      lastRenderedTimeRef.current = targetTime;
      setCurrentTime(targetTime);
    },
    [recording.data.events]
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
      // Use the ref value, not state, to avoid dependency on currentTime
      pausedAtRef.current = lastRenderedTimeRef.current;
      startTimeRef.current = null;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, tick]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    pausedAtRef.current = 0;
    eventIndexRef.current = 0;
    lastRenderedTimeRef.current = 0;
    xtermRef.current?.reset();
    setCurrentTime(0);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (currentTime >= recording.duration) {
      // Restart from beginning
      handleRestart();
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, currentTime, recording.duration, handleRestart]);

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
    <div className="flex flex-col h-full bg-background rounded-xl overflow-hidden border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-popover/50 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{recording.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatDuration(recording.duration)}
          </span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={glassStyles}
      />

      {/* Controls */}
      <div className="px-4 py-3 bg-popover/50 border-t border-border">
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePlayPause}
            className="w-8 h-8 text-foreground hover:bg-accent"
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
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>

          {/* Current time */}
          <span className="text-xs text-muted-foreground font-mono w-16">
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
          <span className="text-xs text-muted-foreground font-mono w-16 text-right">
            {formatDuration(recording.duration)}
          </span>

          {/* Speed */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSpeedChange}
            className="text-xs text-muted-foreground hover:text-foreground hover:bg-accent px-2"
          >
            {speed}x
          </Button>
        </div>
      </div>
    </div>
  );
}
