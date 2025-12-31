"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Search,
  User,
  Check,
  Clock,
  Folder,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface Profile {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  updatedAt: Date;
}

interface ProfileSwitcherProps {
  profiles: Profile[];
  activeProfileId?: string | null;
  onSelect: (profileId: string) => void;
  onCreateNew?: () => void;
  recentProfileIds?: string[];
  disabled?: boolean;
  /** Control open state externally */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * ProfileSwitcher - Quick-switch modal for agent profiles
 *
 * Can be controlled externally via open/onOpenChange props,
 * or opened via keyboard shortcut Cmd/Ctrl+Shift+P.
 * Features fuzzy search, recent profiles, and quick selection.
 */
export function ProfileSwitcher({
  profiles,
  activeProfileId,
  onSelect,
  onCreateNew,
  recentProfileIds = [],
  disabled = false,
  open: controlledOpen,
  onOpenChange,
}: ProfileSwitcherProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Use controlled or internal state
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (onOpenChange) {
        onOpenChange(value);
      } else {
        setInternalOpen(value);
      }
    },
    [onOpenChange]
  );

  // Global keyboard shortcut: Cmd/Ctrl+Shift+P
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setOpen(true);
        setSearch("");
        setSelectedIndex(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, setOpen]);

  // Filter and sort profiles
  const filteredProfiles = useMemo(() => {
    const searchLower = search.toLowerCase().trim();

    // Filter by search
    const filtered = searchLower
      ? profiles.filter(
          (p) =>
            p.name.toLowerCase().includes(searchLower) ||
            p.description?.toLowerCase().includes(searchLower)
        )
      : profiles;

    // Sort: recent first, then alphabetical
    return filtered.sort((a, b) => {
      const aRecent = recentProfileIds.indexOf(a.id);
      const bRecent = recentProfileIds.indexOf(b.id);

      // Active profile first
      if (a.id === activeProfileId) return -1;
      if (b.id === activeProfileId) return 1;

      // Recent profiles second
      if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
      if (aRecent !== -1) return -1;
      if (bRecent !== -1) return 1;

      // Alphabetical fallback
      return a.name.localeCompare(b.name);
    });
  }, [profiles, search, recentProfileIds, activeProfileId]);

  // Clamp selectedIndex to valid range
  const clampedSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredProfiles.length - 1)
  );

  // Keyboard navigation within dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            Math.min(i + 1, filteredProfiles.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredProfiles[clampedSelectedIndex]) {
            onSelect(filteredProfiles[clampedSelectedIndex].id);
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [filteredProfiles, clampedSelectedIndex, onSelect, setOpen]
  );

  const getProfileIcon = (profile: Profile) => {
    if (profile.icon) return profile.icon;
    return <Folder className="w-4 h-4" />;
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 bg-background/95 backdrop-blur-xl border-border/50"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <User className="w-4 h-4" />
            Switch Profile
            <Badge variant="outline" className="ml-auto text-xs font-mono">
              {"\u2318"}+Shift+P
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search profiles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-muted/50 border-border/50"
              autoFocus
            />
          </div>
        </div>

        {/* Profile List */}
        <div className="max-h-80 overflow-y-auto px-2 pb-2">
          {filteredProfiles.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No profiles found</p>
              {onCreateNew && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onCreateNew();
                    setOpen(false);
                  }}
                  className="mt-2"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Create New Profile
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredProfiles.map((profile, index) => {
                const isActive = profile.id === activeProfileId;
                const isSelected = index === clampedSelectedIndex;
                const isRecent = recentProfileIds.includes(profile.id);

                return (
                  <button
                    key={profile.id}
                    onClick={() => {
                      onSelect(profile.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/50",
                      isActive && "bg-primary/5"
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0",
                        profile.color
                          ? `bg-${profile.color}-500/10`
                          : "bg-muted"
                      )}
                      style={
                        profile.color
                          ? { backgroundColor: `${profile.color}15` }
                          : undefined
                      }
                    >
                      {typeof getProfileIcon(profile) === "string"
                        ? getProfileIcon(profile)
                        : getProfileIcon(profile)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {profile.name}
                        </span>
                        {isActive && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Active
                          </Badge>
                        )}
                        {isRecent && !isActive && (
                          <Clock className="w-3 h-3 text-muted-foreground" />
                        )}
                      </div>
                      {profile.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.description}
                        </p>
                      )}
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {getTimeAgo(profile.updatedAt)}
                      </span>
                      {isActive ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {onCreateNew && filteredProfiles.length > 0 && (
          <div className="px-4 py-3 border-t border-border/50 bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onCreateNew();
                setOpen(false);
              }}
              className="w-full justify-start text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Create New Profile
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to programmatically control the profile switcher
 */
export function useProfileSwitcher() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  return { isOpen, open, close, toggle, setIsOpen };
}
