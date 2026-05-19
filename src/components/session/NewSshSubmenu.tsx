"use client";

/**
 * NewSshSubmenu — shared submenu for "New SSH" entries in the sidebar `+`
 * dropdown and the project context menu.
 *
 * Two thin wrappers (`DropdownNewSshSubmenu`, `ContextNewSshSubmenu`) render
 * the same list of saved SSH connections using their respective Radix
 * primitives so a hover-expanded submenu lists every saved connection plus
 * a final "Manage Connections…" affordance.
 *
 * Connections are fetched lazily on first submenu mount and cached in
 * module-local state; `invalidateSshConnections()` (exported) is called by
 * `SshConnectionsSection` after a successful create/update/delete so the
 * next menu open refetches.
 */

import { useCallback, useEffect, useState } from "react";
import { Server, Settings as SettingsIcon, Loader2, AlertCircle, Plus } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Module-local cache + lazy fetch hook
// ---------------------------------------------------------------------------

import { apiFetch } from "@/lib/api-fetch";

interface SshConnSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "key" | "agent" | "password" | "system";
}

interface CacheState {
  connections: SshConnSummary[] | null;
  loading: boolean;
  error: string | null;
}

let cache: CacheState = {
  connections: null,
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
 * Called by `SshConnectionsSection` after a successful create/update/delete.
 */
export function invalidateSshConnections(): void {
  cache = { connections: null, loading: false, error: null };
  notify();
}

async function fetchOnce(): Promise<void> {
  if (cache.loading) return;
  setCache({ loading: true, error: null });
  try {
    const res = await apiFetch("/api/ssh-connections");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { connections?: SshConnSummary[] };
    setCache({
      connections: (data.connections ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        host: c.host,
        port: c.port,
        username: c.username,
        authType: c.authType,
      })),
      loading: false,
      error: null,
    });
  } catch (err) {
    setCache({
      connections: [],
      loading: false,
      error: err instanceof Error ? err.message : "Failed to load",
    });
  }
}

interface UseSshConnectionsLazyResult {
  connections: SshConnSummary[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Lazy hook: subscribes to the module-local cache and triggers a one-shot
 * fetch on first mount when the cache is empty. Subsequent mounts reuse
 * the cached data until `invalidateSshConnections()` clears it.
 */
export function useSshConnectionsLazy(): UseSshConnectionsLazyResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subscribers.add(fn);
    // Trigger a fetch on first mount when nothing is cached.
    if (cache.connections === null && !cache.loading) {
      void fetchOnce();
    }
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  const refetch = useCallback(() => {
    cache = { connections: null, loading: false, error: null };
    void fetchOnce();
  }, []);

  return {
    connections: cache.connections,
    loading: cache.loading,
    error: cache.error,
    refetch,
  };
}

// Test-only: reset the cache between unit tests.
export function _resetSshConnectionsCache(): void {
  cache = { connections: null, loading: false, error: null };
  subscribers.clear();
}

// ---------------------------------------------------------------------------
// Shared item-row layout
// ---------------------------------------------------------------------------

interface SubmenuProps {
  onSelect: (connectionId: string) => void;
  onManage: () => void;
}

function ConnectionLine({ conn }: { conn: SshConnSummary }) {
  return (
    <div className="flex flex-col items-start gap-0.5 min-w-0">
      <span className="text-sm font-medium truncate max-w-[220px]">{conn.name}</span>
      <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
        {conn.username}@{conn.host}:{conn.port}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown variant (sidebar `+` menu)
// ---------------------------------------------------------------------------

export function DropdownNewSshSubmenu({ onSelect, onManage }: SubmenuProps) {
  const { connections, loading, error } = useSshConnectionsLazy();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Server className="w-3.5 h-3.5 mr-2" />
        New SSH
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {loading && (
          <DropdownMenuItem disabled>
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            Loading…
          </DropdownMenuItem>
        )}
        {!loading && error && (
          <DropdownMenuItem disabled>
            <AlertCircle className="w-3.5 h-3.5 mr-2" />
            Failed to load — click Manage Connections
          </DropdownMenuItem>
        )}
        {!loading && !error && connections && connections.length === 0 && (
          <>
            <DropdownMenuItem disabled>
              <Server className="w-3.5 h-3.5 mr-2" />
              No saved connections
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage}>
              <Plus className="w-3.5 h-3.5 mr-2" />
              Create new connection…
            </DropdownMenuItem>
          </>
        )}
        {!loading && !error && connections && connections.length > 0 && (
          <>
            {connections.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="py-2"
              >
                <Server className="w-3.5 h-3.5 mr-2 shrink-0" />
                <ConnectionLine conn={c} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage}>
              <SettingsIcon className="w-3.5 h-3.5 mr-2" />
              Manage Connections…
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

export function ContextNewSshSubmenu({ onSelect, onManage }: SubmenuProps) {
  const { connections, loading, error } = useSshConnectionsLazy();

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Server className="mr-2 h-4 w-4" /> New SSH
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-64">
        {loading && (
          <ContextMenuItem disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </ContextMenuItem>
        )}
        {!loading && error && (
          <ContextMenuItem disabled>
            <AlertCircle className="mr-2 h-4 w-4" />
            Failed to load — click Manage Connections
          </ContextMenuItem>
        )}
        {!loading && !error && connections && connections.length === 0 && (
          <>
            <ContextMenuItem disabled>
              <Server className="mr-2 h-4 w-4" />
              No saved connections
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onManage}>
              <Plus className="mr-2 h-4 w-4" />
              Create new connection…
            </ContextMenuItem>
          </>
        )}
        {!loading && !error && connections && connections.length > 0 && (
          <>
            {connections.map((c) => (
              <ContextMenuItem
                key={c.id}
                onSelect={() => onSelect(c.id)}
                className="py-2"
              >
                <Server className="mr-2 h-4 w-4 shrink-0" />
                <ConnectionLine conn={c} />
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onManage}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Manage Connections…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
