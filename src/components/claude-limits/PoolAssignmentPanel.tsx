"use client";

/**
 * Claude profile assignment for a project (in project preferences).
 * [remote-dev-0yix]
 *
 * Three things:
 *   1. Primary profile — the project's pinned Claude profile. Persists
 *      immediately via the existing folder-link endpoints
 *      (`PUT/DELETE /api/profiles/folders/:projectId`, exposed on ProfileContext
 *      as link/unlinkFolderToProfile). This reuses the same persistence the
 *      Profiles UI already uses.
 *   2. Fallback pool — an ordered set of profiles to rotate through when the
 *      primary is limited. The *selection* (which pool) is a node preference
 *      (`claudeProfilePoolId`, inherited project→group) and is owned by the
 *      parent prefs form (controlled `poolId` / `onPoolIdChange`, saved with the
 *      rest of the prefs). Pool membership + priorities persist immediately via
 *      the pool member routes.
 *   3. Auto-relaunch mode — node preference `claudeAutoRelaunchMode`
 *      (null = inherit the global default), also a controlled prop saved by the
 *      parent.
 *
 * Reorder UX is a per-member priority number input (lower = higher priority),
 * which is sufficient for P1.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Bell, Repeat, Ban, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProfileContext } from "@/contexts/ProfileContext";
import { isClaudeCapableProvider } from "@/types/agent";
import type {
  ClaudeAutoRelaunchMode,
  ClaudePoolDetail,
} from "@/types/claude-limits";
import { LimitStatusBadge } from "./LimitStatusBadge";

const NO_PRIMARY = "__none__";
const NO_POOL = "__none__";
const CREATE_POOL = "__create__";

interface PoolAssignmentPanelProps {
  projectId: string;
  /** Controlled fallback-pool selection (node pref `claudeProfilePoolId`). */
  poolId: string | null;
  onPoolIdChange: (poolId: string | null) => void;
  /** Controlled auto-relaunch override (node pref; null = inherit global). */
  autoRelaunchMode: ClaudeAutoRelaunchMode | null;
  onAutoRelaunchModeChange: (mode: ClaudeAutoRelaunchMode | null) => void;
}

const RELAUNCH_OPTIONS: {
  value: ClaudeAutoRelaunchMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "notify", label: "Notify", icon: Bell },
  { value: "auto", label: "Auto", icon: Repeat },
  { value: "disabled", label: "Disabled", icon: Ban },
];

