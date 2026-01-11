"use client";

/**
 * InsightsDashboardWidget - Compact widget showing learned insights.
 *
 * Displays conventions, patterns, gotchas, skills, and tools with:
 * - Type-based filtering
 * - Expandable detail view
 * - Confidence indicators
 * - Action buttons (reinforce, dismiss, delete)
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Lightbulb,
  AlertTriangle,
  Code2,
  Wrench,
  FileCode2,
  ChevronDown,
  ChevronRight,
  Filter,
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  RefreshCw,
  Loader2,
  ExternalLink,
  Copy,
  CheckCircle2,
} from "lucide-react";
import {
  useInsights,
  type Insight,
  type InsightType,
  INSIGHT_TYPES,
} from "@/hooks/useInsights";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface InsightsDashboardWidgetProps {
  folderId?: string | null;
  className?: string;
  /** Max height for the widget */
  maxHeight?: number;
  /** Show header */
  showHeader?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Config
// ─────────────────────────────────────────────────────────────────────────────

const typeConfig: Record<
  InsightType,
  { icon: React.ElementType; color: string; bgColor: string; label: string }
> = {
  convention: {
    icon: FileCode2,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    label: "Convention",
  },
  pattern: {
    icon: Lightbulb,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    label: "Pattern",
  },
  gotcha: {
    icon: AlertTriangle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Gotcha",
  },
  skill: {
    icon: Code2,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    label: "Skill",
  },
  tool: {
    icon: Wrench,
    color: "text-pink-400",
    bgColor: "bg-pink-500/10",
    label: "Tool",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function InsightsDashboardWidget({
  folderId,
  className,
  maxHeight = 300,
  showHeader = true,
}: InsightsDashboardWidgetProps) {
  const {
    insights,
    byType,
    loading,
    error,
    refresh,
    deleteInsight,
    updateConfidence,
    counts,
    filterTypes,
    setFilterTypes,
  } = useInsights({
    folderId,
    pollInterval: 60000,
    autoFetch: true,
  });

  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter insights by selected types
  const filteredInsights = useMemo(() => {
    return insights.filter((i) => filterTypes.includes(i.type));
  }, [insights, filterTypes]);

  // Toggle insight expansion
  const toggleExpand = (id: string) => {
    setExpandedInsights((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle filter type
  const toggleFilterType = (type: InsightType) => {
    setFilterTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Copy insight content
  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Reinforce insight (increase confidence)
  const handleReinforce = async (id: string, currentConfidence: number) => {
    const newConfidence = Math.min(1, currentConfidence + 0.1);
    await updateConfidence(id, newConfidence);
  };

  // Diminish insight (decrease confidence)
  const handleDiminish = async (id: string, currentConfidence: number) => {
    const newConfidence = Math.max(0.1, currentConfidence - 0.1);
    await updateConfidence(id, newConfidence);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium">Insights</span>
            {counts.total > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {counts.total}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Filter dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Filter className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {INSIGHT_TYPES.map((type) => {
                  const config = typeConfig[type];
                  const Icon = config.icon;
                  return (
                    <DropdownMenuCheckboxItem
                      key={type}
                      checked={filterTypes.includes(type)}
                      onCheckedChange={() => toggleFilterType(type)}
                    >
                      <Icon className={cn("h-3.5 w-3.5 mr-2", config.color)} />
                      {config.label}
                      <Badge
                        variant="outline"
                        className="ml-auto h-4 px-1 text-[10px]"
                      >
                        {counts[type]}
                      </Badge>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Refresh button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={loading}
              className="h-7 w-7"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Type summary badges */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border">
        {INSIGHT_TYPES.map((type) => {
          const config = typeConfig[type];
          const Icon = config.icon;
          const isActive = filterTypes.includes(type);
          return (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggleFilterType(type)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors",
                    isActive ? config.bgColor : "bg-muted/50",
                    isActive ? config.color : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>{counts[type]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  {counts[type]} {config.label.toLowerCase()}
                  {counts[type] !== 1 ? "s" : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Insights list */}
      <ScrollArea style={{ maxHeight }} className="flex-1">
        <div className="p-2 space-y-1">
          {loading && filteredInsights.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredInsights.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No insights yet</p>
              <p className="text-[10px] mt-1">
                Insights are learned from your sessions
              </p>
            </div>
          ) : (
            filteredInsights.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                expanded={expandedInsights.has(insight.id)}
                onToggleExpand={() => toggleExpand(insight.id)}
                onCopy={() => handleCopy(insight.content, insight.id)}
                onReinforce={() => handleReinforce(insight.id, insight.confidence)}
                onDiminish={() => handleDiminish(insight.id, insight.confidence)}
                onDelete={() => deleteInsight(insight.id)}
                copied={copiedId === insight.id}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight Card
// ─────────────────────────────────────────────────────────────────────────────

interface InsightCardProps {
  insight: Insight;
  expanded: boolean;
  onToggleExpand: () => void;
  onCopy: () => void;
  onReinforce: () => void;
  onDiminish: () => void;
  onDelete: () => void;
  copied: boolean;
}

function InsightCard({
  insight,
  expanded,
  onToggleExpand,
  onCopy,
  onReinforce,
  onDiminish,
  onDelete,
  copied,
}: InsightCardProps) {
  const config = typeConfig[insight.type];
  const Icon = config.icon;

  // Format time ago
  const timeAgo = useMemo(() => {
    const now = new Date();
    const diff = now.getTime() - insight.createdAt.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  }, [insight.createdAt]);

  // Preview text
  const preview =
    insight.content.length > 80
      ? insight.content.slice(0, 80) + "..."
      : insight.content;

  // Confidence percentage
  const confidencePct = Math.round(insight.confidence * 100);

  return (
    <Collapsible open={expanded} onOpenChange={onToggleExpand}>
      <div
        className={cn(
          "rounded-lg border transition-colors",
          expanded ? "border-muted-foreground/30" : "border-transparent",
          "hover:border-muted-foreground/20"
        )}
      >
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-start gap-2 p-2 text-left">
            <div
              className={cn(
                "flex-shrink-0 p-1 rounded",
                config.bgColor
              )}
            >
              <Icon className={cn("h-3 w-3", config.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className={cn("text-[10px] font-medium", config.color)}>
                  {config.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  • {timeAgo}
                </span>
                <span
                  className={cn(
                    "text-[10px] ml-auto",
                    confidencePct >= 70
                      ? "text-green-500"
                      : confidencePct >= 40
                        ? "text-yellow-500"
                        : "text-red-500"
                  )}
                >
                  {confidencePct}%
                </span>
              </div>
              <p className="text-xs text-foreground/90 line-clamp-2 mt-0.5">
                {insight.name || preview}
              </p>
            </div>
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-1" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-1" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="px-2 pb-2 pt-0">
            <div className="bg-muted/50 rounded p-2 text-xs text-foreground/80 whitespace-pre-wrap">
              {insight.content}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReinforce();
                      }}
                    >
                      <ThumbsUp className="h-3 w-3 text-green-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reinforce (increase confidence)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDiminish();
                      }}
                    >
                      <ThumbsDown className="h-3 w-3 text-orange-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Diminish (decrease confidence)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopy();
                      }}
                    >
                      {copied ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete insight</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default InsightsDashboardWidget;
