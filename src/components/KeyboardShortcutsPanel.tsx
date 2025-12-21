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
      <DialogContent className="sm:max-w-[500px] bg-slate-900/95 backdrop-blur-xl border-white/10 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-violet-400" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Quick reference for all available keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {SHORTCUTS.map((category) => (
            <div key={category.name}>
              <h3 className="text-sm font-medium text-violet-400 mb-3">
                {category.name}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="text-sm text-slate-300">
                      {shortcut.description}
                    </span>
                    <kbd className="px-2 py-1 rounded bg-slate-800 border border-white/10 text-xs font-mono text-slate-400">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-white/5">
          <p className="text-xs text-slate-500 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px]">⌘?</kbd> anytime to show this panel
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
