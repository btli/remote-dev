"use client";

/**
 * TaskEditor - Inline expandable editor for a single task.
 *
 * Renders editable fields: title, description, instructions, priority,
 * labels, subtasks, metadata viewer, and dependency display.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Circle,
  Check,
  ChevronDown,
  Bot,
  User,
  X,
} from "lucide-react";
import type {
  ProjectTask,
  UpdateTaskInput,
  TaskPriority,
  TaskStatus,
  TaskSubtask,
} from "@/types/task";
import { PRIORITY_CONFIG } from "@/types/task";

interface TaskEditorProps {
  task: ProjectTask;
  allTasks: ProjectTask[];
  onUpdate: (id: string, input: UpdateTaskInput) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: "open", label: "Open", color: "text-muted-foreground" },
  { value: "in_progress", label: "In Progress", color: "text-chart-2" },
  { value: "done", label: "Done", color: "text-green-500" },
  { value: "cancelled", label: "Cancelled", color: "text-muted-foreground/50" },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];

export function TaskEditor({ task, allTasks, onUpdate, onClose }: TaskEditorProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [instructions, setInstructions] = useState(task.instructions ?? "");
  const [showMetadata, setShowMetadata] = useState(false);

  // Sync local state when task changes externally
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setInstructions(task.instructions ?? "");
  }, [task.title, task.description, task.instructions]);

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdate(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const saveDescription = () => {
    const value = description.trim() || null;
    if (value !== (task.description ?? null)) {
      onUpdate(task.id, { description: value });
    }
  };

  const saveInstructions = () => {
    const value = instructions.trim() || null;
    if (value !== (task.instructions ?? null)) {
      onUpdate(task.id, { instructions: value });
    }
  };

  const toggleSubtask = (subtaskId: string) => {
    const updated = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    onUpdate(task.id, { subtasks: updated });
  };

  const addSubtask = (subtaskTitle: string) => {
    const newSubtask: TaskSubtask = {
      id: crypto.randomUUID(),
      title: subtaskTitle,
      completed: false,
    };
    onUpdate(task.id, { subtasks: [...task.subtasks, newSubtask] });
  };

  const removeSubtask = (subtaskId: string) => {
    onUpdate(task.id, { subtasks: task.subtasks.filter((s) => s.id !== subtaskId) });
  };

  // Resolve blockedBy IDs to task titles
  const blockerTasks = task.blockedBy
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is ProjectTask => t !== undefined);

  const metadataEntries = Object.entries(task.metadata ?? {});
  const hasMetadata = metadataEntries.length > 0;

  return (
    <div className="border border-border rounded-md bg-card/80 p-2.5 space-y-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-150">
      {/* Header with close button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {task.source === "agent" ? (
            <Bot className="w-3 h-3 text-primary/60" />
          ) : (
            <User className="w-3 h-3 text-muted-foreground" />
          )}
          <span className="text-[10px] text-muted-foreground">
            {task.source === "agent" ? "Agent Task" : "Manual Task"}
            {task.owner && ` · ${task.owner}`}
          </span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-full text-xs font-medium text-foreground bg-transparent border-b border-transparent focus:border-primary outline-none pb-0.5"
      />

      {/* Status + Priority row */}
      <div className="flex items-center gap-2">
        {/* Status */}
        <div className="flex items-center gap-0.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdate(task.id, { status: opt.value })}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                task.status === opt.value
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="w-px h-3 bg-border" />

        {/* Priority */}
        <div className="flex items-center gap-0.5">
          {PRIORITY_OPTIONS.map((p) => {
            const config = PRIORITY_CONFIG[p];
            return (
              <button
                key={p}
                onClick={() => onUpdate(task.id, { priority: p })}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  task.priority === p
                    ? "font-medium"
                    : "opacity-50 hover:opacity-100"
                )}
                style={{
                  backgroundColor: task.priority === p ? `#${config.color}20` : undefined,
                  color: `#${config.color}`,
                }}
              >
                {config.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          placeholder="Add description..."
          rows={2}
          className="w-full text-[11px] text-foreground bg-transparent border border-border rounded px-1.5 py-1 outline-none focus:border-primary resize-none mt-0.5 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Instructions (for agent context re-injection) */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">
          Instructions
          <span className="text-muted-foreground/50 font-normal"> · injected on agent stop</span>
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={saveInstructions}
          placeholder="Add instructions for the agent..."
          rows={2}
          className="w-full text-[11px] text-foreground bg-transparent border border-border rounded px-1.5 py-1 outline-none focus:border-primary resize-none mt-0.5 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Subtasks */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">
          Subtasks
          {task.subtasks.length > 0 && (
            <span className="ml-1 text-muted-foreground/50">
              {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
            </span>
          )}
        </label>
        <div className="mt-0.5 space-y-0.5">
          {task.subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-1.5 group">
              <button onClick={() => toggleSubtask(sub.id)} className="shrink-0">
                {sub.completed ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
              <span
                className={cn(
                  "text-[11px] flex-1",
                  sub.completed ? "text-muted-foreground line-through" : "text-foreground"
                )}
              >
                {sub.title}
              </span>
              <button
                onClick={() => removeSubtask(sub.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          <SubtaskQuickAdd onAdd={addSubtask} />
        </div>
      </div>

      {/* Dependencies */}
      {blockerTasks.length > 0 && (
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Blocked by</label>
          <div className="mt-0.5 space-y-0.5">
            {blockerTasks.map((blocker) => (
              <div
                key={blocker.id}
                className={cn(
                  "text-[11px] px-1.5 py-0.5 rounded bg-accent/50 flex items-center gap-1",
                  blocker.status === "done" ? "line-through text-muted-foreground" : "text-foreground"
                )}
              >
                <span className="flex-1 truncate">{blocker.title}</span>
                <button
                  onClick={() => {
                    const newBlockers = task.blockedBy.filter((id) => id !== blocker.id);
                    onUpdate(task.id, { blockedBy: newBlockers });
                  }}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata viewer */}
      {hasMetadata && (
        <div>
          <button
            onClick={() => setShowMetadata(!showMetadata)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium hover:text-foreground"
          >
            <ChevronDown className={cn("w-2.5 h-2.5 transition-transform", !showMetadata && "-rotate-90")} />
            Metadata ({metadataEntries.length})
          </button>
          {showMetadata && (
            <pre className="mt-0.5 text-[10px] text-muted-foreground bg-muted/50 rounded p-1.5 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(task.metadata, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SubtaskQuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-1">
      <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
        placeholder="Add subtask..."
        className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none"
      />
    </div>
  );
}
