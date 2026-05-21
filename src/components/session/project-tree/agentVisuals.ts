import { Sparkles, Cpu, Code2, LucideIcon } from "lucide-react";
import { AgentProviderType } from "@/types/session";

export interface AgentVisualProps {
  label: string;
  icon: LucideIcon;
  classes: string;
  collapsedClasses: {
    active: string;
    inactive: string;
  };
}

export const AGENT_VISUALS: Record<AgentProviderType, AgentVisualProps | null> = {
  antigravity: {
    label: "agy",
    icon: Sparkles,
    classes: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/10 dark:text-pink-400 dark:border-pink-500/25 dark:shadow-[0_0_8px_rgba(236,72,153,0.15)]",
    collapsedClasses: {
      active: "ring-1 ring-pink-500/40 bg-pink-100 dark:ring-pink-500/50 dark:bg-pink-500/10",
      inactive: "hover:ring-1 hover:ring-pink-500/30",
    },
  },
  claude: {
    label: "claude",
    icon: Sparkles,
    classes: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25 dark:shadow-[0_0_8px_rgba(139,92,246,0.15)]",
    collapsedClasses: {
      active: "ring-1 ring-violet-500/40 bg-violet-100 dark:ring-violet-500/50 dark:bg-violet-500/10",
      inactive: "hover:ring-1 hover:ring-violet-500/30",
    },
  },
  gemini: {
    label: "gemini",
    icon: Sparkles,
    classes: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/25 dark:shadow-[0_0_8px_rgba(14,165,233,0.15)]",
    collapsedClasses: {
      active: "ring-1 ring-sky-500/40 bg-sky-100 dark:ring-sky-500/50 dark:bg-sky-500/10",
      inactive: "hover:ring-1 hover:ring-sky-500/30",
    },
  },
  codex: {
    label: "codex",
    icon: Cpu,
    classes: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25 dark:shadow-[0_0_8px_rgba(16,185,129,0.15)]",
    collapsedClasses: {
      active: "ring-1 ring-emerald-500/40 bg-emerald-100 dark:ring-emerald-500/50 dark:bg-emerald-500/10",
      inactive: "hover:ring-1 hover:ring-emerald-500/30",
    },
  },
  opencode: {
    label: "opencode",
    icon: Code2,
    classes: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25 dark:shadow-[0_0_8px_rgba(245,158,11,0.15)]",
    collapsedClasses: {
      active: "ring-1 ring-amber-500/40 bg-amber-100 dark:ring-amber-500/50 dark:bg-amber-500/10",
      inactive: "hover:ring-1 hover:ring-amber-500/30",
    },
  },
  none: null,
};
