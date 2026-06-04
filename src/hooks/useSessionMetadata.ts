import { useState, useEffect, useCallback, useRef } from "react";

import { apiFetch } from "@/lib/api-fetch";
import type { SessionMetadata } from "@/types/session-metadata";

/**
 * [n6uc] Client cache + hook for per-session metadata.
 *
 * Mirrors the TTL-cache + mount-stagger pattern of the prior
 * `useSessionGitStatus`, but for the richer aggregated payload, and merges live
 * WebSocket pushes: the terminal server emits `session_metadata`, which
 * `useTerminalWebSocket` re-dispatches as a `rdv:session-metadata` DOM event,
 * and SessionManager calls {@link primeSessionMetadata} to refresh the cache.
 */

const cache = new Map<string, { data: SessionMetadata; fetchedAt: number }>();
const TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;

/** Evict expired entries when the cache grows beyond its soft limit. */
function evictExpired(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.fetchedAt > TTL_MS) cache.delete(key);
  }
}

/** Allow the WS layer (SessionManager) to push fresh metadata into the cache. */
export function primeSessionMetadata(meta: SessionMetadata): void {
  cache.set(meta.sessionId, { data: meta, fetchedAt: Date.now() });
}

interface UseSessionMetadataResult {
  metadata: SessionMetadata | null;
  refresh: () => void;
}

export function useSessionMetadata(
  sessionId: string | null,
  enabled = true,
): UseSessionMetadataResult {
  const readCache = useCallback(
    (id: string | null): SessionMetadata | null => {
      if (!id) return null;
      const c = cache.get(id);
      return c && Date.now() - c.fetchedAt < TTL_MS ? c.data : null;
    },
    [],
  );

  const [metadata, setMetadata] = useState<SessionMetadata | null>(() =>
    readCache(sessionId),
  );
  const abortRef = useRef<AbortController | null>(null);

  // Reset state DURING render when the session changes (React-recommended
  // pattern — avoids a synchronous setState in an effect). Tracks the previous
  // session via state (not a ref) so the React Compiler accepts it. Seeds from
  // cache so a warm entry shows instantly on switch.
  const [seenSessionId, setSeenSessionId] = useState(sessionId);
  if (seenSessionId !== sessionId) {
    setSeenSessionId(sessionId);
    setMetadata(readCache(sessionId));
  }

  const fetchNow = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await apiFetch(`/api/sessions/${id}/metadata`, {
        credentials: "include",
        signal: ctrl.signal,
      });
      if (!res.ok) return;
      const data: SessionMetadata = await res.json();
      cache.set(id, { data, fetchedAt: Date.now() });
      evictExpired();
      if (!ctrl.signal.aborted) setMetadata(data);
    } catch {
      /* non-critical: metadata is best-effort */
    }
  }, []);

  // Re-read when a WS push primes the cache for this session.
  useEffect(() => {
    if (!sessionId) return;
    const onPush = (e: Event) => {
      const detail = (e as CustomEvent<SessionMetadata>).detail;
      if (detail?.sessionId === sessionId) setMetadata(detail);
    };
    document.addEventListener("rdv:session-metadata", onPush as EventListener);
    return () =>
      document.removeEventListener(
        "rdv:session-metadata",
        onPush as EventListener,
      );
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    // A fresh cache entry was already surfaced by the render-time seed; no fetch.
    if (readCache(sessionId)) return;
    // Stagger requests on mount (0–2s) like the prior git-status hook.
    const delay = Math.random() * 2000;
    const t = setTimeout(() => fetchNow(sessionId), delay);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [sessionId, enabled, fetchNow, readCache]);

  const refresh = useCallback(() => {
    if (sessionId) {
      cache.delete(sessionId);
      fetchNow(sessionId);
    }
  }, [sessionId, fetchNow]);

  return { metadata, refresh };
}
