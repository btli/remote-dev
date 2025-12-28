"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutCategory {
  name: string;
  shortcuts: {
    keys: string;
    description: string;
  }[];
}

const SHORTCUTS: ShortcutCategory[] = [
  {
    name: "Sessions",
    shortcuts: [
      { keys: "⌘↵", description: "New terminal (quick)" },
      { keys: "⌘⇧W", description: "Close active session" },
      { keys: "⌘[", description: "Previous session" },
      { keys: "⌘]", description: "Next session" },
    ],
  },
  {
    name: "Split Panes",
    shortcuts: [
      { keys: "⌘D", description: "Split horizontally" },
      { keys: "⌘⇧D", description: "Split vertically" },
    ],
  },
  {
    name: "Terminal",
    shortcuts: [
      { keys: "⌘F", description: "Search in terminal" },
      { keys: "Esc", description: "Close search / Cancel" },
      { keys: "⌘C", description: "Copy selection" },
      { keys: "⌘V", description: "Paste" },
    ],
  },
  {
    name: "Navigation",
    shortcuts: [
      { keys: "⌘K", description: "Open command palette" },
      { keys: "⌘⇧P", description: "Open command palette" },
      { keys: "⌘?", description: "Keyboard shortcuts help" },
    ],
  },
];

export function KeyboardShortcutsPanel({ open, onOpenChange }: KeyboardShortcutsPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+? or Cmd+Shift+/ for keyboard shortcuts help
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "/") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-popover/95 backdrop-blur-xl border-border max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Quick reference for all available keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {SHORTCUTS.map((category) => (
            <div key={category.name}>
              <h3 className="text-sm font-medium text-primary mb-3">
                {category.name}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-muted-foreground">
                      {shortcut.description}
                    </span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-xs font-mono text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground/70 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">⌘?</kbd> anytime to show this panel
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
