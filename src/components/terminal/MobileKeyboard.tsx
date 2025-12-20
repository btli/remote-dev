"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface MobileKeyboardProps {
  onKeyPress: (key: string, modifiers?: { ctrl?: boolean; alt?: boolean }) => void;
  className?: string;
}

interface KeyConfig {
  label: string;
  key: string;
  className?: string;
  isModifier?: boolean;
}

const SPECIAL_KEYS: KeyConfig[] = [
  { label: "ESC", key: "\x1b" },
  { label: "TAB", key: "\t" },
  { label: "CTRL", key: "ctrl", isModifier: true },
  { label: "ALT", key: "alt", isModifier: true },
  { label: "↑", key: "\x1b[A" },
  { label: "↓", key: "\x1b[B" },
  { label: "←", key: "\x1b[D" },
  { label: "→", key: "\x1b[C" },
];

const EXTRA_KEYS: KeyConfig[] = [
  { label: "|", key: "|" },
  { label: "/", key: "/" },
  { label: "~", key: "~" },
  { label: "-", key: "-" },
  { label: "_", key: "_" },
  { label: ":", key: ":" },
];

export function MobileKeyboard({ onKeyPress, className }: MobileKeyboardProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  const handleKeyPress = useCallback(
    (config: KeyConfig) => {
      if (config.isModifier) {
        if (config.key === "ctrl") {
          setCtrlActive((prev) => !prev);
        } else if (config.key === "alt") {
          setAltActive((prev) => !prev);
        }
        return;
      }

      onKeyPress(config.key, {
        ctrl: ctrlActive,
        alt: altActive,
      });

      // Reset modifiers after keypress
      if (ctrlActive || altActive) {
        setCtrlActive(false);
        setAltActive(false);
      }
    },
    [ctrlActive, altActive, onKeyPress]
  );

  const renderKey = (config: KeyConfig) => {
    const isActive =
      (config.key === "ctrl" && ctrlActive) ||
      (config.key === "alt" && altActive);

    return (
      <button
        key={config.label}
        onClick={() => handleKeyPress(config)}
        className={cn(
          "px-2.5 py-1.5 rounded-md text-xs font-medium",
          "bg-slate-800/80 text-slate-300",
          "active:bg-violet-600 active:text-white",
          "touch-manipulation select-none",
          "transition-colors duration-100",
          isActive && "bg-violet-600 text-white",
          config.className
        )}
      >
        {config.label}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 p-2 bg-slate-900/95 backdrop-blur-sm border-t border-white/10",
        "md:hidden", // Only show on mobile
        className
      )}
    >
      {/* Main special keys */}
      <div className="flex gap-1.5 flex-wrap">
        {SPECIAL_KEYS.map(renderKey)}
      </div>

      {/* Separator */}
      <div className="w-px bg-white/10 mx-1 self-stretch" />

      {/* Extra common characters */}
      <div className="flex gap-1.5 flex-wrap">
        {EXTRA_KEYS.map(renderKey)}
      </div>
    </div>
  );
}
