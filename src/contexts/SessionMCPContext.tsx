"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  ParsedMCPServer,
  SessionMCPServersResponse,
  UpdateMCPServerConfigInput,
  SessionServerDiscoveryResult,
} from "@/types/agent-mcp";
import type { AgentProviderType } from "@/types/session";
import { getServerKey, makeServerKey } from "@/lib/mcp-utils";

// =============================================================================
// Context State
// =============================================================================

interface SessionMCPState {
  /** Currently selected session ID */
  sessionId: string | null;
  /** Agent provider for the session */
  agentProvider: AgentProviderType | null;
  /** Whether MCP is supported for this agent */
  mcpSupported: boolean;
  /** Parsed MCP servers */
  servers: ParsedMCPServer[];
  /** Config files that were checked */
  configFilesChecked: string[];
  /** Config files that were found */
  configFilesFound: string[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Discovery results keyed by server key (name::sourceFile) */
  discovery: Map<string, SessionServerDiscoveryResult>;
  /** Server keys currently being discovered */
  discovering: Set<string>;
}

const initialState: SessionMCPState = {
  sessionId: null,
  agentProvider: null,
  mcpSupported: false,
  servers: [],
  configFilesChecked: [],
  configFilesFound: [],
  loading: false,
  error: null,
  discovery: new Map(),
  discovering: new Set(),
};

// =============================================================================
// Context Definition
// =============================================================================

interface SessionMCPContextValue extends SessionMCPState {
  /** Load MCP servers for a session */
  loadSessionMCPServers: (sessionId: string) => Promise<void>;
  /** Clear current session MCP state */
  clearSessionMCP: () => void;
  /** Refresh MCP servers for current session */
  refreshMCPServers: () => Promise<void>;
  /** Toggle server enabled state */
  toggleServerEnabled: (server: ParsedMCPServer, enabled: boolean) => Promise<void>;
  /** Update server config */
  updateServerConfig: (
    server: ParsedMCPServer,
    updates: UpdateMCPServerConfigInput
  ) => Promise<void>;
  /** Discover tools for a single server */
  discoverServer: (server: ParsedMCPServer) => Promise<void>;
  /** Discover tools for all enabled servers */
  discoverAllServers: () => Promise<void>;
  /** Get discovery result for a server */
  getServerDiscovery: (server: ParsedMCPServer) => SessionServerDiscoveryResult | null;
}

const SessionMCPContext = createContext<SessionMCPContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SessionMCPProviderProps {
  children: ReactNode;
}

export function SessionMCPProvider({ children }: SessionMCPProviderProps) {
  const [state, setState] = useState<SessionMCPState>(initialState);

  const loadSessionMCPServers = useCallback(async (sessionId: string) => {
    setState((prev) => ({
      ...prev,
      sessionId,
      loading: true,
      error: null,
    }));

    try {
      const response = await fetch(`/api/sessions/${sessionId}/mcp-servers`);
      if (!response.ok) {
        throw new Error("Failed to load MCP servers");
      }

      const data: SessionMCPServersResponse = await response.json();

      setState((prev) => ({
        ...prev,
        sessionId,
        agentProvider: data.agentProvider,
        mcpSupported: data.mcpSupported,
        servers: data.servers,
        configFilesChecked: data.configFilesChecked,
        configFilesFound: data.configFilesFound,
        loading: false,
        error: data.error || null,
        // Clear discovery cache when loading new session
        discovery: sessionId !== prev.sessionId ? new Map() : prev.discovery,
        discovering: sessionId !== prev.sessionId ? new Set() : prev.discovering,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  }, []);

  const clearSessionMCP = useCallback(() => {
    setState({
      ...initialState,
      discovery: new Map(),
      discovering: new Set(),
    });
  }, []);

  const refreshMCPServers = useCallback(async () => {
    if (state.sessionId) {
      await loadSessionMCPServers(state.sessionId);
    }
  }, [state.sessionId, loadSessionMCPServers]);

  const toggleServerEnabled = useCallback(
    async (server: ParsedMCPServer, enabled: boolean) => {
      if (!state.sessionId) return;

      // Optimistic update
      setState((prev) => ({
        ...prev,
        servers: prev.servers.map((s) =>
          s.name === server.name && s.sourceFile === server.sourceFile
            ? { ...s, enabled }
            : s
        ),
      }));

      try {
        const response = await fetch(`/api/sessions/${state.sessionId}/mcp-servers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serverName: server.name,
            sourceFile: server.sourceFile,
            updates: { enabled },
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update server");
        }

        const data: SessionMCPServersResponse = await response.json();
        setState((prev) => ({
          ...prev,
          servers: data.servers,
          configFilesFound: data.configFilesFound,
        }));
      } catch (error) {
        // Revert optimistic update
        setState((prev) => ({
          ...prev,
          servers: prev.servers.map((s) =>
            s.name === server.name && s.sourceFile === server.sourceFile
              ? { ...s, enabled: !enabled }
              : s
          ),
          error: error instanceof Error ? error.message : "Failed to update",
        }));
      }
    },
    [state.sessionId]
  );

  const updateServerConfig = useCallback(
    async (server: ParsedMCPServer, updates: UpdateMCPServerConfigInput) => {
      if (!state.sessionId) return;

      try {
        const response = await fetch(`/api/sessions/${state.sessionId}/mcp-servers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serverName: server.name,
            sourceFile: server.sourceFile,
            updates,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update server config");
        }

        const data: SessionMCPServersResponse = await response.json();
        setState((prev) => ({
          ...prev,
          servers: data.servers,
          configFilesFound: data.configFilesFound,
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Failed to update",
        }));
        throw error;
      }
    },
    [state.sessionId]
  );

  const discoverServer = useCallback(
    async (server: ParsedMCPServer) => {
      if (!state.sessionId) return;

      const key = getServerKey(server);

      // Mark as discovering
      setState((prev) => ({
        ...prev,
        discovering: new Set([...prev.discovering, key]),
      }));

      try {
        const response = await fetch(
          `/api/sessions/${state.sessionId}/mcp-servers/discover`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverName: server.name,
              sourceFile: server.sourceFile,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to discover server");
        }

        const result: SessionServerDiscoveryResult = await response.json();

        setState((prev) => {
          const newDiscovery = new Map(prev.discovery);
          newDiscovery.set(key, result);
          const newDiscovering = new Set(prev.discovering);
          newDiscovering.delete(key);

          return {
            ...prev,
            discovery: newDiscovery,
            discovering: newDiscovering,
          };
        });
      } catch (error) {
        setState((prev) => {
          const newDiscovery = new Map(prev.discovery);
          newDiscovery.set(key, {
            serverName: server.name,
            sourceFile: server.sourceFile,
            tools: [],
            resources: [],
            discoveryStatus: "error",
            error: error instanceof Error ? error.message : "Discovery failed",
            discoveredAt: new Date(),
          });
          const newDiscovering = new Set(prev.discovering);
          newDiscovering.delete(key);

          return {
            ...prev,
            discovery: newDiscovery,
            discovering: newDiscovering,
          };
        });
      }
    },
    [state.sessionId]
  );

  const discoverAllServers = useCallback(async () => {
    if (!state.sessionId || state.servers.length === 0) return;

    const enabledServers = state.servers.filter((s) => s.enabled);
    if (enabledServers.length === 0) return;

    const enabledKeys = enabledServers.map((s) => getServerKey(s));

    // Mark all as discovering
    setState((prev) => ({
      ...prev,
      discovering: new Set(enabledKeys),
    }));

    try {
      const response = await fetch(
        `/api/sessions/${state.sessionId}/mcp-servers/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to discover servers");
      }

      const data = await response.json();
      const results: SessionServerDiscoveryResult[] = data.results || [];

      setState((prev) => {
        const newDiscovery = new Map(prev.discovery);
        results.forEach((result) => {
          const key = makeServerKey(result.serverName, result.sourceFile);
          newDiscovery.set(key, result);
        });

        return {
          ...prev,
          discovery: newDiscovery,
          discovering: new Set(),
        };
      });
    } catch (error) {
      // Mark all as error
      setState((prev) => {
        const newDiscovery = new Map(prev.discovery);
        enabledServers.forEach((server) => {
          const key = getServerKey(server);
          newDiscovery.set(key, {
            serverName: server.name,
            sourceFile: server.sourceFile,
            tools: [],
            resources: [],
            discoveryStatus: "error",
            error: error instanceof Error ? error.message : "Discovery failed",
            discoveredAt: new Date(),
          });
        });

        return {
          ...prev,
          discovery: newDiscovery,
          discovering: new Set(),
        };
      });
    }
  }, [state.sessionId, state.servers]);

  const getServerDiscovery = useCallback(
    (server: ParsedMCPServer): SessionServerDiscoveryResult | null => {
      const key = getServerKey(server);
      return state.discovery.get(key) ?? null;
    },
    [state.discovery]
  );

  const value: SessionMCPContextValue = {
    ...state,
    loadSessionMCPServers,
    clearSessionMCP,
    refreshMCPServers,
    toggleServerEnabled,
    updateServerConfig,
    discoverServer,
    discoverAllServers,
    getServerDiscovery,
  };

  return (
    <SessionMCPContext.Provider value={value}>
      {children}
    </SessionMCPContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useSessionMCP(): SessionMCPContextValue {
  const context = useContext(SessionMCPContext);
  if (!context) {
    throw new Error("useSessionMCP must be used within a SessionMCPProvider");
  }
  return context;
}

/**
 * Hook to automatically load MCP servers and trigger discovery when session changes.
 */
export function useSessionMCPAutoLoad(
  sessionId: string | null,
  isAgentSession: boolean
) {
  const {
    loadSessionMCPServers,
    clearSessionMCP,
    discoverAllServers,
    sessionId: currentSessionId,
    servers,
    discovery,
    loading,
  } = useSessionMCP();

  // Load servers when session changes
  useEffect(() => {
    if (!sessionId || !isAgentSession) {
      clearSessionMCP();
      return;
    }

    if (sessionId !== currentSessionId) {
      loadSessionMCPServers(sessionId);
    }
  }, [sessionId, isAgentSession, currentSessionId, loadSessionMCPServers, clearSessionMCP]);

  // Auto-discover when servers are loaded and no discovery has been done yet
  useEffect(() => {
    if (
      sessionId &&
      isAgentSession &&
      !loading &&
      servers.length > 0 &&
      discovery.size === 0
    ) {
      // Trigger discovery for all enabled servers
      discoverAllServers();
    }
  }, [sessionId, isAgentSession, loading, servers.length, discovery.size, discoverAllServers]);
}
