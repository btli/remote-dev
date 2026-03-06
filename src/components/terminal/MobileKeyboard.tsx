"use client";

import { useState, useCallback, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileKeyboardProps {
  onKeyPress: (key: string, modifiers?: { ctrl?: boolean; alt?: boolean }) => void;
  onImageUpload?: (file: File) => Promise<void>;
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

export function MobileKeyboard({ onKeyPress, onImageUpload, className }: MobileKeyboardProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onImageUpload) return;
      // Reset so the same file can be selected again
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
  };

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 p-2 bg-popover/95 backdrop-blur-sm border-t border-border",
        "pb-safe-bottom",
        className
      )}
    >
      {/* Main special keys */}
      <div className="flex gap-1.5 flex-wrap">
        {SPECIAL_KEYS.map(renderKey)}
      </div>

      {/* Separator */}
      <div className="w-px bg-border mx-1 self-stretch" />

      {/* Extra common characters */}
      <div className="flex gap-1.5 flex-wrap">
        {EXTRA_KEYS.map(renderKey)}
      </div>

      {/* Image upload button */}
      {onImageUpload && (
        <>
          <div className="w-px bg-border mx-1 self-stretch" />
          <button
            onClick={() => fileInputRef.current?.click()}
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
      )}
    </div>
  );
}
