"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function Terminal({ onData, onResize }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        cursorAccent: "#1a1b26",
        selectionBackground: "#33467c",
        black: "#32344a",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#ad8ee6",
        cyan: "#449dab",
        white: "#787c99",
        brightBlack: "#444b6a",
        brightRed: "#ff7a93",
        brightGreen: "#b9f27c",
        brightYellow: "#ff9e64",
        brightBlue: "#7da6ff",
        brightMagenta: "#bb9af7",
        brightCyan: "#0db9d7",
        brightWhite: "#acb0d0",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (onData) {
      terminal.onData(onData);
    }

    if (onResize) {
      terminal.onResize(({ cols, rows }) => onResize(cols, rows));
    }

    terminal.writeln("Welcome to Remote Dev Terminal");
    terminal.writeln("Connecting to server...");
    terminal.write("\r\n$ ");

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [onData, onResize]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#1a1b26] p-2 rounded-lg"
    />
  );
}

export function useTerminal() {
  const terminalRef = useRef<XTerm | null>(null);

  const write = (data: string) => {
    terminalRef.current?.write(data);
  };

  const writeln = (data: string) => {
    terminalRef.current?.writeln(data);
  };

  const clear = () => {
    terminalRef.current?.clear();
  };

  return { terminalRef, write, writeln, clear };
}
