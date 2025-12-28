"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Fingerprint, Star } from "lucide-react";
import { useProfileContext } from "@/contexts/ProfileContext";
import { PROVIDER_DISPLAY_NAMES } from "@/types/agent";
import type { AgentProvider } from "@/types/agent";
import { cn } from "@/lib/utils";

interface ProfileSelectorProps {
  value: string | null;
  onChange: (profileId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showProviderBadge?: boolean;
}

const PROVIDER_COLORS: Record<AgentProvider, string> = {
  claude: "bg-violet-500/20 text-violet-300",
  codex: "bg-emerald-500/20 text-emerald-300",
  gemini: "bg-blue-500/20 text-blue-300",
  opencode: "bg-orange-500/20 text-orange-300",
  all: "bg-muted/50 text-muted-foreground",
};

export function ProfileSelector({
  value,
  onChange,
  placeholder = "Select profile...",
  disabled = false,
  className,
  showProviderBadge = true,
}: ProfileSelectorProps) {
  const { profiles, loading } = useProfileContext();

  // Get selected profile for display
  const selectedProfile = useMemo(() => {
    if (!value) return null;
    return profiles.find((p) => p.id === value) || null;
  }, [profiles, value]);

  // Sort profiles: default first, then alphabetically
  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [profiles]);

  return (
    <Select
      value={value || "none"}
      onValueChange={(v) => onChange(v === "none" ? null : v)}
      disabled={disabled || loading}
    >
      <SelectTrigger
        className={cn(
          "bg-card border-border text-foreground",
          className
        )}
      >
        <SelectValue placeholder={placeholder}>
          {selectedProfile ? (
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-primary" />
              <span>{selectedProfile.name}</span>
              {selectedProfile.isDefault && (
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              )}
              {showProviderBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1 py-0",
                    PROVIDER_COLORS[selectedProfile.provider]
                  )}
                >
                  {PROVIDER_DISPLAY_NAMES[selectedProfile.provider]}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-card border-border">
        {/* None option */}
        <SelectItem value="none" className="text-muted-foreground focus:bg-primary/20">
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground/70">No profile</span>
          </span>
        </SelectItem>

        {/* Profile options */}
        {sortedProfiles.map((profile) => (
          <SelectItem
            key={profile.id}
            value={profile.id}
            className="text-foreground focus:bg-primary/20"
          >
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-primary" />
              <span>{profile.name}</span>
              {profile.isDefault && (
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              )}
              {showProviderBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1 py-0",
                    PROVIDER_COLORS[profile.provider]
                  )}
                >
                  {PROVIDER_DISPLAY_NAMES[profile.provider]}
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}

        {/* Empty state */}
        {profiles.length === 0 && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No profiles created yet
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
