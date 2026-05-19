"use client";

/**
 * SshConnectionContext — list state + CRUD methods for saved SSH connections.
 *
 * Mirrors GitHubAccountContext: caches the list in memory, exposes
 * imperative CRUD actions, and refreshes from the server on demand. The
 * provider is intentionally lightweight — the Settings section is the
 * primary consumer, and the New Session wizard fetches lazily.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api-fetch";

export type SshAuthType = "key" | "agent" | "password" | "system";
export type SshKnownHostsPolicy = "strict" | "accept-new" | "no";

export interface SshConnectionDTO {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasPassphrase: boolean;
  knownHostsPolicy: SshKnownHostsPolicy;
  extraOptions: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface CreateSshConnectionPayload {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: SshAuthType;
  password?: string;
  hasPassphrase?: boolean;
  knownHostsPolicy?: SshKnownHostsPolicy;
  extraOptions?: string[];
  projectId?: string | null;
  privateKey?: string;
  publicKey?: string;
  generateKeypair?: boolean;
}

export type UpdateSshConnectionPayload = Partial<CreateSshConnectionPayload> & {
  password?: string | null;
  extraOptions?: string[] | null;
  projectId?: string | null;
};

interface SshConnectionContextValue {
  connections: SshConnectionDTO[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (payload: CreateSshConnectionPayload) => Promise<{
    connection: SshConnectionDTO;
    publicKey: string | null;
  }>;
  update: (
    id: string,
    payload: UpdateSshConnectionPayload
  ) => Promise<{ connection: SshConnectionDTO; publicKey: string | null }>;
  remove: (id: string) => Promise<void>;
  test: (id: string) => Promise<{ ok: boolean; exitCode: number; stderr: string; stdout: string }>;
  fetchPublicKey: (id: string) => Promise<string | null>;
}

const SshConnectionContext = createContext<SshConnectionContextValue | null>(null);

interface SshConnectionProviderProps {
  children: ReactNode;
  /** When true, fetches the connection list on mount. Defaults to false. */
  autoLoad?: boolean;
}

export function SshConnectionProvider({
  children,
  autoLoad = false,
}: SshConnectionProviderProps) {
  const [connections, setConnections] = useState<SshConnectionDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ssh-connections");
      if (!res.ok) throw new Error("Failed to fetch SSH connections");
      const data = await res.json();
      setConnections(data.connections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) {
      void refresh();
    }
  }, [autoLoad, refresh]);

  const create = useCallback(
    async (payload: CreateSshConnectionPayload) => {
      const res = await apiFetch("/api/ssh-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create SSH connection");
      }
      const created: SshConnectionDTO = data.connection;
      setConnections((prev) => [created, ...prev]);
      return { connection: created, publicKey: (data.publicKey as string | null) ?? null };
    },
    []
  );

  const update = useCallback(
    async (id: string, payload: UpdateSshConnectionPayload) => {
      const res = await apiFetch(`/api/ssh-connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update SSH connection");
      }
      const updated: SshConnectionDTO = data.connection;
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)));
      return { connection: updated, publicKey: (data.publicKey as string | null) ?? null };
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/ssh-connections/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete SSH connection");
    }
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const test = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/ssh-connections/${id}/test`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to test SSH connection");
    }
    return {
      ok: Boolean(data.ok),
      exitCode: Number(data.exitCode ?? -1),
      stderr: String(data.stderr ?? ""),
      stdout: String(data.stdout ?? ""),
    };
  }, []);

  const fetchPublicKey = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/ssh-connections/${id}/public-key`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch public key");
    }
    const data = await res.json();
    return (data.publicKey as string | null) ?? null;
  }, []);

  const value = useMemo(
    () => ({
      connections,
      loading,
      error,
      refresh,
      create,
      update,
      remove,
      test,
      fetchPublicKey,
    }),
    [connections, loading, error, refresh, create, update, remove, test, fetchPublicKey]
  );

  return (
    <SshConnectionContext.Provider value={value}>
      {children}
    </SshConnectionContext.Provider>
  );
}

export function useSshConnections() {
  const context = useContext(SshConnectionContext);
  if (!context) {
    throw new Error("useSshConnections must be used within a SshConnectionProvider");
  }
  return context;
}
