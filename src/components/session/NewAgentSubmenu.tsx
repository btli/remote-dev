"use client";

/**
 * NewAgentSubmenu — shared submenu for "Pick Agent ▸" entries in the sidebar
 * `+` dropdown and the project context menu.
 *
 * Mirrors `NewSshSubmenu.tsx`: two thin wrappers
 * (`DropdownNewAgentSubmenu`, `ContextNewAgentSubmenu`) render the same list
 * of agent providers from `GET /api/agent-cli/status` using their respective
 * Radix primitives. Uninstalled providers appear disabled with a "Not
 * installed" hint so the user sees the full menu at all times.
 *
 * Provider status is fetched lazily on first submenu mount and cached in
 * module-local state; `invalidateAgentCLIStatus()` (exported) can be called
 * after install/uninstall transitions so the next menu open refetches.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Settings as SettingsIcon, Loader2, AlertCircle } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type { AgentProviderType } from "@/types/session";
import { PROVIDER_DISPLAY_NAMES } from "@/types/agent";

// ---------------------------------------------------------------------------
// Module-local cache + lazy fetch hook
// ---------------------------------------------------------------------------

/** Subset of /api/agent-cli/status useful to the submenu UI. */

import { apiFetch } from "@/lib/api-fetch";
export interface AgentCLISummary {
  provider: Exclude<AgentProviderType, "none">;
  installed: boolean;
  version?: string;
  command: string;
}

interface CacheState {
  statuses: AgentCLISummary[] | null;
  loading: boolean;
  error: string | null;
}

let cache: CacheState = {
  statuses: null,
  loading: false,
  error: null,
};

/** Subscribers (one per mounted hook instance) re-render on cache mutation. */
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

function setCache(next: Partial<CacheState>): void {
  cache = { ...cache, ...next };
  notify();
}

/**
 * Mark the cache stale so the next fetch refreshes from the server.
 * Callers (e.g. agent install flows) can call this after installing or
 * uninstalling a CLI so the menu reflects the new state.
 */
export function invalidateAgentCLIStatus(): void {
  cache = { statuses: null, loading: false, error: null };
  notify();
}

/** Show all four providers even when uninstalled — disabled items are useful
 * affordances pointing users at the install instructions in Settings. */
const ALL_PROVIDERS: Array<Exclude<AgentProviderType, "none">> = [
  "claude",
  "codex",
  "gemini",
  "opencode",
];

async function fetchOnce(): Promise<void> {
  if (cache.loading) return;
  setCache({ loading: true, error: null });
  try {
    const res = await apiFetch("/api/agent-cli/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      statuses?: Array<{
        provider: string;
        installed?: boolean;
        version?: string;
        command?: string;
      }>;
    };
    const byProvider = new Map<string, { installed?: boolean; version?: string; command?: string }>();
    for (const s of data.statuses ?? []) {
      byProvider.set(s.provider, { installed: s.installed, version: s.version, command: s.command });
    }
    // Project a row for every known provider so disabled-but-visible items
    // remain in the menu when the API response omits them.
    const statuses: AgentCLISummary[] = ALL_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        installed: Boolean(row?.installed),
        version: row?.version,
        command: row?.command ?? provider,
      };
    });
    setCache({ statuses, loading: false, error: null });
  } catch (err) {
    setCache({
      statuses: ALL_PROVIDERS.map((provider) => ({
        provider,
        installed: false,
        command: provider,
      })),
      loading: false,
      error: err instanceof Error ? err.message : "Failed to load",
    });
  }
}

interface UseAgentCLIStatusLazyResult {
  statuses: AgentCLISummary[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Lazy hook: subscribes to the module-local cache and triggers a one-shot
 * fetch on first mount when the cache is empty. Subsequent mounts reuse
 * the cached data until `invalidateAgentCLIStatus()` clears it.
 */
export function useAgentCLIStatusLazy(): UseAgentCLIStatusLazyResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subscribers.add(fn);
    if (cache.statuses === null && !cache.loading) {
      void fetchOnce();
    }
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  const refetch = useCallback(() => {
    cache = { statuses: null, loading: false, error: null };
    void fetchOnce();
  }, []);

  return {
    statuses: cache.statuses,
    loading: cache.loading,
    error: cache.error,
    refetch,
  };
}

/** Test-only: reset the cache between unit tests. */
export function _resetAgentCLIStatusCache(): void {
  cache = { statuses: null, loading: false, error: null };
  subscribers.clear();
}

// ---------------------------------------------------------------------------
// Shared row layout
// ---------------------------------------------------------------------------

interface SubmenuProps {
  onSelect: (provider: Exclude<AgentProviderType, "none">) => void;
  onManage: () => void;
}

function ProviderLine({ status }: { status: AgentCLISummary }) {
  const label = PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider;
  return (
    <div className="flex flex-col items-start gap-0.5 min-w-0">
      <span className="text-sm font-medium truncate max-w-[220px]">{label}</span>
      <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
        {status.installed
          ? `v${status.version ?? "?"} · ${status.command}`
          : "Not installed"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown variant (sidebar `+` menu)
// ---------------------------------------------------------------------------

export function DropdownNewAgentSubmenu({ onSelect, onManage }: SubmenuProps) {
  const { statuses, loading, error } = useAgentCLIStatusLazy();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sparkles className="w-3.5 h-3.5 mr-2" />
        Pick Agent
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {loading && (
          <DropdownMenuItem disabled>
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            Loading…
          </DropdownMenuItem>
        )}
        {!loading && error && (
          <>
            <DropdownMenuItem disabled>
              <AlertCircle className="w-3.5 h-3.5 mr-2" />
              Failed to load
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage}>
              <SettingsIcon className="w-3.5 h-3.5 mr-2" />
              Configure agents…
            </DropdownMenuItem>
          </>
        )}
        {!loading && !error && statuses && (
          <>
            {statuses.map((s) => (
              <DropdownMenuItem
                key={s.provider}
                onClick={() => onSelect(s.provider)}
                disabled={!s.installed}
                className="py-2"
              >
                <Sparkles className="w-3.5 h-3.5 mr-2 shrink-0" />
                <ProviderLine status={s} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage}>
              <SettingsIcon className="w-3.5 h-3.5 mr-2" />
              Configure agents…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// ---------------------------------------------------------------------------
// Context-menu variant (project right-click)
// ---------------------------------------------------------------------------

export function ContextNewAgentSubmenu({ onSelect, onManage }: SubmenuProps) {
  const { statuses, loading, error } = useAgentCLIStatusLazy();

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Sparkles className="mr-2 h-4 w-4" /> Pick Agent
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-64">
        {loading && (
          <ContextMenuItem disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </ContextMenuItem>
        )}
        {!loading && error && (
          <>
            <ContextMenuItem disabled>
              <AlertCircle className="mr-2 h-4 w-4" />
              Failed to load
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onManage}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Configure agents…
            </ContextMenuItem>
          </>
        )}
        {!loading && !error && statuses && (
          <>
            {statuses.map((s) => (
              <ContextMenuItem
                key={s.provider}
                onSelect={() => onSelect(s.provider)}
                disabled={!s.installed}
                className="py-2"
              >
                <Sparkles className="mr-2 h-4 w-4 shrink-0" />
                <ProviderLine status={s} />
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onManage}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Configure agents…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
