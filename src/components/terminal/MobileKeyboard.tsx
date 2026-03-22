"use client";

import { useState, useCallback, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModifierKey } from "@/hooks/useMobileModifiers";

type KeyboardMode = "keys" | "nav";

interface MobileKeyboardProps {
  /** Send a pre-resolved ANSI sequence to the terminal */
  onKeyPress: (sequence: string) => void;
  /** Toggle a sticky modifier on/off */
  onModifierToggle: (modifier: ModifierKey) => void;
  /** Whether each modifier is currently active */
  ctrlActive: boolean;
  altActive: boolean;
  shiftActive: boolean;
  /** Whether any modifier is active (for resolving keys through modifiers) */
  anyModifierActive: boolean;
  /** Resolve a key through active modifiers and clear them */
  resolveKey: (key: string) => string;
  onImageUpload?: (file: File) => Promise<void>;
  className?: string;
}

interface KeyConfig {
  label: string;
  key: string;
  className?: string;
  type?: "modifier" | "mode-switch";
  modifier?: ModifierKey;
}

// ── Keys Mode: modifiers, control combos, punctuation ──────────────────────

const KEYS_ROW1: KeyConfig[] = [
  { label: "ESC", key: "\x1b" },
  { label: "TAB", key: "\t" },
  { label: "^C", key: "\x03" },
  { label: "^D", key: "\x04" },
  { label: "CTRL", key: "ctrl", type: "modifier", modifier: "ctrl" },
  { label: "ALT", key: "alt", type: "modifier", modifier: "alt" },
  { label: "SHIFT", key: "shift", type: "modifier", modifier: "shift" },
];

const KEYS_ROW2: KeyConfig[] = [
  { label: "|", key: "|" },
  { label: "/", key: "/" },
  { label: "~", key: "~" },
  { label: "-", key: "-" },
  { label: "_", key: "_" },
  { label: ":", key: ":" },
];

// ── Nav Mode: arrows, navigation, enter keys ───────────────────────────────

const NAV_ROW1: KeyConfig[] = [
  { label: "↑", key: "\x1b[A" },
  { label: "HOME", key: "\x1b[H" },
  { label: "END", key: "\x1b[F" },
  { label: "ENTER", key: "\r" },
  { label: "⇧↵", key: "\x1b\r" },
];

const NAV_ROW2: KeyConfig[] = [
  { label: "←", key: "\x1b[D" },
  { label: "↓", key: "\x1b[B" },
  { label: "→", key: "\x1b[C" },
  { label: "PGUP", key: "\x1b[5~" },
  { label: "PGDN", key: "\x1b[6~" },
];

export function MobileKeyboard({
  onKeyPress,
  onModifierToggle,
  ctrlActive,
  altActive,
  shiftActive,
  anyModifierActive,
  resolveKey,
  onImageUpload,
  className,
}: MobileKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>("keys");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onImageUpload) return;
      e.target.value = "";

      setIsUploading(true);
      setUploadError(null);
      try {
        await onImageUpload(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        setUploadError(message);
        setTimeout(() => setUploadError(null), 3000);
      } finally {
        setIsUploading(false);
      }
    },
    [onImageUpload]
  );

  const handleKeyPress = useCallback(
    (config: KeyConfig) => {
      if (config.type === "modifier" && config.modifier) {
        onModifierToggle(config.modifier);
        return;
      }

      // Pre-composed sequences (arrows, ⇧↵, PGUP, HOME, etc.) send directly
      // — don't resolve through modifiers to avoid corrupted double-escapes
      const isPrecomposed = config.key.length > 1;
      if (anyModifierActive && !isPrecomposed) {
        onKeyPress(resolveKey(config.key));
      } else {
        onKeyPress(config.key);
      }
    },
    [onKeyPress, onModifierToggle, anyModifierActive, resolveKey]
  );

  const renderKey = useCallback(
    (config: KeyConfig) => {
      const isActive =
        (config.modifier === "ctrl" && ctrlActive) ||
        (config.modifier === "alt" && altActive) ||
        (config.modifier === "shift" && shiftActive);

      return (
        <button
          key={config.label}
          onClick={() => handleKeyPress(config)}
          className={cn(
            "px-2.5 py-1.5 rounded-md text-xs font-medium",
            "bg-card/80 text-muted-foreground",
            "active:bg-primary active:text-primary-foreground",
            "touch-manipulation select-none",
            "transition-colors duration-100",
            isActive && "bg-primary text-primary-foreground",
            config.className
          )}
        >
          {config.label}
        </button>
      );
    },
    [ctrlActive, altActive, shiftActive, handleKeyPress]
  );

  const handleModeSwitch = useCallback(() => {
    setMode((prev) => (prev === "keys" ? "nav" : "keys"));
  }, []);

  const modeSwitchButton = (
    <button
      onClick={handleModeSwitch}
      className={cn(
        "px-2.5 py-1.5 rounded-md text-xs font-medium",
        "bg-muted/60 text-muted-foreground",
        "active:bg-primary active:text-primary-foreground",
        "touch-manipulation select-none",
        "transition-colors duration-100",
        "border border-border/50"
      )}
      aria-label={mode === "keys" ? "Switch to navigation keys" : "Switch to control keys"}
    >
      {mode === "keys" ? "NAV" : "KEYS"}
    </button>
  );

  const handleCameraClick = useCallback(() => fileInputRef.current?.click(), []);

  const cameraButton = onImageUpload && (
    <>
      <div className="w-px bg-border mx-1 self-stretch" />
      <button
        onClick={handleCameraClick}
        disabled={isUploading}
        className={cn(
          "px-2.5 py-1.5 rounded-md text-xs font-medium",
          "bg-card/80 text-muted-foreground",
          "active:bg-primary active:text-primary-foreground",
          "touch-manipulation select-none",
          "transition-colors duration-100",
          isUploading && "opacity-50",
          uploadError && "text-destructive"
        )}
        aria-label={uploadError || "Upload screenshot"}
      >
        {isUploading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Camera className="w-3.5 h-3.5" />
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );

  const row1 = mode === "keys" ? KEYS_ROW1 : NAV_ROW1;
  const row2 = mode === "keys" ? KEYS_ROW2 : NAV_ROW2;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 p-2 bg-popover/95 backdrop-blur-sm border-t border-border",
        "pb-safe-bottom",
        className
      )}
    >
      {/* Row 1: main keys + mode switch */}
      <div className="flex gap-1.5 items-center">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {row1.map(renderKey)}
        </div>
        {modeSwitchButton}
      </div>

      {/* Row 2: extras/nav + camera */}
      <div className="flex gap-1.5 items-center">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {row2.map(renderKey)}
        </div>
        {cameraButton}
      </div>
    </div>
  );
}
