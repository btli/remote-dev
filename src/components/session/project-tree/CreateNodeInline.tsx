"use client";

import { useRef, useState, type KeyboardEvent } from "react";

export interface CreateNodeInlineProps {
  depth: number;
  kind: "group" | "project";
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}

export function CreateNodeInline({ depth, kind, onSubmit, onCancel }: CreateNodeInlineProps) {
  const [value, setValue] = useState("");
  const submittedRef = useRef(false);

  const submit = async () => {
    if (submittedRef.current) return;
    const trimmed = value.trim();
    if (!trimmed) { onCancel(); return; }
    submittedRef.current = true;
    await onSubmit(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      submittedRef.current = true;
      onCancel();
    }
  };

  return (
    <div
      style={{ paddingLeft: depth * 12 + "px" }}
      className="flex items-center gap-1.5 px-2 py-1"
    >
      <input
        autoFocus
        aria-label={kind === "group" ? "New group name" : "New project name"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void submit()}
        onClick={(e) => e.stopPropagation()}
        placeholder={kind === "group" ? "New group…" : "New project…"}
        className="flex-1 bg-input border border-primary/50 rounded px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
