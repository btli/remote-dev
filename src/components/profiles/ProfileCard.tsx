"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Star, Trash2, Edit2, FolderSymlink } from "lucide-react";
import type { AgentProfile, AgentProvider } from "@/types/agent";
import { PROVIDER_DISPLAY_NAMES } from "@/types/agent";

interface ProfileCardProps {
  profile: AgentProfile;
  linkedFolderCount: number;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

const PROVIDER_COLORS: Record<AgentProvider, string> = {
  claude: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  codex: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  gemini: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  opencode: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  all: "bg-muted/50 text-muted-foreground border-border",
};

export function ProfileCard({
  profile,
  linkedFolderCount,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onSetDefault,
}: ProfileCardProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          className={cn(
            "w-full text-left p-3 rounded-lg border transition-all",
            "hover:bg-accent",
            isSelected
              ? "bg-primary/10 border-primary/30"
              : "bg-card/30 border-border"
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">
                  {profile.name}
                </span>
                {profile.isDefault && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-400 border-amber-500/30"
                  >
                    <Star className="w-2.5 h-2.5 mr-0.5 fill-amber-400" />
                    Default
                  </Badge>
                )}
              </div>
              {profile.description && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {profile.description}
                </p>
              )}
            </div>
            <Badge
              variant="outline"
              className={cn("text-[10px] shrink-0", PROVIDER_COLORS[profile.provider])}
            >
              {PROVIDER_DISPLAY_NAMES[profile.provider]}
            </Badge>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/70">
            <span className="flex items-center gap-1">
              <FolderSymlink className="w-3 h-3" />
              {linkedFolderCount} folder{linkedFolderCount !== 1 ? "s" : ""}
            </span>
          </div>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-popover/95 backdrop-blur-xl border-border">
        <ContextMenuItem
          onClick={onEdit}
          className="text-muted-foreground focus:bg-primary/20 focus:text-foreground"
        >
          <Edit2 className="w-3.5 h-3.5 mr-2" />
          Edit Profile
        </ContextMenuItem>
        {!profile.isDefault && (
          <ContextMenuItem
            onClick={onSetDefault}
            className="text-muted-foreground focus:bg-primary/20 focus:text-foreground"
          >
            <Star className="w-3.5 h-3.5 mr-2" />
            Set as Default
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={onDelete}
          className="text-red-400 focus:bg-red-500/20 focus:text-red-300"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          Delete Profile
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