export function PoolAssignmentPanel({
  projectId,
  poolId,
  onPoolIdChange,
  autoRelaunchMode,
  onAutoRelaunchModeChange,
}: PoolAssignmentPanelProps) {
  const {
    profiles,
    folderProfileLinks,
    linkFolderToProfile,
    unlinkFolderFromProfile,
    pools,
    createPool,
    getPoolDetail,
    addPoolMember,
    removePoolMember,
  } = useProfileContext();

  // Only claude-capable profiles are assignable (they carry Claude accounts).
  const claudeProfiles = profiles.filter((p) =>
    isClaudeCapableProvider(p.provider)
  );

  const primaryProfileId = folderProfileLinks.get(projectId) ?? null;
  const [primarySaving, setPrimarySaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected pool detail (members) — loaded when a pool is chosen.
  const [poolDetail, setPoolDetail] = useState<ClaudePoolDetail | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [creatingPool, setCreatingPool] = useState(false);
  const [addMemberId, setAddMemberId] = useState<string>("");

  const reloadPoolDetail = useCallback(
    async (id: string) => {
      setPoolLoading(true);
      try {
        const detail = await getPoolDetail(id);
        setPoolDetail(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load pool");
        setPoolDetail(null);
      } finally {
        setPoolLoading(false);
      }
    },
    [getPoolDetail]
  );

  // Load the chosen pool's members whenever the selection changes.
  useEffect(() => {
    if (poolId) {
      void reloadPoolDetail(poolId);
    } else {
      setPoolDetail(null);
    }
  }, [poolId, reloadPoolDetail]);

  async function handlePrimaryChange(value: string) {
    setPrimarySaving(true);
    setError(null);
    try {
      if (value === NO_PRIMARY) {
        await unlinkFolderFromProfile(projectId);
      } else {
        await linkFolderToProfile(projectId, value);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set primary");
    } finally {
      setPrimarySaving(false);
    }
  }

  async function handlePoolSelect(value: string) {
    setError(null);
    if (value === NO_POOL) {
      onPoolIdChange(null);
      return;
    }
    if (value === CREATE_POOL) {
      // Handled by the inline create form below.
      return;
    }
    onPoolIdChange(value);
  }

  async function handleCreatePool() {
    const name = newPoolName.trim();
    if (!name) return;
    setCreatingPool(true);
    setError(null);
    try {
      const created = await createPool(name);
      setNewPoolName("");
      onPoolIdChange(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pool");
    } finally {
      setCreatingPool(false);
    }
  }

  async function handleAddMember() {
    if (!poolId || !addMemberId) return;
    setError(null);
    try {
      await addPoolMember(poolId, addMemberId);
      setAddMemberId("");
      await reloadPoolDetail(poolId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!poolId) return;
    setError(null);
    try {
      await removePoolMember(poolId, memberId);
      await reloadPoolDetail(poolId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handlePriorityChange(memberId: string, priority: number) {
    if (!poolId || !Number.isFinite(priority)) return;
    setError(null);
    try {
      // POST upserts (priority updated on conflict).
      await addPoolMember(poolId, memberId, priority);
      await reloadPoolDetail(poolId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set priority");
    }
  }

  // Profiles eligible to add to the pool: claude-capable, not already a member.
  const memberIds = new Set((poolDetail?.members ?? []).map((m) => m.profileId));
  const addableProfiles = claudeProfiles.filter((p) => !memberIds.has(p.id));

  if (claudeProfiles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No Claude profiles yet. Create one in Settings → Profiles to assign a
        primary profile and a fallback pool for this project.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Primary profile */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Primary Claude profile
          {primarySaving && (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          )}
        </Label>
        <Select
          value={primaryProfileId ?? NO_PRIMARY}
          onValueChange={handlePrimaryChange}
          disabled={primarySaving}
        >
          <SelectTrigger className="bg-card/50 border-border">
            <SelectValue placeholder="No primary profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PRIMARY}>No primary profile</SelectItem>
            {claudeProfiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Applied to new Claude sessions in this project. Saved immediately.
        </p>
      </div>

      {/* Fallback pool */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-muted-foreground" />
          Fallback pool
        </Label>
        <Select value={poolId ?? NO_POOL} onValueChange={handlePoolSelect}>
          <SelectTrigger className="bg-card/50 border-border">
            <SelectValue placeholder="No fallback pool" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_POOL}>No fallback pool</SelectItem>
            {pools.map((pool) => (
              <SelectItem key={pool.id} value={pool.id}>
                {pool.name} ({pool.memberCount})
              </SelectItem>
            ))}
            <SelectItem value={CREATE_POOL}>+ Create new pool…</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          When the primary is limited, sessions rotate to the first available
          member. Saved with this project&rsquo;s preferences.
        </p>

        {/* Inline create-pool form (when "+ Create" is the current trigger). */}
        <div className="flex gap-2">
          <Input
            value={newPoolName}
            onChange={(e) => setNewPoolName(e.target.value)}
            placeholder="New pool name"
            className="bg-card/50 border-border h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreatePool();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCreatePool()}
            disabled={creatingPool || !newPoolName.trim()}
            className="h-8 shrink-0"
          >
            {creatingPool ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Create
          </Button>
        </div>
      </div>

      {/* Pool members (when a pool is selected) */}
      {poolId && (
        <div className="space-y-2 rounded-lg border border-border bg-card/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              Pool members
            </span>
            {poolLoading && (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            )}
          </div>

          {poolDetail && poolDetail.members.length > 0 ? (
            <div className="space-y-1.5">
              {poolDetail.members
                .slice()
                .sort((a, b) => a.priority - b.priority)
                .map((member) => (
                  <div
                    key={member.profileId}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="number"
                      defaultValue={member.priority}
                      onBlur={(e) =>
                        void handlePriorityChange(
                          member.profileId,
                          Number(e.target.value)
                        )
                      }
                      className="h-7 w-16 bg-card/50 border-border text-xs tabular-nums"
                      title="Priority (lower = tried first)"
                    />
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">
                      {member.name ?? member.profileId}
                    </span>
                    <LimitStatusBadge state={member.limitState} />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleRemoveMember(member.profileId)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
            </div>
          ) : (
            !poolLoading && (
              <p className="text-[11px] text-muted-foreground">
                No members yet. Add Claude profiles below.
              </p>
            )
          )}

          {/* Add member */}
          {addableProfiles.length > 0 && (
            <div className="flex gap-2 pt-1">
              <Select value={addMemberId} onValueChange={setAddMemberId}>
                <SelectTrigger className="h-8 bg-card/50 border-border text-sm">
                  <SelectValue placeholder="Add a profile…" />
                </SelectTrigger>
                <SelectContent>
                  {addableProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleAddMember()}
                disabled={!addMemberId}
                className="h-8 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Auto-relaunch mode */}
      <div className="space-y-2">
        <Label>Auto-relaunch on limit</Label>
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => onAutoRelaunchModeChange(null)}
            className={cn(
              "px-2 py-2 rounded-lg border text-xs font-medium transition-all",
              autoRelaunchMode === null
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card/40 text-muted-foreground hover:border-primary/50"
            )}
          >
            Inherit
          </button>
          {RELAUNCH_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = autoRelaunchMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onAutoRelaunchModeChange(option.value)}
                className={cn(
                  "flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs font-medium transition-all",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card/40 text-muted-foreground hover:border-primary/50"
                )}
              >
                <Icon className="w-3 h-3" />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Overrides the global default. &ldquo;Inherit&rdquo; uses your account
          setting. Saved with this project&rsquo;s preferences.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
